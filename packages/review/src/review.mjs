import { ReviewError } from "./errors.mjs";

const MAX_SUMMARY_CHARS = 8_000;
const MAX_FINDINGS = 32;

function requireObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReviewError(`${name} must be an object`, "INVALID_REVIEW_INPUT");
  }
  return value;
}

function normalizeString(value, name, max = MAX_SUMMARY_CHARS) {
  if (typeof value !== "string" || value.length > max) {
    throw new ReviewError(`${name} must be a string no longer than ${max} characters`, "INVALID_REVIEW_FIELD");
  }
  return value;
}

function normalizeFindings(findings) {
  if (!Array.isArray(findings) || findings.length > MAX_FINDINGS) {
    throw new ReviewError(`findings must be an array with at most ${MAX_FINDINGS} entries`, "INVALID_REVIEW_FINDINGS");
  }
  return findings.map((finding, index) => {
    requireObject(finding, `findings[${index}]`);
    const severity = finding.severity || "info";
    if (!["critical", "high", "medium", "low", "info"].includes(severity)) {
      throw new ReviewError("finding severity is invalid", "INVALID_REVIEW_FINDING", { index });
    }
    return {
      severity,
      title: normalizeString(finding.title || "", "finding title", 1_000),
      detail: normalizeString(finding.detail || "", "finding detail", 4_000),
      path: typeof finding.path === "string" ? finding.path.slice(0, 1_024) : null
    };
  });
}

export function normalizeReviewVerdict(value) {
  requireObject(value, "review verdict");
  if (typeof value.approved !== "boolean") {
    throw new ReviewError("review verdict approved must be boolean", "INVALID_REVIEW_VERDICT");
  }
  if (typeof value.confidence !== "number" || value.confidence < 0 || value.confidence > 1) {
    throw new ReviewError("review confidence must be between 0 and 1", "INVALID_REVIEW_VERDICT");
  }
  return {
    approved: value.approved,
    confidence: value.confidence,
    summary: normalizeString(value.summary || "", "review summary"),
    findings: normalizeFindings(value.findings || [])
  };
}

export function finalAcceptance({ verification, safety, review }) {
  requireObject(verification, "verification");
  requireObject(safety, "safety");
  const normalizedReview = normalizeReviewVerdict(review);

  const blockers = [];
  if (verification.passed !== true) blockers.push("verification_failed");
  if (safety.allowed !== true) blockers.push("change_safety_failed");
  if (normalizedReview.approved !== true) blockers.push("review_rejected");
  if (normalizedReview.findings.some((finding) => ["critical", "high"].includes(finding.severity))) {
    blockers.push("high_severity_review_finding");
  }

  return {
    accepted: blockers.length === 0,
    blockers,
    review: normalizedReview
  };
}
