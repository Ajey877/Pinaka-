import test from "node:test";
import assert from "node:assert/strict";
import { runAutonomousRepairLoop } from "../src/autonomous-repair.mjs";

function makeRegistry({ verificationResults }) {
  let verificationIndex = 0;
  const executed = [];
  return {
    executed,
    has(name) {
      return name === "test.echo";
    },
    definitions() {
      return [{
        type: "function",
        function: {
          name: "test.echo",
          description: "Echo a value.",
          parameters: {
            type: "object",
            properties: { value: { type: "string" } },
            required: ["value"],
            additionalProperties: false
          }
        }
      }];
    },
    async execute(name, input) {
      executed.push({ name, input });
      if (name === "repository.inspect") return { files: ["app.js"], ecosystems: ["node"], scripts: { test: "node test.js" } };
      if (name === "verification.run_checks") return verificationResults[Math.min(verificationIndex++, verificationResults.length - 1)];
      if (name === "git.diff") return { text: "diff --git a/app.js b/app.js\n--- a/app.js\n+++ b/app.js\n@@ -1 +1 @@\n-old\n+new\n", truncated: false };
      if (name === "verification.check_changes") return { allowed: true, changedFiles: 1, additions: 1, deletions: 1, violations: [] };
      if (name === "test.echo") return { echoed: input.value };
      throw new Error(`unexpected tool: ${name}`);
    }
  };
}

function makeRouter() {
  let calls = 0;
  return {
    get calls() { return calls; },
    async chat() {
      calls += 1;
      if (calls === 1) {
        return { content: "Implemented initial change.", toolCalls: [], model: "test-model" };
      }
      if (calls === 2) {
        return {
          content: "",
          toolCalls: [{
            id: "repair-2",
            type: "function",
            function: { name: "test.echo", arguments: JSON.stringify({ value: "repair" }) }
          }],
          model: "test-model"
        };
      }
      return { content: "Repair complete.", toolCalls: [], model: "test-model" };
    }
  };
}

function makeReviewRouter(approved = true) {
  return {
    async chat() {
      return {
        content: JSON.stringify({
          approved,
          confidence: approved ? 0.9 : 0.8,
          summary: approved ? "Reviewed and accepted." : "Reviewed and rejected.",
          findings: approved ? [] : [{ severity: "high", title: "Regression", detail: "Review found a blocker.", path: "app.js" }]
        })
      };
    }
  };
}

test("autonomous repair loop accepts a verified change after final review", async () => {
  const registry = makeRegistry({ verificationResults: [
    { passed: true, checksPlanned: 1, checksRun: 1, results: [{ name: "test", passed: true }] }
  ] });
  const router = makeRouter();
  const result = await runAutonomousRepairLoop({
    registry,
    router,
    reviewRouter: makeReviewRouter(true),
    task: "Fix the test.",
    maxRepairAttempts: 2
  });

  assert.equal(result.status, "accepted");
  assert.equal(result.repairAttempts.length, 0);
  assert.equal(result.verification.passed, true);
  assert.equal(result.finalReview.accepted, true);
  assert.equal(router.calls, 1);
});

test("autonomous repair loop retries after verification failure and accepts after review", async () => {
  const registry = makeRegistry({ verificationResults: [
    { passed: false, checksPlanned: 1, checksRun: 1, results: [{ name: "test", passed: false, execution: { stderr: "assertion failed" } }] },
    { passed: true, checksPlanned: 1, checksRun: 1, results: [{ name: "test", passed: true }] }
  ] });
  const router = makeRouter();
  const result = await runAutonomousRepairLoop({
    registry,
    router,
    reviewRouter: makeReviewRouter(true),
    task: "Fix the failing test.",
    maxRepairAttempts: 2,
    maxRounds: 2
  });

  assert.equal(result.status, "accepted");
  assert.equal(result.repairAttempts.length, 1);
  assert.equal(result.repairAttempts[0].verification.passed, true);
  assert.equal(router.calls, 3);
});

test("autonomous repair loop rejects a verified change when final review rejects it", async () => {
  const registry = makeRegistry({ verificationResults: [
    { passed: true, checksPlanned: 1, checksRun: 1, results: [{ name: "test", passed: true }] }
  ] });
  const result = await runAutonomousRepairLoop({
    registry,
    router: makeRouter(),
    reviewRouter: makeReviewRouter(false),
    task: "Make a change.",
    maxRepairAttempts: 0
  });

  assert.equal(result.status, "review_rejected");
  assert.equal(result.finalReview.accepted, false);
});

test("autonomous repair loop reports failed after exhausting its repair budget", async () => {
  const failure = {
    passed: false,
    checksPlanned: 1,
    checksRun: 1,
    results: [{ name: "test", passed: false, execution: { stderr: "still broken" } }]
  };
  const registry = makeRegistry({ verificationResults: [failure] });
  const router = makeRouter();
  const result = await runAutonomousRepairLoop({
    registry,
    router,
    reviewRouter: makeReviewRouter(true),
    task: "Fix it.",
    maxRepairAttempts: 2,
    maxRounds: 2
  });

  assert.equal(result.status, "failed");
  assert.equal(result.repairAttempts.length, 2);
  assert.equal(result.verification.passed, false);
});

test("autonomous repair loop does not claim verification when no checks exist", async () => {
  const registry = makeRegistry({
    verificationResults: [{ passed: false, checksPlanned: 0, checksRun: 0, results: [] }]
  });
  const router = makeRouter();
  const result = await runAutonomousRepairLoop({
    registry,
    router,
    reviewRouter: makeReviewRouter(true),
    task: "Make a change.",
    maxRepairAttempts: 3
  });

  assert.equal(result.status, "unverified");
  assert.equal(result.repairAttempts.length, 0);
  assert.equal(router.calls, 1);
});

test("autonomous repair loop validates its repair budget", async () => {
  const registry = makeRegistry({ verificationResults: [] });
  const router = makeRouter();
  await assert.rejects(
    () => runAutonomousRepairLoop({ registry, router, task: "x", maxRepairAttempts: 99 }),
    (error) => error?.code === "INVALID_REPAIR_ATTEMPTS"
  );
});
