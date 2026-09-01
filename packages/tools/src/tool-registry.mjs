import { ToolError } from "./errors.mjs";

export class ToolRegistry {
  #tools = new Map();

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

  async execute(name, input) {
    return this.get(name).run(input);
  }
}
