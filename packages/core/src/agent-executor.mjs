import { ModelError } from "@pinaka/model";
import { createPlan, normalizeTask } from "./agent-core.mjs";

const MAX_CONTEXT_CHARS = 120_000;

function normalizeContext(repositoryMap) {
  if (repositoryMap === undefined || repositoryMap === null) return null;
  if (!repositoryMap || typeof repositoryMap !== "object" || Array.isArray(repositoryMap)) {
    throw new ModelError("repositoryMap must be an object", "INVALID_REPOSITORY_CONTEXT");
  }
  const json = JSON.stringify(repositoryMap);
  if (json.length > MAX_CONTEXT_CHARS) {
    throw new ModelError("repositoryMap is too large", "REPOSITORY_CONTEXT_TOO_LARGE");
  }
  return repositoryMap;
}

function buildMessages(task, repositoryMap) {
  const normalizedTask = normalizeTask(task);
  const system = [
    "You are Pinaka, a software engineering coding agent.",
    "Inspect before modifying. Prefer minimal, verifiable changes.",
    "Never claim tests passed unless execution results support that claim.",
    "Return a concise implementation-oriented response."
  ].join(" ");

  const user = repositoryMap
    ? `Task:\n${normalizedTask}\n\nRepository inspection:\n${JSON.stringify(repositoryMap)}`
    : `Task:\n${normalizedTask}`;

  return [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
}

export async function runAgentTurn({ router, task, repositoryMap, provider, maxOutputTokens } = {}) {
  if (!router || typeof router.chat !== "function") {
    throw new ModelError("model router is required", "ROUTER_REQUIRED");
  }

  const messages = buildMessages(task, normalizeContext(repositoryMap));
  const response = await router.chat(
    { messages, maxOutputTokens },
    { provider }
  );

  return {
    task: normalizeTask(task),
    plan: createPlan(task),
    response
  };
}
