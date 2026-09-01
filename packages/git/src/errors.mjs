export class GitOperationError extends Error {
  constructor(message, code = "GIT_OPERATION_FAILED", details = undefined) {
    super(message);
    this.name = "GitOperationError";
    this.code = code;
    this.details = details;
  }
}
