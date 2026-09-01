import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkspaceError, WorkspaceManager } from "../src/index.mjs";

const roots = [];

async function makeRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pinaka-workspaces-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

test("creates and retrieves an isolated workspace", async () => {
  const root = await makeRoot();
  const manager = new WorkspaceManager({ rootDirectory: root });
  const workspace = await manager.create("task-123");

  assert.equal(workspace.taskId, "task-123");
  assert.match(workspace.id, /^[0-9a-f-]{36}$/i);
  assert.equal(workspace.status, "active");
  assert.equal(await fs.stat(workspace.path).then((stat) => stat.isDirectory()), true);
  assert.deepEqual(manager.get("task-123"), workspace);
});

test("rejects invalid and duplicate task ids", async () => {
  const root = await makeRoot();
  const manager = new WorkspaceManager({ rootDirectory: root });

  await assert.rejects(() => manager.create("../escape"), (error) => {
    assert.ok(error instanceof WorkspaceError);
    assert.equal(error.code, "INVALID_TASK_ID");
    return true;
  });

  await manager.create("safe-task");
  await assert.rejects(() => manager.create("safe-task"), (error) => {
    assert.ok(error instanceof WorkspaceError);
    assert.equal(error.code, "WORKSPACE_EXISTS");
    return true;
  });
});

test("release removes the workspace and makes it unavailable", async () => {
  const root = await makeRoot();
  const manager = new WorkspaceManager({ rootDirectory: root });
  const workspace = await manager.create("release-me");

  const result = await manager.release("release-me");
  assert.equal(result.status, "released");
  await assert.rejects(() => fs.stat(workspace.path), { code: "ENOENT" });
  assert.equal(manager.has("release-me"), false);
  assert.throws(() => manager.get("release-me"), (error) => {
    assert.ok(error instanceof WorkspaceError);
    assert.equal(error.code, "WORKSPACE_NOT_FOUND");
    return true;
  });
});

test("discard is idempotent for filesystem cleanup", async () => {
  const root = await makeRoot();
  const manager = new WorkspaceManager({ rootDirectory: root });
  const workspace = await manager.create("discard-me");
  await fs.writeFile(path.join(workspace.path, "file.txt"), "data");

  const result = await manager.discard("discard-me");
  assert.equal(result.status, "discarded");
  await assert.rejects(() => fs.stat(workspace.path), { code: "ENOENT" });
});

test("list returns active workspaces only", async () => {
  const root = await makeRoot();
  const manager = new WorkspaceManager({ rootDirectory: root });
  const one = await manager.create("one");
  await manager.create("two");
  await manager.release("one");

  assert.deepEqual(manager.list().map(({ taskId }) => taskId), ["two"]);
});
