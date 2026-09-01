export class ModelError extends Error {
  constructor(message, code = "MODEL_ERROR", details = undefined) {
    super(message);
    this.name = "ModelError";
    this.code = code;
    this.details = details;
  }
}

export function assertModelString(value, name, { maxLength = 256, allowEmpty = false } = {}) {
  if (typeof value !== "string" || (!allowEmpty && value.trim() === "")) {
    throw new ModelError(`${name} must be a non-empty string`, "INVALID_MODEL_INPUT", { name });
  }
  if (value.length > maxLength) {
    throw new ModelError(`${name} exceeds the maximum length`, "MODEL_INPUT_TOO_LARGE", { name, maxLength });
  }
  return value;
}
