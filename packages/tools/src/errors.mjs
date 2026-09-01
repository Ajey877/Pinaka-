export class ToolError extends Error {
  constructor(message, code = "TOOL_ERROR", details = undefined) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.details = details;
  }
}

export function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ToolError(`${name} must be a positive integer`, "INVALID_ARGUMENT");
  }
  return value;
}
