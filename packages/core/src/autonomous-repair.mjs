import { ModelError } from "@pinaka/model";
import { normalizeTask } from "./agent-core.mjs";
import { runCodingTask } from "./coding-workflow.mjs";
import { runFinalReview } from "./final-review.mjs";
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

async function runVerification(registry, inspection, timeoutMs, onEvent) {
  onEvent?.({ type: "verification.start" });
  const result = normalizeVerificationResult(await registry.execute("verification.run_checks", {
    inspection,
    timeoutMs,
    continueOnFailure: false
  }));
  onEvent?.({
    type: "verification.complete",
    passed: result.passed === true,
    checksPlanned: result.checksPlanned || 0,
    checksRun: result.checksRun || 0
  });
  return result;
}

async function finishWithReview({ registry, router, reviewRouter, task, codingResult, verification, signal, onEvent }) {
  onEvent?.({ type: "review.start" });
  const review = await runFinalReview({
    registry,
    router: reviewRouter || router,
    task,
    verification,
    signal
  });
  onEvent?.({
    type: "review.complete",
    accepted: review.accepted === true,
    findings: Array.isArray(review.verdict?.findings) ? review.verdict.findings.length : 0,
    blockers: Array.isArray(review.blockers) ? review.blockers.length : 0
  });
  return {
    ...codingResult,
    verification,
    finalReview: review,
    status: review.accepted ? "accepted" : "review_rejected"
  };
}

export async function runAutonomousRepairLoop({
  registry,
  router,
  reviewRouter,
  task,
  provider,
  maxOutputTokens,
  inspectionOptions,
  maxRounds,
  maxRepairAttempts = DEFAULT_MAX_REPAIR_ATTEMPTS,
  verificationTimeoutMs,
  signal,
  onEvent
} = {}) {
  const safeRegistry = validateRegistry(registry);
  const safeRouter = validateRouter(router);
  if (reviewRouter !== undefined) validateRouter(reviewRouter);
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
    verificationTimeoutMs,
    onEvent
  );
  const attempts = [];

  if (verification.checksPlanned === 0) {
    onEvent?.({ type: "task.unverified" });
    return {
      ...codingResult,
      verification,
      repairAttempts: attempts,
      status: "unverified"
    };
  }

  if (verification.passed) {
    return finishWithReview({
      registry: safeRegistry,
      router: safeRouter,
      reviewRouter,
      task: safeTask,
      codingResult: { ...codingResult, repairAttempts: attempts },
      verification,
      signal,
      onEvent
    });
  }

  for (let attempt = 1; attempt <= repairAttempts; attempt += 1) {
    onEvent?.({ type: "repair.start", attempt });
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
    onEvent?.({ type: "repair.complete", attempt, rounds: repairResult.rounds, toolCalls: repairResult.toolCalls });

    verification = await runVerification(
      safeRegistry,
      codingResult.repositoryInspection,
      verificationTimeoutMs,
      onEvent
    );

    attempts.push({
      attempt,
      repair: repairResult,
      verification
    });

    if (verification.passed) {
      return finishWithReview({
        registry: safeRegistry,
        router: safeRouter,
        reviewRouter,
        task: safeTask,
        codingResult: { ...codingResult, repairAttempts: attempts },
        verification,
        signal,
        onEvent
      });
    }
  }

  onEvent?.({ type: "task.failed", reason: "repair_budget_exhausted" });
  return {
    ...codingResult,
    verification,
    repairAttempts: attempts,
    status: "failed"
  };
}
