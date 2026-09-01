import { ModelError } from "@pinaka/model";
import { finalAcceptance, normalizeReviewVerdict } from "@pinaka/review";
import { normalizeTask } from "./agent-core.mjs";

const MAX_REVIEW_DIFF_CHARS = 120_000;
const MAX_TASK_CHARS = 12_000;

function validateRegistry(registry) {
  if (!registry || typeof registry.execute !== "function") {
    throw new ModelError("tool registry is required", "TOOL_REGISTRY_REQUIRED");
  }
  return registry;
}

function validateRouter(router) {
  if (!router || typeof router.chat !== "function") {
    throw new ModelError("review model router is required", "ROUTER_REQUIRED");
  }
  return router;
}

function normalizePatch(value) {
  if (typeof value !== "string") throw new ModelError("review diff must be text", "INVALID_REVIEW_DIFF");
  if (value.length > MAX_REVIEW_DIFF_CHARS) {
    return `${value.slice(0, MAX_REVIEW_DIFF_CHARS)}\n[diff truncated by Pinaka]`;
  }
  return value;
}

function redactSensitive(value) {
  return value
    .replace(/(api[_-]?key|secret|token|password)\s*[:=]\s*[^\s\n]+/gi, "$1=[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]")
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, "[KEY MATERIAL REDACTED]");
}

function parseDiffSummary(diffText) {
  const lines = diffText.split(/\r?\n/);
  const changes = [];
  let current = null;

  const commitCurrent = () => {
    if (!current) return;
    changes.push(current);
    current = null;
  };

  for (const line of lines) {
    if (line.startsWith("diff --git a/") && line.includes(" b/")) {
      commitCurrent();
      const separator = line.indexOf(" b/", 12);
      const path = line.slice(separator + 3).trim();
      current = { path, status: "modified", additions: 0, deletions: 0, bytes: 0 };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("new file mode")) current.status = "added";
    if (line.startsWith("deleted file mode")) current.status = "deleted";
    if (line.startsWith("rename from") || line.startsWith("rename to")) current.status = "renamed";
    if (line.startsWith("+") && !line.startsWith("+++")) current.additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) current.deletions += 1;
  }
  commitCurrent();
  return changes;
}

function parseJsonContent(content) {
  const text = typeof content === "string" ? content.trim() : "";
  if (!text) throw new ModelError("review model returned an empty verdict", "INVALID_REVIEW_VERDICT");

  const candidates = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());

  const objectStart = text.indexOf("{");
  const objectEnd = text.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) candidates.push(text.slice(objectStart, objectEnd + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next bounded candidate.
    }
  }
  throw new ModelError("review model returned invalid JSON", "INVALID_REVIEW_VERDICT");
}

function buildReviewMessages(task, diff, verification, safety) {
  return [
    {
      role: "system",
      content: [
        "You are Pinaka's independent final code reviewer.",
        "Review only; do not edit files and do not request tools.",
        "Judge whether the change satisfies the task, is technically coherent, avoids obvious regressions, and does not contain high-severity security or correctness problems.",
        "Treat passing automated verification as evidence, not proof.",
        "Return JSON only with this shape: {\"approved\":boolean,\"confidence\":number,\"summary\":string,\"findings\":[{\"severity\":\"critical|high|medium|low|info\",\"title\":string,\"detail\":string,\"path\":string|null}]}",
        "Reject when the task is not actually satisfied or a critical/high finding exists."
      ].join(" ")
    },
    {
      role: "user",
      content: [
        `Task:\n${task.slice(0, MAX_TASK_CHARS)}`,
        `Change diff:\n${redactSensitive(diff)}`,
        `Verification:\n${JSON.stringify(verification)}`,
        `Safety report:\n${JSON.stringify(safety)}`
      ].join("\n\n")
    }
  ];
}

export async function runFinalReview({ registry, router, task, verification, safety, signal } = {}) {
  validateRegistry(registry);
  const safeRouter = validateRouter(router);
  const safeTask = normalizeTask(task);

  const diffResult = await registry.execute("git.diff", { staged: false, maxOutputBytes: 512 * 1024 });
  const diff = normalizePatch(diffResult?.text);
  const derivedChanges = parseDiffSummary(diff);
  const safeReport = safety || await registry.execute("verification.check_changes", { changes: derivedChanges });

  const response = await safeRouter.chat({
    messages: buildReviewMessages(safeTask, diff, verification, safeReport),
    tools: [],
    toolChoice: "none",
    signal,
    maxOutputTokens: 4_096
  });

  const verdict = normalizeReviewVerdict(parseJsonContent(response?.content));
  const acceptance = finalAcceptance({ verification, safety: safeReport, review: verdict });

  return {
    accepted: acceptance.accepted,
    blockers: acceptance.blockers,
    verdict,
    safety: safeReport,
    diff: {
      truncated: diffResult?.truncated === true,
      changeCount: derivedChanges.length
    }
  };
}
