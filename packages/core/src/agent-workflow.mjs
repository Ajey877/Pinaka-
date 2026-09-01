import { ModelError } from "@pinaka/model";
import { normalizeTask } from "./agent-core.mjs";
import { runAgentTurn } from "./agent-executor.mjs";

const DEFAULT_MAX_FILES = 2_000;

function validateRegistry(registry) {
  if (!registry || typeof registry.execute !== "function") {
    throw new ModelError("tool registry is required", "TOOL_REGISTRY_REQUIRED");
  }
  return registry;
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

export async function runInspectedAgentTurn({ registry, router, task, provider, maxOutputTokens, inspectionOptions } = {}) {
  const safeRegistry = validateRegistry(registry);
  const safeTask = normalizeTask(task);
  const options = normalizeInspectionOptions(inspectionOptions);

  const inspection = await safeRegistry.execute("repository.inspect", options);
  if (!inspection || typeof inspection !== "object" || Array.isArray(inspection)) {
    throw new ModelError("repository inspection returned invalid data", "INVALID_INSPECTION_RESULT");
  }

  const turn = await runAgentTurn({
    router,
    task: safeTask,
    repositoryMap: inspection,
    provider,
    maxOutputTokens
  });

  return {
    ...turn,
    repositoryInspection: inspection
  };
}
