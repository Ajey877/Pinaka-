import test from "node:test";
import assert from "node:assert/strict";
import { AgentTaskRunner } from "../src/task-runner.mjs";

function workspaceManager() {
  const active = new Map();
  return {
    active,
    async create(taskId) { const record = { id: taskId, path: `/tmp/${taskId}` }; active.set(taskId, record); return record; },
    async release(taskId) { active.delete(taskId); },
    async discard(taskId) { active.delete(taskId); }
  };
}

async function waitFor(runner, taskId) {
  for (let i = 0; i < 50; i += 1) {
    const job = runner.get(taskId);
    if (["completed", "failed", "needs_attention"].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail("task did not finish");
}

test("task runner passes only the signed-in GitHub token into repository operations", async () => {
  const workspaces = workspaceManager();
  let cloneToken = null;
  let registryToken = null;
  const runner = new AgentTaskRunner({
    workspaceManager: workspaces,
    routerFactory: () => ({ chat: async () => ({}) }),
    gitFactory: () => ({
      async clone(_url, options) { cloneToken = options?.githubToken || ""; },
      async createBranch() {},
      async diff() { return { text: "", truncated: false }; }
    }),
    registryFactory: ({ githubToken }) => { registryToken = githubToken; return {}; },
    agentRunner: async () => ({ status: "accepted", verification: { passed: true } })
  });

  await runner.start({
    repositoryUrl: "https://github.com/example/private-repo",
    task: "Fix the bug",
    taskId: "auth-task",
    githubToken: "gho_session_token"
  });
  const job = await waitFor(runner, "auth-task");
  assert.equal(job.status, "completed");
  assert.equal(cloneToken, "gho_session_token");
  assert.equal(registryToken, "gho_session_token");
  assert.equal(JSON.stringify(job).includes("gho_session_token"), false);
  assert.equal(workspaces.active.size, 0);
});

test("task runner falls back to its server token when no session token is supplied", async () => {
  const workspaces = workspaceManager();
  let cloneToken = null;
  const runner = new AgentTaskRunner({
    workspaceManager: workspaces,
    githubToken: "gho_server_fallback",
    routerFactory: () => ({ chat: async () => ({}) }),
    gitFactory: () => ({
      async clone(_url, options) { cloneToken = options?.githubToken || ""; },
      async createBranch() {},
      async diff() { return { text: "", truncated: false }; }
    }),
    registryFactory: () => ({}),
    agentRunner: async () => ({ status: "passed", verification: { passed: true } })
  });
  await runner.start({ repositoryUrl: "https://github.com/example/repo", task: "Fix it", taskId: "fallback-task" });
  const job = await waitFor(runner, "fallback-task");
  assert.equal(job.status, "completed");
  assert.equal(cloneToken, "gho_server_fallback");
});
