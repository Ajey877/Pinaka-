import test from "node:test";
import assert from "node:assert/strict";
import { finalAcceptance, normalizeReviewVerdict } from "../src/index.mjs";

test("normalizes a valid review verdict", () => {
  const result = normalizeReviewVerdict({
    approved: true,
    confidence: 0.9,
    summary: "Looks correct.",
    findings: []
  });
  assert.equal(result.approved, true);
  assert.equal(result.findings.length, 0);
});

test("rejects malformed review verdicts", () => {
  assert.throws(
    () => normalizeReviewVerdict({ approved: "yes", confidence: 1, summary: "bad", findings: [] }),
    (error) => error?.code === "INVALID_REVIEW_VERDICT"
  );
});

test("final acceptance requires verification, safety, and review approval", () => {
  const accepted = finalAcceptance({
    verification: { passed: true },
    safety: { allowed: true },
    review: { approved: true, confidence: 0.95, summary: "Good.", findings: [] }
  });
  assert.equal(accepted.accepted, true);

  const rejected = finalAcceptance({
    verification: { passed: true },
    safety: { allowed: true },
    review: {
      approved: true,
      confidence: 0.95,
      summary: "One serious issue remains.",
      findings: [{ severity: "high", title: "Regression", detail: "Behavior changed unexpectedly.", path: "app.js" }]
    }
  });
  assert.equal(rejected.accepted, false);
  assert.ok(rejected.blockers.includes("high_severity_review_finding"));
});
