import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createToolRegistry } from "../src/tool-runtime.mjs";

const roots = [];

async function makeRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pinaka-agent-tools-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

test("agent runtime exposes the protected Git workflow tools", async () => {
  const root = await makeRoot();
  const registry = createToolRegistry({ workspaceRoot: root });
  const names = registry.list().map(({ name }) => name);

  assert.ok(names.includes("git.status"));
  assert.ok(names.includes("git.current_commit"));
  assert.ok(names.includes("git.clone"));
  assert.ok(names.includes("git.create_branch"));
  assert.ok(names.includes("git.assert_clean"));
  assert.ok(names.includes("verification.check_changes"));

  const result = await registry.execute("terminal.run", {
    executable: "git",
    args: ["--version"]
  });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /^git version /);
});

test("agent runtime rejects unsafe change sets before approval", async () => {
  const root = await makeRoot();
  const registry = createToolRegistry({ workspaceRoot: root });

  await assert.rejects(
    () => registry.execute("verification.check_changes", {
      changes: [{ path: ".env", status: "modified", additions: 1 }]
    }),
    (error) => error?.code === "CHANGES_REJECTED"
  );
});

test("agent runtime allows a normal bounded change set", async () => {
  const root = await makeRoot();
  const registry = createToolRegistry({ workspaceRoot: root });

  const result = await registry.execute("verification.check_changes", {
    changes: [{ path: "src/app.mjs", status: "modified", additions: 8, deletions: 2, bytes: 2048 }]
  });

  assert.equal(result.allowed, true);
  assert.equal(result.changedFiles, 1);
  assert.equal(result.additions, 8);
  assert.equal(result.deletions, 2);
});
