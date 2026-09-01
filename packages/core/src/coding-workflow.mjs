import { ModelError } from "@pinaka/model";
import { normalizeTask } from "./agent-core.mjs";
import { runToolCallingLoop } from "./tool-loop.mjs";

const DEFAULT_MAX_FILES = 2_000;
const DEFAULT_MAX_ROUNDS = 12;

function validateRegistry(registry) {
  if (!registry || typeof registry.execute !== "function" || typeof registry.definitions !== "function" || typeof registry.has !== "function") {
    throw new ModelError("tool registry is required", "TOOL_REGISTRY_REQUIRED");
  }
  return registry;
}

function validateRouter(router) {
  if (!router || typeof router.chat !== "function") {
    throw new ModelError("model router is required", "ROUTER_REQUIRED");
  }
  return router;
}

function normalizeInspectionOptions(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new ModelError("inspectionOptions must be an object", "INVALID_INSPECTION_OPTIONS");
  }
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  if (!Number.isInteger(maxFiles) || maxFiles <= 0 || maxFiles > 100_000) {
    throw new ModelError("maxFiles must be a positive integer no greater than 100000", "INVALID_INSPECTION_LIMIT");
  }
  return { maxFiles };
}

function buildCodingMessages(task, inspection) {
  const safeTask = normalizeTask(task);
  const system = [
    "You are Pinaka, a careful software engineering coding agent.",
    "The repository has already been inspected. Use tools to inspect relevant files before editing them.",
    "Make the smallest safe change that satisfies the task.",
    "Do not modify unrelated files.",
    "Prefer reading a file before writing it.",
    "Never claim a test passed unless you actually ran it and received a successful result.",
    "After making changes, run the most relevant available verification command.",
    "If a verification command fails, diagnose the failure and fix it before finishing.",
    "Do not expose secrets or copy credential values into files or responses."
  ].join(" ");

  const user = [
    `Task:\n${safeTask}`,
    `Repository inspection:\n${JSON.stringify(inspection)}`,
    "Begin by deciding which files and tools are actually necessary."
  ].join("\n\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
}

export async function runCodingTask({
  registry,
  router,
  task,
  provider,
  maxOutputTokens,
  inspectionOptions,
  maxRounds = DEFAULT_MAX_ROUNDS,
  signal
} = {}) {
  const safeRegistry = validateRegistry(registry);
  const safeRouter = validateRouter(router);
  const safeTask = normalizeTask(task);
  const options = normalizeInspectionOptions(inspectionOptions);

  const inspection = await safeRegistry.execute("repository.inspect", options);
  if (!inspection || typeof inspection !== "object" || Array.isArray(inspection)) {
    throw new ModelError("repository inspection returned invalid data", "INVALID_INSPECTION_RESULT");
  }

  const result = await runToolCallingLoop({
    router: safeRouter,
    registry: safeRegistry,
    messages: buildCodingMessages(safeTask, inspection),
    provider,
    maxOutputTokens,
    maxRounds,
    signal,
    toolChoice: "auto"
  });

  return {
    task: safeTask,
    repositoryInspection: inspection,
    ...result
  };
}
