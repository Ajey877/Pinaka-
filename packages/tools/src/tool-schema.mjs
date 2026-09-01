export const EMPTY_OBJECT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false
});

export const TOOL_SCHEMAS = Object.freeze({
  "files.list": {
    type: "object",
    properties: {
      relativeDirectory: { type: "string" }
    },
    additionalProperties: false
  },
  "files.read": {
    type: "object",
    properties: {
      path: { type: "string" },
      maxBytes: { type: "integer", minimum: 1 }
    },
    required: ["path"],
    additionalProperties: false
  },
  "files.write": {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
      overwrite: { type: "boolean" },
      maxBytes: { type: "integer", minimum: 1 }
    },
    required: ["path", "content"],
    additionalProperties: false
  },
  "terminal.run": {
    type: "object",
    properties: {
      executable: { type: "string" },
      args: { type: "array", items: { type: "string" } },
      cwd: { type: "string" },
      timeoutMs: { type: "integer", minimum: 1 },
      maxOutputBytes: { type: "integer", minimum: 1 }
    },
    required: ["executable"],
    additionalProperties: false
  },
  "git.status": EMPTY_OBJECT_SCHEMA,
  "git.current_commit": EMPTY_OBJECT_SCHEMA,
  "git.diff": {
    type: "object",
    properties: {
      staged: { type: "boolean" },
      maxOutputBytes: { type: "integer", minimum: 1, maximum: 524288 }
    },
    additionalProperties: false
  },
  "git.clone": {
    type: "object",
    properties: {
      repositoryUrl: { type: "string" }
    },
    required: ["repositoryUrl"],
    additionalProperties: false
  },
  "git.create_branch": {
    type: "object",
    properties: {
      branchName: { type: "string" }
    },
    required: ["branchName"],
    additionalProperties: false
  },
  "git.assert_clean": EMPTY_OBJECT_SCHEMA,
  "repository.inspect": {
    type: "object",
    properties: {
      maxFiles: { type: "integer", minimum: 1, maximum: 100000 }
    },
    additionalProperties: false
  },
  "verification.check_changes": {
    type: "object",
    properties: {
      changes: { type: "array", items: { type: "object" } },
      maxChangedFiles: { type: "integer", minimum: 0 },
      maxAddedLines: { type: "integer", minimum: 0 },
      maxDeletedLines: { type: "integer", minimum: 0 },
      maxFileBytes: { type: "integer", minimum: 0 }
    },
    required: ["changes"],
    additionalProperties: false
  },
  "verification.run_checks": {
    type: "object",
    properties: {
      inspection: { type: "object" },
      timeoutMs: { type: "integer", minimum: 1000, maximum: 600000 },
      continueOnFailure: { type: "boolean" }
    },
    required: ["inspection"],
    additionalProperties: false
  },
  "github.repository": {
    type: "object",
    properties: {
      owner: { type: "string" },
      repo: { type: "string" }
    },
    required: ["owner", "repo"],
    additionalProperties: false
  },
  "github.contents": {
    type: "object",
    properties: {
      owner: { type: "string" },
      repo: { type: "string" },
      path: { type: "string" },
      ref: { type: "string" }
    },
    required: ["owner", "repo"],
    additionalProperties: false
  }
});

export function getToolSchema(name) {
  return TOOL_SCHEMAS[name] || EMPTY_OBJECT_SCHEMA;
}
