import test from "node:test";
import assert from "node:assert/strict";
import { runAutonomousRepairLoop } from "../src/autonomous-repair.mjs";

function makeRegistry({ verificationResults, toolCalls = [] }) {
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
      if (name === "test.echo") return { echoed: input.value };
      throw new Error(`unexpected tool: ${name}`);
    }
  };
}

function makeRouter() {
  let calls = 0;
  return {
    get calls() { return calls; },
    async chat(request) {
      calls += 1;
      if (calls === 1) {
        return { content: "Implemented initial change.", toolCalls: [], model: "test-model" };
      }
      return {
        content: "Repair complete.",
        toolCalls: [{
          id: `repair-${calls}`,
          type: "function",
          function: { name: "test.echo", arguments: JSON.stringify({ value: "repair" }) }
        }],
        model: "test-model"
      };
    }
  };
}

test("autonomous repair loop returns passed without repair when verification succeeds", async () => {
  const registry = makeRegistry({ verificationResults: [
    { passed: true, checksPlanned: 1, checksRun: 1, results: [{ name: "test", passed: true }] }
  ] });
  const router = makeRouter();
  const result = await runAutonomousRepairLoop({
    registry,
    router,
    task: "Fix the test.",
    maxRepairAttempts: 2
  });

  assert.equal(result.status, "passed");
  assert.equal(result.repairAttempts.length, 0);
  assert.equal(result.verification.passed, true);
});

test("autonomous repair loop retries after verification failure and stops after success", async () => {
  const registry = makeRegistry({ verificationResults: [
    { passed: false, checksPlanned: 1, checksRun: 1, results: [{ name: "test", passed: false, execution: { stderr: "assertion failed" } }] },
    { passed: true, checksPlanned: 1, checksRun: 1, results: [{ name: "test", passed: true }] }
  ] });
  const router = makeRouter();
  const result = await runAutonomousRepairLoop({
    registry,
    router,
    task: "Fix the failing test.",
    maxRepairAttempts: 2,
    maxRounds: 2
  });

  assert.equal(result.status, "repaired");
  assert.equal(result.repairAttempts.length, 1);
  assert.equal(result.repairAttempts[0].verification.passed, true);
  assert.equal(router.calls, 2);
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
