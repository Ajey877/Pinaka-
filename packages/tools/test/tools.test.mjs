import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  GitHubClient,
  ToolError,
  ToolRegistry,
  listFiles,
  readTextFile,
  resolveSafePath,
  runCommand,
  writeTextFile
} from "../src/index.mjs";

const tempDirectories = [];

async function makeWorkspace() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pinaka-tools-"));
  tempDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

test("resolveSafePath keeps paths inside workspace", () => {
  const root = path.join(os.tmpdir(), "pinaka-root");
  assert.equal(resolveSafePath(root, "src/index.js"), path.join(root, "src", "index.js"));
  assert.throws(() => resolveSafePath(root, "../secret.txt"), (error) => {
    assert.ok(error instanceof ToolError);
    assert.equal(error.code, "PATH_OUTSIDE_WORKSPACE");
    return true;
  });
});

test("file tools read, list, and refuse accidental overwrite", async () => {
  const workspace = await makeWorkspace();
  await writeTextFile(workspace, "src/example.txt", "hello");
  assert.equal(await readTextFile(workspace, "src/example.txt"), "hello");
  assert.deepEqual(await listFiles(workspace, "src"), [{ name: "example.txt", type: "file" }]);
  await assert.rejects(
    () => writeTextFile(workspace, "src/example.txt", "changed"),
    (error) => error instanceof ToolError && error.code === "FILE_EXISTS"
  );
  await writeTextFile(workspace, "src/example.txt", "changed", { overwrite: true });
  assert.equal(await readTextFile(workspace, "src/example.txt"), "changed");
});

test("file tools block oversized reads and writes", async () => {
  const workspace = await makeWorkspace();
  await assert.rejects(
    () => writeTextFile(workspace, "large.txt", "12345", { maxBytes: 4 }),
    (error) => error instanceof ToolError && error.code === "FILE_TOO_LARGE"
  );
  await fs.writeFile(path.join(workspace, "large.txt"), "12345");
  await assert.rejects(
    () => readTextFile(workspace, "large.txt", { maxBytes: 4 }),
    (error) => error instanceof ToolError && error.code === "FILE_TOO_LARGE"
  );
});

test("shell tool runs an allowed command without a shell", async () => {
  const workspace = await makeWorkspace();
  const result = await runCommand({
    workspaceRoot: workspace,
    executable: "node",
    args: ["--version"],
    timeoutMs: 5_000
  });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /^v\d+/);
});

test("shell tool rejects non-allowlisted and node eval commands", async () => {
  const workspace = await makeWorkspace();
  await assert.rejects(
    () => runCommand({ workspaceRoot: workspace, executable: "sh", args: ["-c", "echo unsafe"] }),
    (error) => error instanceof ToolError && error.code === "COMMAND_NOT_ALLOWED"
  );
  await assert.rejects(
    () => runCommand({ workspaceRoot: workspace, executable: "node", args: ["--eval", "console.log('unsafe')"] }),
    (error) => error instanceof ToolError && error.code === "COMMAND_NOT_ALLOWED"
  );
});

test("tool registry validates registration and execution", async () => {
  const registry = new ToolRegistry();
  registry.register("files.read", {
    description: "read a value",
    run: async (input) => input.value
  });
  assert.deepEqual(registry.list(), [{ name: "files.read", description: "read a value" }]);
  assert.equal(await registry.execute("files.read", { value: "ok" }), "ok");
  assert.throws(() => registry.register("files.read", { run: () => null }), /already registered/);
  assert.throws(() => registry.get("missing"), /unknown tool/);
});

test("tool registry emits safe start and finish events", async () => {
  const events = [];
  const registry = new ToolRegistry({ onEvent: (event) => events.push(event) });
  registry.register("files.read", { run: async () => ({ secret: "hidden", ok: true }) });

  await registry.execute("files.read", { secret: "do not emit" });

  assert.equal(events.length, 2);
  assert.equal(events[0].type, "tool.start");
  assert.equal(events[0].tool, "files.read");
  assert.equal(events[1].type, "tool.finish");
  assert.equal(events[1].ok, true);
  assert.equal(events[1].result.type, "object");
  assert.deepEqual(events[1].result.keys, ["secret", "ok"]);
  assert.equal(Object.prototype.hasOwnProperty.call(events[0], "input"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(events[1], "output"), false);
});

test("tool registry emits a bounded error event for failed execution", async () => {
  const events = [];
  const registry = new ToolRegistry({ onEvent: (event) => events.push(event) });
  registry.register("files.read", {
    run: async () => { throw Object.assign(new Error("boom"), { code: "BOOM" }); }
  });

  await assert.rejects(() => registry.execute("files.read", {}));

  assert.equal(events.length, 2);
  assert.equal(events[1].type, "tool.finish");
  assert.equal(events[1].ok, false);
  assert.equal(events[1].errorCode, "BOOM");
  assert.equal(Object.prototype.hasOwnProperty.call(events[1], "error"), false);
});

test("GitHub client validates repository and content paths", async () => {
  const client = new GitHubClient({ apiBase: "https://api.github.com", token: "test-token" });
  assert.equal(client.apiBase, "https://api.github.com");
  await assert.rejects(
    () => client.getRepository("owner/evil", "repo"),
    (error) => error instanceof ToolError && error.code === "INVALID_ARGUMENT"
  );
  await assert.rejects(
    () => client.getContents("owner", "repo", "src/../secret"),
    (error) => error instanceof ToolError && error.code === "INVALID_ARGUMENT"
  );
});
