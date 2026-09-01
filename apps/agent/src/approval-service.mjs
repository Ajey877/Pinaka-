import fs from "node:fs/promises";
import path from "node:path";
import { WorkspaceManager } from "@pinaka/workspace";
import { runCommand } from "@pinaka/tools";
import { canDecideApproval, nextApprovalStatus } from "./approval-policy.mjs";

const MAX_DIFF_CHARS = 120_000;
const MAX_TASK_CHARS = 20_000;
const COMMIT_MESSAGE_LIMIT = 120;

function validateJob(job) {
  if (!job || typeof job !== "object") throw Object.assign(new Error("job is required"), { code: "INVALID_JOB" });
  if (typeof job.id !== "string" || typeof job.repositoryUrl !== "string" || typeof job.task !== "string") {
    throw Object.assign(new Error("job is missing approval fields"), { code: "INVALID_JOB" });
  }
  return job;
}

function normalizeDiff(job) {
  const diff = job.result?.diff;
  if (!diff || typeof diff.text !== "string" || diff.text.length === 0) {
    throw Object.assign(new Error("no retained diff is available for approval"), { code: "NO_DIFF" });
  }
  if (diff.text.length > MAX_DIFF_CHARS || diff.truncated === true) {
    throw Object.assign(new Error("retained diff is truncated and cannot be approved"), { code: "DIFF_TRUNCATED" });
  }
  return diff.text;
}

function makeCommitMessage(task) {
  const compact = task.replace(/\s+/g, " ").trim().replace(/[\r\n]/g, " ");
  const suffix = " [Pinaka]";
  return `${compact.slice(0, Math.max(1, COMMIT_MESSAGE_LIMIT - suffix.length))}${suffix}`;
}

export class ApprovalService {
  #workspaceManager;
  #decisions = new Map();

  constructor({ workspaceRoot, workspaceManager } = {}) {
    this.#workspaceManager = workspaceManager || new WorkspaceManager({ rootDirectory: workspaceRoot });
  }

  decorate(job) {
    validateJob(job);
    const decision = this.#decisions.get(job.id);
    if (decision) return { ...job, approval: { ...decision } };
    if (canDecideApproval(job, "approve")) {
      return { ...job, approval: { status: "pending", actions: ["approve", "reject"] } };
    }
    return { ...job, approval: null };
  }

  async decide(job, approval) {
    validateJob(job);
    if (!canDecideApproval(job, approval)) {
      const error = Object.assign(new Error("task is not awaiting a valid approval decision"), { code: "APPROVAL_NOT_ALLOWED", statusCode: 409 });
      throw error;
    }
    if (this.#decisions.has(job.id)) {
      const error = Object.assign(new Error("approval decision already recorded"), { code: "APPROVAL_ALREADY_DECIDED", statusCode: 409 });
      throw error;
    }

    if (approval === "reject") {
      const decision = { status: nextApprovalStatus(approval), decidedAt: new Date().toISOString() };
      this.#decisions.set(job.id, decision);
      return { ...job, status: decision.status, approval: decision };
    }

    const diff = normalizeDiff(job);
    const workspace = await this.#workspaceManager.create(`approval-${job.id}`);
    try {
      const run = (args, options = {}) => runCommand({ workspaceRoot: workspace.path, executable: "git", args, ...options });
      const clone = await run(["clone", "--no-recurse-submodules", "--depth", "1", job.repositoryUrl, "."], { timeoutMs: 120_000, maxOutputBytes: 512 * 1024 });
      if (clone.exitCode !== 0 || clone.timedOut) throw Object.assign(new Error("approval clone failed"), { code: "APPROVAL_CLONE_FAILED" });

      const branch = `agent/${job.id}`;
      const branchResult = await run(["switch", "-c", branch]);
      if (branchResult.exitCode !== 0) throw Object.assign(new Error("approval branch creation failed"), { code: "APPROVAL_BRANCH_FAILED" });

      const patchPath = path.join(workspace.path, ".pinaka-approval.patch");
      await fs.writeFile(patchPath, diff, "utf8");
      const applyResult = await run(["apply", "--check", ".pinaka-approval.patch"]);
      if (applyResult.exitCode !== 0) throw Object.assign(new Error("approved diff no longer applies cleanly to the repository"), { code: "APPROVAL_DIFF_CONFLICT" });
      const apply = await run(["apply", ".pinaka-approval.patch"]);
      if (apply.exitCode !== 0) throw Object.assign(new Error("approved diff could not be applied"), { code: "APPROVAL_DIFF_APPLY_FAILED" });

      const add = await run(["add", "-A"]);
      if (add.exitCode !== 0) throw Object.assign(new Error("approved changes could not be staged"), { code: "APPROVAL_STAGE_FAILED" });
      const commit = await run(["-c", "user.name=Pinaka", "-c", "user.email=pinaka@localhost", "commit", "-m", makeCommitMessage(job.task)], { maxOutputBytes: 128 * 1024 });
      if (commit.exitCode !== 0) throw Object.assign(new Error("approved changes could not be committed"), { code: "APPROVAL_COMMIT_FAILED" });
      const head = await run(["rev-parse", "HEAD"], { maxOutputBytes: 8 * 1024 });
      if (head.exitCode !== 0) throw Object.assign(new Error("approved commit could not be read"), { code: "APPROVAL_HEAD_FAILED" });

      const decision = { status: nextApprovalStatus(approval), decidedAt: new Date().toISOString(), branch, commit: head.stdout.trim() };
      this.#decisions.set(job.id, decision);
      return { ...job, status: decision.status, approval: decision };
    } finally {
      try {
        await this.#workspaceManager.release(`approval-${job.id}`);
      } catch {
        try { await this.#workspaceManager.discard(`approval-${job.id}`); } catch { /* best effort */ }
      }
    }
  }
}
