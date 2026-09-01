import crypto from "node:crypto";
import { WorkspaceManager } from "@pinaka/workspace";
import { GitRepository } from "@pinaka/git";
import { ModelRouter, OpenAICompatibleProvider } from "@pinaka/model";
import { runAutonomousRepairLoop } from "@pinaka/core";
import { createToolRegistry } from "./tool-runtime.mjs";

const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const MAX_REPOSITORY_URL = 2_048;
const MAX_TASK_CHARS = 20_000;
const MAX_JOBS = 64;
const MAX_EVENTS_PER_TASK = 128;
const MAX_RETAINED_DIFF_CHARS = 120_000;

function validateText(value, name, maxLength) {
  if (typeof value !== "string" || value.trim() === "" || value.length > maxLength) {
    const error = new Error(`${name} is required and must be at most ${maxLength} characters`);
    error.statusCode = 400;
    error.code = `INVALID_${name.toUpperCase()}`;
    throw error;
  }
  return value.trim();
}
function validateRepositoryUrl(repositoryUrl) {
  const value = validateText(repositoryUrl, "repositoryUrl", MAX_REPOSITORY_URL);
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/i.test(value)) throw Object.assign(new Error("repositoryUrl must be an HTTPS GitHub repository URL"), { statusCode: 400, code: "INVALID_REPOSITORY_URL" });
  return value;
}
function validateTaskId(taskId) {
  if (typeof taskId !== "string" || !TASK_ID_PATTERN.test(taskId)) throw Object.assign(new Error("invalid task id"), { statusCode: 400, code: "INVALID_TASK_ID" });
  return taskId;
}
function buildDefaultRouter({ apiKey = "", baseUrl, model } = {}) {
  const resolvedBaseUrl = baseUrl || process.env.PINAKA_MODEL_BASE_URL || "https://openrouter.ai/api/v1";
  const resolvedModel = model || process.env.PINAKA_MODEL || "";
  if (!resolvedModel) throw Object.assign(new Error("PINAKA_MODEL is required to run an AI task"), { statusCode: 503, code: "MODEL_NOT_CONFIGURED" });
  const provider = new OpenAICompatibleProvider({ baseUrl: resolvedBaseUrl, apiKey: apiKey || process.env.OPENROUTER_API_KEY || process.env.PINAKA_MODEL_API_KEY || "", model: resolvedModel });
  return new ModelRouter().register("default", provider, { defaultProvider: true });
}
function makeJob(taskId, repositoryUrl, task, ownerId = null) {
  return { id: taskId, ownerId, repositoryUrl, task, status: "queued", stage: "queued", message: "Waiting to start", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), result: null, error: null };
}
function sanitizeToolEvent(event) {
  if (!event || typeof event !== "object") return null;
  const safe = { type: typeof event.type === "string" ? event.type : "tool.event", tool: typeof event.tool === "string" ? event.tool : "unknown" };
  if (event.type === "tool.finish") {
    if (typeof event.ok === "boolean") safe.ok = event.ok;
    if (Number.isFinite(event.durationMs)) safe.durationMs = Math.max(0, Math.min(300_000, event.durationMs));
    if (typeof event.errorCode === "string") safe.errorCode = event.errorCode.slice(0, 128);
    if (event.result && typeof event.result === "object") {
      const result = {};
      if (typeof event.result.type === "string") result.type = event.result.type;
      if (Number.isInteger(event.result.count)) result.count = Math.max(0, event.result.count);
      if (Number.isInteger(event.result.chars)) result.chars = Math.max(0, event.result.chars);
      if (Array.isArray(event.result.keys)) result.keys = event.result.keys.filter((key) => typeof key === "string").slice(0, 16);
      if (Object.keys(result).length) safe.result = result;
    }
  }
  return safe;
}

export class AgentTaskRunner {
  #workspaceManager;
  #jobs = new Map();
  #eventHistory = new Map();
  #subscribers = new Map();
  #credentials = new Map();
  #routerFactory;
  #gitFactory;
  #registryFactory;
  #agentRunner;

