import test from "node:test";
import assert from "node:assert/strict";
import { AgentTaskRunner } from "../src/task-runner.mjs";
import { ApprovalService } from "../src/approval-service.mjs";
import { PersistentTaskStore } from "../src/task-store.mjs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

function workspaces() {
  const active = new Map();
  return {
    active,
    async create(id) { const record = { id, path: path.join("/tmp", id) }; active.set(id, record); return record; },
    async release(id) { active.delete(id); },
    async discard(id) { active.delete(id); }
  };
}

async function waitFor(runner, id, status = "completed") {
  for (let i = 0; i < 100; i += 1) {
    const job = runner.get(id);
    if (job.status === status) return job;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail(`task ${id} did not reach ${status}`);
}

test("full task lifecycle reaches verified completion and persists a redacted history record", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pinaka-e2e-"));
  try {
    const workspaceManager = workspaces();
    const calls = [];
    const runner = new AgentTaskRunner({
      workspaceManager,
      gitFactory: () => ({
        async clone(url, options) { calls.push(["clone", url, options.githubToken]); },
        async createBranch(name) { calls.push(["branch", name]); },
        async diff() { return { text: "diff --git a/app.js b/app.js\n+fixed\n", truncated: false }; }
      }),
      registryFactory: ({ githubToken, onToolEvent }) => {
        calls.push(["registry", githubToken]);
        onToolEvent({ type: "tool.start", tool: "files.read", input: "secret" });
        onToolEvent({ type: "tool.finish", tool: "files.write", ok: true, durationMs: 5, result: { content: "secret", chars: 12 } });
        return {};
      },
      routerFactory: () => ({}),
      agentRunner: async ({ onEvent }) => {
        onEvent({ type: "verification.complete", passed: true, checksPlanned: 2, checksRun: 2 });
        onEvent({ type: "review.complete", accepted: true, findings: 0, blockers: 0 });
        return { status: "accepted", verification: { passed: true }, finalReview: { accepted: true, findings: 0 } };
      }
    });

    const initial = await runner.start({ repositoryUrl: "https://github.com/example/repo", task: "Fix login", taskId: "e2e-task", ownerId: 101, githubToken: "gho_secret" });
    assert.equal(initial.ownerId, 101);
    const completed = await waitFor(runner, "e2e-task");
    assert.equal(completed.status, "completed");
    assert.equal(completed.result.verification.passed, true);
    assert.equal(completed.result.finalReview.accepted, true);
    assert.equal(completed.result.diff.truncated, false);
    assert.equal(JSON.stringify(completed).includes("gho_secret"), false);
    assert.deepEqual(calls, [["clone", "https://github.com/example/repo", "gho_secret"], ["branch", "agent/e2e-task"], ["registry", "gho_secret"]]);
    assert.equal(workspaceManager.active.size, 0);

    const store = new PersistentTaskStore({ filePath: path.join(root, "tasks.json"), maxTasks: 10 });
    await store.save({ ...completed, events: runner.events("e2e-task") });
    const reloaded = new PersistentTaskStore({ filePath: path.join(root, "tasks.json"), maxTasks: 10 });
    const saved = reloaded.get("e2e-task");
    assert.equal(saved.ownerId, 101);
    assert.equal(saved.result.diff.text.includes("+fixed"), true);
    assert.equal(JSON.stringify(saved).includes("gho_secret"), false);
    assert.equal(saved.events.some((event) => JSON.stringify(event).includes("secret")), false);

    const file = JSON.parse(await readFile(path.join(root, "tasks.json"), "utf8"));
    assert.equal(JSON.stringify(file).includes("gho_secret"), false);
    assert.equal(JSON.stringify(file).includes('"input"'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("approval boundary never publishes a rejected lifecycle", async () => {
  let published = false;
  const service = new ApprovalService({ workspaceManager: { discard: async () => {} }, githubPrClientFactory: () => ({ createPullRequest: async () => { published = true; } }) });
  const job = { id: "reject-e2e", repositoryUrl: "https://github.com/example/repo", task: "Do nothing", status: "completed", result: { status: "accepted", diff: { text: "diff", truncated: false }, finalReview: { accepted: true } } };
  const result = await service.decide(job, "reject", { githubToken: "gho_secret" });
  assert.equal(result.status, "rejected");
  assert.equal(published, false);
});
