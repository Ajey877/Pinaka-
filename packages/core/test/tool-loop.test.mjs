import test from "node:test";
import assert from "node:assert/strict";
import { ModelError } from "@pinaka/model";
import { ToolRegistry } from "@pinaka/tools";
import { runToolCallingLoop } from "../src/tool-loop.mjs";

function registryWithEcho() {
  const registry = new ToolRegistry();
  registry.register("test.echo", {
    description: "Echo test input.",
    schema: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false
    },
    run: ({ value }) => ({ echoed: value })
  });
  return registry;
}

test("tool-calling loop executes model-requested tools and returns the final response", async () => {
  const registry = registryWithEcho();
  const calls = [];
  let round = 0;
  const router = {
    async chat(request, options) {
      calls.push({ request, options });
      round += 1;
      if (round === 1) {
        return {
          content: "",
          toolCalls: [{ id: "call-1", type: "function", function: { name: "test.echo", arguments: JSON.stringify({ value: "hello" }) } }],
          model: "test-model"
        };
      }
      return { content: "Done.", toolCalls: [], model: "test-model" };
    }
  };

  const result = await runToolCallingLoop({
    router,
    registry,
    messages: [{ role: "user", content: "Echo hello." }],
    provider: "free"
  });

  assert.equal(result.content, "Done.");
  assert.equal(result.rounds, 2);
  assert.equal(result.toolCalls, 1);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].request.tools.some((tool) => tool.function.name === "test.echo"));
  assert.equal(calls[1].request.messages.at(-1).role, "tool");
  assert.equal(calls[1].request.messages.at(-1).tool_call_id, "call-1");
  assert.equal(calls[1].request.messages.at(-1).content, '{"echoed":"hello"}');
  assert.deepEqual(calls[0].options, { provider: "free" });
});

test("tool-calling loop converts tool failures into tool results", async () => {
  const registry = new ToolRegistry();
  registry.register("test.fail", {
    description: "Always fails.",
    run: () => {
      const error = new Error("expected failure");
      error.code = "EXPECTED_FAILURE";
      throw error;
    }
  });
  let calls = 0;
  const router = {
    async chat(request) {
      calls += 1;
      if (calls === 1) {
        return { content: "", toolCalls: [{ id: "call-fail", type: "function", function: { name: "test.fail", arguments: "{}" } }] };
      }
      return { content: request.messages.at(-1).content, toolCalls: [] };
    }
  };

  const result = await runToolCallingLoop({
    router,
    registry,
    messages: [{ role: "user", content: "Run it." }]
  });

  assert.match(result.content, /expected failure/);
  assert.match(result.content, /EXPECTED_FAILURE/);
});

test("tool-calling loop rejects malformed or unknown tool calls", async () => {
  const registry = registryWithEcho();
  const unknownRouter = { async chat() {
    return { content: "", toolCalls: [{ id: "call-1", type: "function", function: { name: "missing", arguments: "{}" } }] };
  } };
  await assert.rejects(
    () => runToolCallingLoop({ router: unknownRouter, registry, messages: [{ role: "user", content: "x" }] }),
    (error) => error instanceof ModelError && error.code === "UNKNOWN_TOOL_REQUESTED"
  );

  const badJsonRouter = { async chat() {
    return { content: "", toolCalls: [{ id: "call-2", type: "function", function: { name: "test.echo", arguments: "not-json" } }] };
  } };
  await assert.rejects(
    () => runToolCallingLoop({ router: badJsonRouter, registry, messages: [{ role: "user", content: "x" }] }),
    (error) => error instanceof ModelError && error.code === "INVALID_TOOL_ARGUMENTS"
  );
});

test("tool-calling loop enforces the round budget", async () => {
  const registry = registryWithEcho();
  const router = {
    async chat() {
      return { content: "", toolCalls: [{ id: `call-${Math.random()}`, type: "function", function: { name: "test.echo", arguments: '{"value":"x"}' } }] };
    }
  };
  await assert.rejects(
    () => runToolCallingLoop({ router, registry, messages: [{ role: "user", content: "loop" }], maxRounds: 2 }),
    (error) => error instanceof ModelError && error.code === "AGENT_ROUND_LIMIT"
  );
});
