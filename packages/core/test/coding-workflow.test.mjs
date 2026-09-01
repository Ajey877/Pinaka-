import test from "node:test";
import assert from "node:assert/strict";
import { ModelError } from "@pinaka/model";
import { ToolRegistry } from "@pinaka/tools";
import { runCodingTask } from "../src/coding-workflow.mjs";

function makeRegistry() {
  const registry = new ToolRegistry();
  let source = "export const value = 1;\n";
  registry.register("repository.inspect", {
    description: "Return a repository inspection report.",
    run: () => ({ files: ["src/index.js"], languages: { javascript: 1 }, scripts: { test: "npm test" } })
  });
  registry.register("files.read", {
    description: "Read a file.",
    run: () => source
  });
  registry.register("files.write", {
    description: "Write a file.",
    run: ({ content, overwrite = false } = {}) => {
      if (!overwrite) throw Object.assign(new Error("overwrite approval required"), { code: "OVERWRITE_REQUIRED" });
      source = content;
      return { written: true };
    }
  });
  registry.register("terminal.run", {
    description: "Run a verification command.",
    run: ({ executable } = {}) => ({ exitCode: executable === "npm" ? 0 : 1, stdout: "tests passed", stderr: "" })
  });
  return { registry, getSource: () => source };
}

test("runCodingTask inspects, edits, verifies, and returns the model result", async () => {
  const { registry, getSource } = makeRegistry();
  const calls = [];
  let round = 0;
  const router = {
    async chat(request) {
      calls.push(request);
      round += 1;
      if (round === 1) {
        return {
          content: "",
          toolCalls: [
            { id: "read-1", type: "function", function: { name: "files.read", arguments: JSON.stringify({ path: "src/index.js" }) } }
          ]
        };
      }
      if (round === 2) {
        return {
          content: "",
          toolCalls: [
            { id: "write-1", type: "function", function: { name: "files.write", arguments: JSON.stringify({ path: "src/index.js", content: "export const value = 2;\n", overwrite: true }) } }
          ]
        };
      }
      if (round === 3) {
        return {
          content: "",
          toolCalls: [
            { id: "test-1", type: "function", function: { name: "terminal.run", arguments: JSON.stringify({ executable: "npm", args: ["test"] }) } }
          ]
        };
      }
      return { content: "Completed and verified.", toolCalls: [] };
    }
  };

  const result = await runCodingTask({ router, registry, task: "Change value from 1 to 2" });

  assert.equal(result.content, "Completed and verified.");
  assert.equal(round, 4);
  assert.equal(getSource(), "export const value = 2;\n");
  assert.equal(result.repositoryInspection.languages.javascript, 1);
  assert.match(calls[0].messages[1].content, /Change value from 1 to 2/);
  assert.match(calls[0].messages[1].content, /Repository inspection/);
});

test("runCodingTask validates required components", async () => {
  const { registry } = makeRegistry();
  await assert.rejects(
    () => runCodingTask({ registry, task: "x" }),
    (error) => error instanceof ModelError && error.code === "ROUTER_REQUIRED"
  );
  await assert.rejects(
    () => runCodingTask({ router: { chat: async () => ({ content: "ok", toolCalls: [] }) }, task: "x" }),
    (error) => error instanceof ModelError && error.code === "TOOL_REGISTRY_REQUIRED"
  );
});

test("runCodingTask does not hide inspection failures", async () => {
  const registry = new ToolRegistry();
  registry.register("repository.inspect", { run: () => { throw new Error("inspection failed"); } });
  const router = { chat: async () => ({ content: "should not run", toolCalls: [] }) };
  await assert.rejects(() => runCodingTask({ router, registry, task: "x" }), /inspection failed/);
});
