import test from "node:test";
import assert from "node:assert/strict";
import { AgentTaskRunner } from "../src/task-runner.mjs";
import { LOCAL_USER_ID } from "../src/local-mode.mjs";

function makeWorkspaceManager() {
  return {
    async create(taskId) { return { id: taskId, path: `/tmp/${taskId}` }; },
    async release() {},
    async discard() {}
  };
}

async function waitForStatus(runner, taskId, expected) {
  for (let index = 0; index < 100; index += 1) {
    const job = runner.get(taskId);
    if (job.status === expected) return job;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail(`task ${taskId} did not reach ${expected}`);
}

test("local owner can run a task without a GitHub token", async () => {
  const runner = new AgentTaskRunner({
    workspaceManager: makeWorkspaceManager(),
    routerFactory: () => ({}),
    gitFactory: () => ({ async clone() {}, async createBranch() {}, async diff() { return { text: "", truncated: false }; } }),
    registryFactory: () => ({}),
    agentRunner: async () => ({ status: "accepted", verification: { passed: true } })
  });

  await runner.start({
    repositoryUrl: "https://github.com/example/repo",
    task: "Fix it",
    taskId: "local-task",
    ownerId: LOCAL_USER_ID
  });

  const job = await waitForStatus(runner, "local-task", "completed");
  assert.equal(job.ownerId, LOCAL_USER_ID);
  assert.equal(runner.belongsTo("local-task", LOCAL_USER_ID), true);
});
