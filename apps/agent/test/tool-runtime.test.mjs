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
  assert.ok(names.includes("verification.run_checks"));

  const result = await registry.execute("terminal.run", {
    executable: "git",
    args: ["--version"]
  });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /^git version /);
});

test("verification.run_checks executes discovered checks through the controlled command runner", async () => {
  const root = await makeRoot();
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
    scripts: { test: "node test.js", lint: "node lint.js" }
  }));
  await fs.writeFile(path.join(root, "test.js"), "console.log('test ok')\n");
  await fs.writeFile(path.join(root, "lint.js"), "console.log('lint ok')\n");
  const registry = createToolRegistry({ workspaceRoot: root });
  const inspection = {
    ecosystems: ["node"],
    scripts: { test: "node test.js", lint: "node lint.js" }
  };

  const result = await registry.execute("verification.run_checks", { inspection });
  assert.equal(result.passed, true);
  assert.equal(result.checksRun, 2);
  assert.deepEqual(result.results.map(({ name, passed }) => ({ name, passed })), [
    { name: "test", passed: true },
    { name: "lint", passed: true }
  ]);
});
