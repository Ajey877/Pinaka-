import { ModelError } from "@pinaka/model";
import { normalizeTask } from "./agent-core.mjs";
import { runCodingTask } from "./coding-workflow.mjs";
import { runToolCallingLoop } from "./tool-loop.mjs";

const DEFAULT_MAX_REPAIR_ATTEMPTS = 3;
const MAX_REPAIR_ATTEMPTS = 8;
const MAX_FAILURE_CONTEXT_CHARS = 60_000;

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

function validateRepairAttempts(value) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_REPAIR_ATTEMPTS) {
    throw new ModelError(
      `maxRepairAttempts must be an integer between 0 and ${MAX_REPAIR_ATTEMPTS}`,
      "INVALID_REPAIR_ATTEMPTS",
      { value, max: MAX_REPAIR_ATTEMPTS }
    );
  }
  return value;
}

function normalizeVerificationResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new ModelError("verification returned invalid data", "INVALID_VERIFICATION_RESULT");
  }
  return result;
}

function formatFailureContext(verification) {
  const text = JSON.stringify(verification);
  if (text.length <= MAX_FAILURE_CONTEXT_CHARS) return text;
  return `${text.slice(0, MAX_FAILURE_CONTEXT_CHARS)}\n[verification context truncated by Pinaka]`;
}

function buildRepairMessages(task, verification, attempt) {
  return [
    {
      role: "system",
      content: [
        "You are Pinaka performing a targeted repair pass on a coding task.",
        "A previous implementation did not pass repository verification.",
        "Inspect the relevant files and failure output with tools before editing.",
        "Fix the root cause, not just the symptom.",
        "Keep the change as small as possible and do not modify unrelated files.",
        "Do not change protected workflow or credential files.",
        "Run the most relevant verification checks after making the fix.",
        `This is repair attempt ${attempt}.`
      ].join(" ")
    },
    {
      role: "user",
      content: [
        `Original task:\n${task}`,
        `Verification failure:\n${formatFailureContext(verification)}`,
        "Use the available tools to inspect, diagnose, fix, and verify the failure."
      ].join("\n\n")
    }
  ];
}

async function runVerification(registry, inspection, timeoutMs) {
  return normalizeVerificationResult(await registry.execute("verification.run_checks", {
    inspection,
    timeoutMs,
    continueOnFailure: false
  }));
}

export async function runAutonomousRepairLoop({
  registry,
  router,
  task,
  provider,
  maxOutputTokens,
  inspectionOptions,
  maxRounds,
  maxRepairAttempts = DEFAULT_MAX_REPAIR_ATTEMPTS,
  verificationTimeoutMs,
  signal
} = {}) {
  const safeRegistry = validateRegistry(registry);
  const safeRouter = validateRouter(router);
  const safeTask = normalizeTask(task);
  const repairAttempts = validateRepairAttempts(maxRepairAttempts);

  const codingResult = await runCodingTask({
    registry: safeRegistry,
    router: safeRouter,
    task: safeTask,
    provider,
    maxOutputTokens,
    inspectionOptions,
    maxRounds,
    signal
  });

  let verification = await runVerification(
    safeRegistry,
    codingResult.repositoryInspection,
    verificationTimeoutMs
  );
  const attempts = [];

  if (verification.checksPlanned === 0) {
    return {
      ...codingResult,
      verification,
      repairAttempts: attempts,
      status: "unverified"
    };
  }

  if (verification.passed) {
    return {
      ...codingResult,
      verification,
      repairAttempts: attempts,
      status: "passed"
    };
  }

  for (let attempt = 1; attempt <= repairAttempts; attempt += 1) {
    const repairResult = await runToolCallingLoop({
      router: safeRouter,
      registry: safeRegistry,
      messages: buildRepairMessages(safeTask, verification, attempt),
      provider,
      maxOutputTokens,
      maxRounds,
      signal,
      toolChoice: "auto"
    });

    verification = await runVerification(
      safeRegistry,
      codingResult.repositoryInspection,
      verificationTimeoutMs
    );

    attempts.push({
      attempt,
      repair: repairResult,
      verification
    });

    if (verification.passed) {
      return {
        ...codingResult,
        verification,
        repairAttempts: attempts,
        status: "repaired"
      };
    }
  }

  return {
    ...codingResult,
    verification,
    repairAttempts: attempts,
    status: "failed"
  };
}
