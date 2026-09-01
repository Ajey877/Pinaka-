import test from "node:test";
import assert from "node:assert/strict";
import { ModelError } from "@pinaka/model";
import { runAgentTurn } from "../src/agent-executor.mjs";

function fakeRouter() {
  return {
    calls: [],
    async chat(request, options) {
      this.calls.push({ request, options });
      return { content: "mocked response", model: "test-model", id: "test", usage: null };
    }
  };
}

test("runAgentTurn sends task and repository context to the model router", async () => {
  const router = fakeRouter();
  const result = await runAgentTurn({
    router,
    task: "Fix the login bug",
    repositoryMap: { languages: { javascript: 3 }, scripts: { test: "npm test" } },
    provider: "free"
  });

  assert.equal(result.task, "Fix the login bug");
  assert.equal(result.response.content, "mocked response");
  assert.deepEqual(router.calls[0].options, { provider: "free" });
  assert.match(router.calls[0].request.messages[1].content, /Fix the login bug/);
  assert.match(router.calls[0].request.messages[1].content, /repository inspection:/);
});

test("runAgentTurn rejects an oversized repository context", async () => {
  const router = fakeRouter();
  await assert.rejects(
    () => runAgentTurn({ router, task: "inspect", repositoryMap: { data: "x".repeat(120_001) } }),
    (error) => error instanceof ModelError && error.code === "REPOSITORY_CONTEXT_TOO_LARGE"
  );
});

test("runAgentTurn requires a router", async () => {
  await assert.rejects(
    () => runAgentTurn({ task: "inspect" }),
    (error) => error instanceof ModelError && error.code === "ROUTER_REQUIRED"
  );
});
