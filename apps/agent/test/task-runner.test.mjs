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
      async clone(url, options) { events.push(["clone", workspaceRoot, url, options]); },
      async createBranch(name) { events.push(["branch", name]); },
      async diff() { return { text: "", truncated: false }; }
    }),
    registryFactory: ({ workspaceRoot }) => ({ workspaceRoot }),
    agentRunner: async ({ task, registry }) => {
      events.push(["agent", task, registry.workspaceRoot]);
      return { status: "passed", verification: { passed: true } };
    },
    githubToken: "private-token"
  });

  const created = await runner.start({
    repositoryUrl: "https://github.com/example/repo",
    task: "Fix the login bug",
    taskId: "task-123"
  });

  assert.ok(["queued", "running", "completed"].includes(created.status));
  const current = await waitForStatus(runner, "task-123", "completed");
  assert.equal(current.result.status, "passed");

  assert.equal(events[0][0], "clone");
  assert.equal(events[0][1], "/tmp/task-123");
  assert.equal(events[0][2], "https://github.com/example/repo");
  assert.deepEqual(events[0][3], { githubToken: "private-token" });
  assert.deepEqual(events.slice(1), [
    ["branch", "agent/task-123"],
    ["agent", "Fix the login bug", "/tmp/task-123"]
  ]);
  assert.equal(workspaceManager.active.size, 0);
});

test("task runner retains a bounded final diff after execution", async () => {
  const workspaceManager = makeWorkspaceManager();
  const diffText = [
    "diff --git a/src/login.js b/src/login.js",
    "index 1111111..2222222 100644",
    "--- a/src/login.js",
    "+++ b/src/login.js",
    "@@ -1 +1 @@",
    "-return false;",
    "+return true;"
  ].join("\\n");
  const runner = new AgentTaskRunner({
    workspaceManager,
    routerFactory: () => ({ chat: async () => ({}) }),
    gitFactory: () => ({
      async clone() {},
      async createBranch() {},
      async diff() { return { text: diffText, truncated: false }; }
    }),
    registryFactory: () => ({ workspaceRoot: "/tmp/task-diff" }),
    agentRunner: async () => ({ status: "accepted", verification: { passed: true } })
  });

  await runner.start({
    repositoryUrl: "https://github.com/example/repo",
    task: "Fix login",
    taskId: "task-diff"
  });
  const current = await waitForStatus(runner, "task-diff", "completed");
  assert.equal(current.result.diff.text, diffText);
  assert.equal(current.result.diff.truncated, false);
  assert.equal(current.result.diff.changeCount, null);
});

test("task runner surfaces tool and agent telemetry without raw inputs", async () => {
  const workspaceManager = makeWorkspaceManager();
  const runner = new AgentTaskRunner({
    workspaceManager,
    routerFactory: () => ({ chat: async () => ({}) }),
    gitFactory: () => ({
      async clone() {},
      async createBranch() {},
      async diff() { return { text: "", truncated: false }; }
    }),
    registryFactory: ({ onToolEvent }) => {
      onToolEvent({ type: "tool.start", tool: "files.read", input: "secret" });
      onToolEvent({ type: "tool.finish", tool: "files.read", ok: true, durationMs: 12, result: { content: "secret" } });
      return { workspaceRoot: "/tmp/task-telemetry" };
    },
    agentRunner: async ({ onEvent }) => {
      onEvent({ type: "verification.complete", passed: true, checksPlanned: 3, checksRun: 3 });
      onEvent({ type: "repair.start", attempt: 1 });
      onEvent({ type: "repair.complete", attempt: 1, toolCalls: 2 });
      onEvent({ type: "review.complete", accepted: true, findings: 0, blockers: 0 });
      return { status: "accepted", verification: { passed: true } };
    }
  });

  await runner.start({
    repositoryUrl: "https://github.com/example/repo",
    task: "Add telemetry",
    taskId: "task-telemetry"
  });
  await waitForStatus(runner, "task-telemetry", "completed");

  const history = runner.events("task-telemetry");
  const types = history.map((event) => event.type);
  assert.ok(types.includes("tool.start"));
  assert.ok(types.includes("tool.finish"));
  assert.ok(types.includes("verification.complete"));
  assert.ok(types.includes("repair.start"));
  assert.ok(types.includes("repair.complete"));
  assert.ok(types.includes("review.complete"));

  for (const event of history) {
    assert.equal(Object.prototype.hasOwnProperty.call(event.data || {}, "input"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(event.data || {}, "content"), false);
  }
  assert.equal(workspaceManager.active.size, 0);
});

test("task runner retains a useful failure result when execution fails", async () => {
  const workspaceManager = makeWorkspaceManager();
  const runner = new AgentTaskRunner({
    workspaceManager,
    gitFactory: () => ({
      async clone() { throw Object.assign(new Error("clone failed"), { code: "GIT_COMMAND_FAILED" }); },
      async createBranch() {},
      async diff() { return { text: "", truncated: false }; }
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