  constructor({ workspaceRoot, workspaceManager, routerFactory = buildDefaultRouter, gitFactory = ({ workspaceRoot: root }) => new GitRepository({ workspaceRoot: root }), registryFactory = ({ workspaceRoot: root, githubToken, onToolEvent }) => createToolRegistry({ workspaceRoot: root, githubToken, onToolEvent }), agentRunner = runAutonomousRepairLoop } = {}) {
    this.#workspaceManager = workspaceManager || new WorkspaceManager({ rootDirectory: workspaceRoot });
    this.#routerFactory = routerFactory;
    this.#gitFactory = gitFactory;
    this.#registryFactory = registryFactory;
    this.#agentRunner = agentRunner;
  }

  list(ownerId = null) {
    const jobs = [...this.#jobs.values()];
    return jobs.filter((job) => ownerId === null || job.ownerId === ownerId).map((job) => ({ ...job }));
  }
  get(taskId) {
    validateTaskId(taskId);
    const job = this.#jobs.get(taskId);
    if (!job) throw Object.assign(new Error("task not found"), { statusCode: 404, code: "TASK_NOT_FOUND" });
    return { ...job };
  }
  belongsTo(taskId, ownerId) {
    const job = this.get(taskId);
    return job.ownerId !== null && job.ownerId === ownerId;
  }
  subscribe(taskId, listener) {
    validateTaskId(taskId);
    if (!this.#jobs.has(taskId)) throw Object.assign(new Error("task not found"), { statusCode: 404, code: "TASK_NOT_FOUND" });
    if (typeof listener !== "function") throw new TypeError("event listener must be a function");
    let listeners = this.#subscribers.get(taskId);
    if (!listeners) { listeners = new Set(); this.#subscribers.set(taskId, listeners); }
    listeners.add(listener);
    return () => { listeners.delete(listener); if (listeners.size === 0) this.#subscribers.delete(taskId); };
  }
  events(taskId) {
    validateTaskId(taskId);
    if (!this.#jobs.has(taskId)) throw Object.assign(new Error("task not found"), { statusCode: 404, code: "TASK_NOT_FOUND" });
    return [...(this.#eventHistory.get(taskId) || [])];
  }

  async start({ repositoryUrl, task, taskId = crypto.randomUUID().replaceAll("-", "").slice(0, 20), model, apiKey, baseUrl, ownerId = null, githubToken = "" } = {}) {
    const safeRepositoryUrl = validateRepositoryUrl(repositoryUrl);
    const safeTask = validateText(task, "task", MAX_TASK_CHARS);
    validateTaskId(taskId);
    if (ownerId !== null && (!Number.isInteger(ownerId) || ownerId <= 0)) throw Object.assign(new Error("ownerId is invalid"), { statusCode: 400, code: "INVALID_OWNER_ID" });
    if (ownerId !== null && (typeof githubToken !== "string" || githubToken.trim() === "")) throw Object.assign(new Error("githubToken is required for authenticated tasks"), { statusCode: 401, code: "AUTH_TOKEN_REQUIRED" });
    if (this.#jobs.has(taskId)) throw Object.assign(new Error(`task already exists: ${taskId}`), { statusCode: 409, code: "TASK_EXISTS" });
    if (this.#jobs.size >= MAX_JOBS) throw Object.assign(new Error("too many retained task results"), { statusCode: 429, code: "TASK_CAPACITY_REACHED" });

    const job = makeJob(taskId, safeRepositoryUrl, safeTask, ownerId);
    this.#jobs.set(taskId, job);
    this.#eventHistory.set(taskId, []);
    this.#credentials.set(taskId, { githubToken: typeof githubToken === "string" ? githubToken.trim() : "", apiKey, baseUrl, model });
    this.#emit(job, "queued", "Task queued");
    void this.#run(job);
    return { ...job };
  }
  #emit(job, type, message, data = {}) {
    const event = Object.freeze({ id: crypto.randomUUID(), taskId: job.id, type, stage: job.stage, message, status: job.status, timestamp: new Date().toISOString(), data: data && typeof data === "object" ? { ...data } : {} });
    const history = this.#eventHistory.get(job.id) || [];
    if (history.length >= MAX_EVENTS_PER_TASK) history.shift();
    history.push(event); this.#eventHistory.set(job.id, history);
    for (const listener of this.#subscribers.get(job.id) || []) { try { listener(event); } catch { /* consumer cannot affect execution */ } }
  }
  #update(job, patch) { Object.assign(job, patch, { updatedAt: new Date().toISOString() }); this.#emit(job, "task.stage", job.message); }
  #emitCoreEvent(job, event) {
    if (!event || typeof event !== "object") return;
    const type = typeof event.type === "string" ? event.type : "agent.event";
    const messageByType = { "verification.start": "Running repository verification", "verification.complete": event.passed ? "Verification passed" : "Verification failed", "review.start": "Starting final code review", "review.complete": event.accepted ? "Final review approved" : "Final review rejected", "repair.start": `Starting repair attempt ${event.attempt || ""}`.trim(), "repair.complete": `Repair attempt ${event.attempt || ""} complete`.trim(), "task.unverified": "Repository has no detectable verification checks", "task.failed": "Task exhausted its repair budget" };
    this.#emit(job, type, messageByType[type] || type.replaceAll(".", " "), { ...event });
  }

  async #run(job) {
    let workspace = null;
    const credentials = this.#credentials.get(job.id) || {};
    try {
      this.#update(job, { status: "running", stage: "workspace", message: "Creating an isolated workspace" });
      workspace = await this.#workspaceManager.create(job.id);
      this.#update(job, { stage: "clone", message: "Cloning the repository" });
      const git = this.#gitFactory({ workspaceRoot: workspace.path });
      await git.clone(job.repositoryUrl, { githubToken: credentials.githubToken || "" });
      this.#update(job, { stage: "branch", message: "Creating an isolated agent branch" });
      await git.createBranch(`agent/${job.id}`);
      this.#update(job, { stage: "model", message: "Running Pinaka against the repository" });
      const registry = this.#registryFactory({ workspaceRoot: workspace.path, githubToken: credentials.githubToken || "", onToolEvent: (event) => { const safeEvent = sanitizeToolEvent(event); if (!safeEvent) return; this.#emit(job, safeEvent.type, safeEvent.ok === false ? `Failed ${safeEvent.tool}` : safeEvent.type === "tool.start" ? `Running ${safeEvent.tool}` : `Finished ${safeEvent.tool}`, safeEvent); } });
      const router = this.#routerFactory({ apiKey: credentials.apiKey, baseUrl: credentials.baseUrl, model: credentials.model });
      const result = await this.#agentRunner({ registry, router, task: job.task, provider: "default", onEvent: (event) => this.#emitCoreEvent(job, event) });
      let diff = null;
      try {
        const diffResult = await git.diff({ staged: false, maxOutputBytes: MAX_RETAINED_DIFF_CHARS });
        if (diffResult && typeof diffResult === "object") diff = { text: typeof diffResult.text === "string" ? diffResult.text : "", truncated: diffResult.truncated === true, changeCount: Number.isInteger(result?.finalReview?.diff?.changeCount) ? result.finalReview.diff.changeCount : null };
      } catch (error) {
        this.#emit(job, "diff.error", "Unable to capture the final diff", { errorCode: typeof error?.code === "string" ? error.code.slice(0, 128) : "DIFF_CAPTURE_FAILED" });
      }
      const finalResult = diff ? { ...result, diff } : result;
      this.#update(job, { status: result.status === "passed" || result.status === "repaired" || result.status === "accepted" ? "completed" : "needs_attention", stage: "complete", message: result.status === "repaired" ? "Task repaired and verified" : result.status === "passed" || result.status === "accepted" ? "Task verified" : "Task finished without full verification", result: finalResult });
    } catch (error) {
      this.#update(job, { status: "failed", stage: "error", message: error?.message || "Task failed", error: { code: error?.code || "TASK_FAILED", message: error?.message || "Task failed" } });
    } finally {
      this.#credentials.delete(job.id);
      if (workspace) {
        try { await this.#workspaceManager.release(job.id); } catch { try { await this.#workspaceManager.discard(job.id); } catch { /* best effort */ } }
      }
    }
  }
}
