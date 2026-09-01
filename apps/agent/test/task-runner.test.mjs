import test from "node:test";
import assert from "node:assert/strict";
import { AgentTaskRunner } from "../src/task-runner.mjs";

function makeWorkspaceManager() {
  const active = new Map();
  return {
    active,
    async create(taskId) {
      const record = { id: `workspace-${taskId}`, taskId, path: `/tmp/${taskId}`, status: "active" };
      active.set(taskId, record);
      return record;
    },
    async release(taskId) {
      const record = active.get(taskId);
      active.delete(taskId);
      return { ...record, status: "released" };
    },
    async discard(taskId) {
      const record = active.get(taskId);
      active.delete(taskId);
      return { ...record, status: "discarded" };
    }
  };
}

async function waitForStatus(runner, taskId, expected, attempts = 50) {
  for (let index = 0; index < attempts; index += 1) {
    const current = runner.get(taskId);
    if (current.status === expected) return current;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail(`task ${taskId} did not reach ${expected} status`);
}

test("task runner validates repository and task input", async () => {
  const runner = new AgentTaskRunner({
    workspaceManager: makeWorkspaceManager(),
    routerFactory: () => ({})
  });

  await assert.rejects(
    () => runner.start({ repositoryUrl: "file:///tmp/repo", task: "Fix it" }),
    (error) => error.code === "INVALID_REPOSITORY_URL"
  );
  await assert.rejects(
    () => runner.start({ repositoryUrl: "https://github.com/example/repo", task: "" }),
    (error) => error.code === "INVALID_TASK"
  );
});

test("task runner executes the workspace lifecycle and returns completion status", async () => {
  const workspaceManager = makeWorkspaceManager();
  const events = [];
  const runner = new AgentTaskRunner({
    workspaceManager,
    routerFactory: () => ({ chat: async () => ({}) }),
    gitFactory: ({ workspaceRoot }) => ({
      async clone(url) { events.push(["clone", workspaceRoot, url]); },
      async createBranch(name) { events.push(["branch", name]); }
    }),
    registryFactory: ({ workspaceRoot }) => ({ workspaceRoot }),
    agentRunner: async ({ task, registry }) => {
      events.push(["agent", task, registry.workspaceRoot]);
      return { status: "passed", verification: { passed: true } };
    }
  });

  const created = await runner.start({
    repositoryUrl: "https://github.com/example/repo",
    task: "Fix the login bug",
    taskId: "task-123"
  });

  assert.ok(["queued", "running", "completed"].includes(created.status));
  const current = await waitForStatus(runner, "task-123", "completed");
  assert.equal(current.result.status, "passed");

  assert.deepEqual(events, [
    ["clone", "/tmp/task-123", "https://github.com/example/repo"],
    ["branch", "agent/task-123"],
    ["agent", "Fix the login bug", "/tmp/task-123"]
  ]);
  assert.equal(workspaceManager.active.size, 0);
});

test("task runner streams bounded lifecycle events to subscribers", async () => {
  const workspaceManager = makeWorkspaceManager();
  const runner = new AgentTaskRunner({
    workspaceManager,
    routerFactory: () => ({ chat: async () => ({}) }),
    gitFactory: () => ({
      async clone() {},
      async createBranch() {}
    }),
    registryFactory: () => ({ workspaceRoot: "/tmp/event-task" }),
    agentRunner: async () => ({ status: "passed", verification: { passed: true } })
  });

  const received = [];
  const created = await runner.start({
    repositoryUrl: "https://github.com/example/repo",
    task: "Stream progress",
    taskId: "event-task"
  });
  const unsubscribe = runner.subscribe(created.id, (event) => received.push(event));

  const current = await waitForStatus(runner, created.id, "completed");
  unsubscribe();

  const history = runner.events(created.id);
  assert.ok(history.length >= 2);
  assert.ok(received.length >= 1);
  assert.deepEqual(history.map((event) => event.taskId), history.map(() => created.id));
  assert.equal(history.at(-1).status, "completed");
  assert.equal(current.status, "completed");
  assert.ok(history.every((event) => typeof event.id === "string" && event.id.length > 0));
});

test("task runner retains a useful failure result when execution fails", async () => {
  const workspaceManager = makeWorkspaceManager();
  const runner = new AgentTaskRunner({
    workspaceManager,
    gitFactory: () => ({
      async clone() { throw Object.assign(new Error("clone failed"), { code: "GIT_COMMAND_FAILED" }); },
      async createBranch() {}
    }),
    routerFactory: () => ({ chat: async () => ({}) })
  });

  await runner.start({
    repositoryUrl: "https://github.com/example/repo",
    task: "Fix it",
    taskId: "task-fail"
  });

  const current = await waitForStatus(runner, "task-fail", "failed");
  assert.equal(current.error.code, "GIT_COMMAND_FAILED");
  assert.equal(workspaceManager.active.size, 0);
});
