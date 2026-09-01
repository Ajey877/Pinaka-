export class WorkspaceError extends Error {
  constructor(message, code = "WORKSPACE_ERROR", details = undefined) {
    super(message);
    this.name = "WorkspaceError";
    this.code = code;
    this.details = details;
  }
}
