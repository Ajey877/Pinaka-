import test from "node:test";
import assert from "node:assert/strict";
import { ModelError } from "@pinaka/model";
import { runInspectedAgentTurn } from "../src/agent-workflow.mjs";

function fakeRegistry() {
  return {
    calls: [],
    async execute(name, input) {
      this.calls.push({ name, input });
      return {
        fileCount: 2,
        truncated: false,
        files: ["package.json", "src/index.js"],
        languages: { javascript: 1 },
        manifests: ["package.json"],
        ecosystems: ["node"],
        scripts: { test: "npm test" }
      };
    }
  };
}

function fakeRouter() {
  return {
    calls: [],
    async chat(request, options) {
      this.calls.push({ request, options });
      return { content: "plan", model: "test-model", id: "test", usage: null };
    }
  };
}

test("runInspectedAgentTurn inspects once and feeds the result to the model", async () => {
  const registry = fakeRegistry();
  const router = fakeRouter();

  const result = await runInspectedAgentTurn({
    registry,
    router,
    task: "Add login validation",
    provider: "free",
    inspectionOptions: { maxFiles: 100 }
  });

  assert.equal(registry.calls.length, 1);
  assert.deepEqual(registry.calls[0], { name: "repository.inspect", input: { maxFiles: 100 } });
  assert.equal(router.calls.length, 1);
  assert.match(router.calls[0].request.messages[1].content, /Add login validation/);
  assert.match(router.calls[0].request.messages[1].content, /src\/index\.js/);
  assert.deepEqual(result.repositoryInspection.files, ["package.json", "src/index.js"]);
  assert.equal(result.response.content, "plan");
});

test("runInspectedAgentTurn rejects an invalid tool registry", async () => {
  await assert.rejects(
    () => runInspectedAgentTurn({ router: fakeRouter(), task: "inspect" }),
    (error) => error instanceof ModelError && error.code === "TOOL_REGISTRY_REQUIRED"
  );
});

test("runInspectedAgentTurn rejects invalid inspection options", async () => {
  await assert.rejects(
    () => runInspectedAgentTurn({ registry: fakeRegistry(), router: fakeRouter(), task: "inspect", inspectionOptions: { maxFiles: 0 } }),
    (error) => error instanceof ModelError && error.code === "INVALID_INSPECTION_LIMIT"
  );
});

test("runInspectedAgentTurn rejects invalid inspection results", async () => {
  const registry = { execute: async () => null };
  await assert.rejects(
    () => runInspectedAgentTurn({ registry, router: fakeRouter(), task: "inspect" }),
    (error) => error instanceof ModelError && error.code === "INVALID_INSPECTION_RESULT"
  );
});
