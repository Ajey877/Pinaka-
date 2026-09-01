import test from "node:test";
import assert from "node:assert/strict";
import { runFinalReview } from "../src/final-review.mjs";

function makeRegistry() {
  const calls = [];
  return {
    calls,
    async execute(name, input) {
      calls.push({ name, input });
      if (name === "git.diff") {
        return { text: "diff --git a/app.js b/app.js\n--- a/app.js\n+++ b/app.js\n@@ -1 +1 @@\n-old\n+new\n", truncated: false };
      }
      if (name === "verification.check_changes") return { allowed: true, changedFiles: 1, additions: 1, deletions: 1, violations: [] };
      throw new Error(`unexpected tool ${name}`);
    }
  };
}

test("final review independently evaluates the bounded diff and returns acceptance", async () => {
  const registry = makeRegistry();
  const router = {
    async chat(request) {
      assert.equal(request.toolChoice, "none");
      assert.deepEqual(request.tools, []);
      assert.match(request.messages[1].content, /app\.js/);
      return {
        content: JSON.stringify({
          approved: true,
          confidence: 0.92,
          summary: "Change is focused and verification passed.",
          findings: []
        })
      };
    }
  };

  const result = await runFinalReview({
    registry,
    router,
    task: "Change app behavior.",
    verification: { passed: true }
  });

  assert.equal(result.accepted, true);
  assert.equal(result.verdict.approved, true);
  assert.equal(result.diff.changeCount, 1);
  assert.deepEqual(registry.calls.map(({ name }) => name), ["git.diff", "verification.check_changes"]);
});

test("final review rejects malformed model verdicts", async () => {
  const registry = makeRegistry();
  const router = { async chat() { return { content: "not json" }; } };

  await assert.rejects(
    () => runFinalReview({ registry, router, task: "x", verification: { passed: true } }),
    (error) => error?.code === "INVALID_REVIEW_VERDICT"
  );
});
