import test from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "../src/tool-registry.mjs";


test("tool registry exposes OpenAI-compatible function definitions", () => {
  const registry = new ToolRegistry();
  registry.register("files.read", {
    description: "Read a file.",
    run: () => "ok"
  });

  assert.deepEqual(registry.definitions(), [{
    type: "function",
    function: {
      name: "files.read",
      description: "Read a file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          maxBytes: { type: "integer", minimum: 1 }
        },
        required: ["path"],
        additionalProperties: false
      }
    }
  }]);
});
