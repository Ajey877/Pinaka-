import { ToolError } from "./errors.mjs";
import { getToolSchema } from "./tool-schema.mjs";

function summarizeResult(value) {
  if (value === null || value === undefined) return { type: "null" };
  if (Array.isArray(value)) return { type: "array", count: value.length };
  if (typeof value === "string") return { type: "string", chars: value.length };
  if (typeof value !== "object") return { type: typeof value };
  return { type: "object", keys: Object.keys(value).slice(0, 16) };
}

export class ToolRegistry {
  #tools = new Map();
  #onEvent;

  constructor({ onEvent } = {}) {
    if (onEvent !== undefined && typeof onEvent !== "function") {
      throw new ToolError("onEvent must be a function", "INVALID_ARGUMENT");
    }
    this.#onEvent = onEvent || null;
  }

  register(name, definition) {
    if (typeof name !== "string" || !/^[a-z][a-z0-9_.-]{1,63}$/.test(name)) {
      throw new ToolError("tool name is invalid", "INVALID_ARGUMENT");
    }
    if (!definition || typeof definition !== "object" || typeof definition.run !== "function") {
      throw new ToolError("tool definition must provide a run function", "INVALID_ARGUMENT");
    }
    if (this.#tools.has(name)) {
      throw new ToolError(`tool already registered: ${name}`, "TOOL_ALREADY_REGISTERED");
    }

    this.#tools.set(name, Object.freeze({
      name,
      description: typeof definition.description === "string" ? definition.description : "",
      schema: definition.schema || getToolSchema(name),
      run: definition.run
    }));
    return this;
  }

  has(name) {
    return this.#tools.has(name);
  }

  get(name) {
    const tool = this.#tools.get(name);
    if (!tool) throw new ToolError(`unknown tool: ${name}`, "UNKNOWN_TOOL");
    return tool;
  }

  list() {
    return [...this.#tools.values()].map(({ name, description }) => ({ name, description }));
  }

  definitions() {
    return [...this.#tools.values()].map(({ name, description, schema }) => ({
      type: "function",
      function: {
        name,
        description,
        parameters: schema
      }
    }));
  }

  async execute(name, input) {
    const tool = this.get(name);
    const startedAt = Date.now();
    this.#onEvent?.({
      type: "tool.start",
      tool: name,
      timestamp: new Date().toISOString()
    });

    try {
      const result = await tool.run(input);
      this.#onEvent?.({
        type: "tool.finish",
        tool: name,
        durationMs: Date.now() - startedAt,
        ok: true,
        result: summarizeResult(result),
        timestamp: new Date().toISOString()
      });
      return result;
    } catch (error) {
      this.#onEvent?.({
        type: "tool.finish",
        tool: name,
        durationMs: Date.now() - startedAt,
        ok: false,
        errorCode: error?.code || "TOOL_EXECUTION_FAILED",
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }
}
