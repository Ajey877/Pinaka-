import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GitOperationError, GitRepository } from "../src/index.mjs";
import { runCommand } from "@pinaka/tools";

const roots = [];

async function makeRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pinaka-git-"));
  roots.push(root);
  return root;
}

async function git(root, args) {
  return runCommand({
    workspaceRoot: root,
    executable: "git",
    args,
    timeoutMs: 10_000,
    maxOutputBytes: 64 * 1024
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

test("status reports a clean initialized repository", async () => {
  const root = await makeRoot();
  assert.equal((await git(root, ["init", "-q"])).exitCode, 0);
  const repo = new GitRepository({ workspaceRoot: root });

  const status = await repo.status();
  assert.equal(status.clean, true);
  assert.equal(status.branch, "HEAD");
});

test("createBranch refuses dirty workspaces and creates a safe task branch", async () => {
  const root = await makeRoot();
  await git(root, ["init", "-q"]);
  await git(root, ["config", "user.name", "Pinaka Test"]);
  await git(root, ["config", "user.email", "pinaka@example.invalid"]);
  await fs.writeFile(path.join(root, "README.md"), "test\n");
  await git(root, ["add", "README.md"]);
  assert.equal((await git(root, ["commit", "-m", "initial"])).exitCode, 0);

  const repo = new GitRepository({ workspaceRoot: root });
  const branch = await repo.createBranch("agent/task-123");
  assert.equal(branch.branch, "agent/task-123");
  assert.equal(branch.clean, true);

  await fs.writeFile(path.join(root, "README.md"), "changed\n");
  await assert.rejects(
    () => repo.createBranch("agent/second"),
    (error) => error instanceof GitOperationError && error.code === "WORKSPACE_DIRTY"
  );
});

test("currentCommit returns the repository HEAD", async () => {
  const root = await makeRoot();
  await git(root, ["init", "-q"]);
  await git(root, ["config", "user.name", "Pinaka Test"]);
  await git(root, ["config", "user.email", "pinaka@example.invalid"]);
  await fs.writeFile(path.join(root, "file.txt"), "hello\n");
  await git(root, ["add", "file.txt"]);
  assert.equal((await git(root, ["commit", "-m", "initial"])).exitCode, 0);

  const repo = new GitRepository({ workspaceRoot: root });
  const commit = await repo.currentCommit();
  assert.match(commit, /^[0-9a-f]{40}$/i);
});

test("clone accepts only HTTPS GitHub repository URLs", async () => {
  const root = await makeRoot();
  const repo = new GitRepository({ workspaceRoot: root });

  await assert.rejects(
    () => repo.clone("file:///tmp/repo.git"),
    (error) => error instanceof GitOperationError && error.code === "INVALID_REPOSITORY_URL"
  );
});

test("assertClean rejects uncommitted changes", async () => {
  const root = await makeRoot();
  await git(root, ["init", "-q"]);
  await git(root, ["config", "user.name", "Pinaka Test"]);
  await git(root, ["config", "user.email", "pinaka@example.invalid"]);
  await fs.writeFile(path.join(root, "file.txt"), "hello\n");
  await git(root, ["add", "file.txt"]);
  await git(root, ["commit", "-m", "initial"]);
  await fs.writeFile(path.join(root, "file.txt"), "dirty\n");

  const repo = new GitRepository({ workspaceRoot: root });
  await assert.rejects(
    () => repo.assertClean(),
    (error) => error instanceof GitOperationError && error.code === "WORKSPACE_DIRTY"
  );
});
