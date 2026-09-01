import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PersistentTaskStore, __test } from "../src/task-store.mjs";

async function tempFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pinaka-store-"));
  return { dir, file: path.join(dir, "tasks.json") };
}

test("persistent store survives a fresh instance and strips credentials", async () => {
  const target = await tempFile();
  const store = new PersistentTaskStore({ filePath: target.file });
  await store.save({ id: "task-1", ownerId: 7, repositoryUrl: "https://github.com/example/repo", task: "Fix it", status: "completed", result: { diff: { text: "diff", truncated: false } }, githubToken: "secret-token", credentials: { apiKey: "secret-api" } });
  const fresh = new PersistentTaskStore({ filePath: target.file });
  const task = fresh.get("task-1");
  assert.equal(task.ownerId, 7);
  assert.equal(task.githubToken, undefined);
  assert.equal(task.credentials, undefined);
  assert.deepEqual(fresh.list(7).map((item) => item.id), ["task-1"]);
  assert.deepEqual(fresh.list(8), []);
  await fs.rm(target.dir, { recursive: true, force: true });
});

test("store keeps task history bounded", async () => {
  const safe = __test.safeRecord({ id: "task-1", events: Array.from({ length: 200 }, (_, i) => ({ id: String(i) })) });
  assert.equal(safe.events.length, 128);
  assert.equal(safe.events[0].id, "72");
});
