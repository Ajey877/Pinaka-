import test from "node:test";
import assert from "node:assert/strict";
import { VerificationError } from "../src/errors.mjs";
import { assertVerificationPassed, planVerificationChecks, runVerificationChecks } from "../src/test-runner.mjs";

test("plans npm checks in deterministic order from repository scripts", () => {
  const checks = planVerificationChecks({
    ecosystems: ["node"],
    scripts: {
      build: "npm run build",
      typecheck: "tsc --noEmit",
      test: "npm test",
      lint: "eslint ."
    }
  });

  assert.deepEqual(checks.map(({ name, executable, args }) => ({ name, executable, args })), [
    { name: "test", executable: "npm", args: ["run", "test"] },
    { name: "lint", executable: "npm", args: ["run", "lint"] },
    { name: "typecheck", executable: "npm", args: ["run", "typecheck"] },
    { name: "build", executable: "npm", args: ["run", "build"] }
  ]);
});

test("uses safe ecosystem fallbacks when no scripts are available", () => {
  assert.deepEqual(
    planVerificationChecks({ ecosystems: ["python"], scripts: {} }).map(({ executable, args }) => ({ executable, args })),
    [{ executable: "pytest", args: [] }]
  );
  assert.deepEqual(
    planVerificationChecks({ ecosystems: ["go"], scripts: {} }).map(({ executable, args }) => ({ executable, args })),
    [
      { executable: "go", args: ["test", "./..."] },
      { executable: "go", args: ["build", "./..."] }
    ]
  );
});

test("runs checks sequentially and stops on the first failure by default", async () => {
  const calls = [];
  const result = await runVerificationChecks({
    inspection: { ecosystems: ["node"], scripts: { test: "npm test", lint: "eslint ." } },
    execute: async (command) => {
      calls.push(command);
      return command.args[1] === "test"
        ? { exitCode: 0, stdout: "pass", stderr: "" }
        : { exitCode: 1, stdout: "", stderr: "lint failed" };
    }
  });

  assert.equal(result.passed, false);
  assert.equal(result.checksPlanned, 2);
  assert.equal(result.checksRun, 2);
  assert.equal(result.results[0].passed, true);
  assert.equal(result.results[1].passed, false);
  assert.equal(calls.length, 2);
});

test("can continue after a failed check when requested", async () => {
  const result = await runVerificationChecks({
    inspection: { ecosystems: ["node"], scripts: { test: "npm test", lint: "eslint .", build: "npm run build" } },
    continueOnFailure: true,
    execute: async (command) => ({ exitCode: command.args[1] === "lint" ? 1 : 0, stdout: "", stderr: "" })
  });

  assert.equal(result.checksRun, 3);
  assert.deepEqual(result.results.map(({ passed }) => passed), [true, false, true]);
  assert.equal(result.passed, false);
});

test("captures executor failures without throwing away the verification report", async () => {
  const result = await runVerificationChecks({
    inspection: { ecosystems: ["rust"], scripts: {} },
    execute: async () => {
      const error = new Error("tool unavailable");
      error.code = "PROCESS_START_FAILED";
      throw error;
    }
  });

  assert.equal(result.passed, false);
  assert.equal(result.checksRun, 1);
  assert.equal(result.results[0].execution.startError, true);
  assert.equal(result.results[0].execution.errorCode, "PROCESS_START_FAILED");
});

test("assertVerificationPassed accepts only a fully passing report", () => {
  const passing = { passed: true, checksPlanned: 1, checksRun: 1, results: [{ passed: true }] };
  assert.equal(assertVerificationPassed(passing), passing);
  assert.throws(() => assertVerificationPassed({ passed: false }), (error) => error instanceof VerificationError && error.code === "VERIFICATION_FAILED");
});

test("rejects invalid inspection and timeout options", async () => {
  assert.throws(() => planVerificationChecks(null), (error) => error instanceof VerificationError && error.code === "INVALID_INSPECTION");
  await assert.rejects(
    () => runVerificationChecks({ inspection: { ecosystems: [] }, execute: async () => ({ exitCode: 0 }), timeoutMs: 999 }),
    (error) => error instanceof VerificationError && error.code === "INVALID_VERIFICATION_OPTION"
  );
});

test("limits the number of planned checks", () => {
  const scripts = { test: "a", lint: "b", typecheck: "c", check: "d", build: "e" };
  const checks = planVerificationChecks({ ecosystems: ["node"], scripts });
  assert.equal(checks.length, 5);
  assert.equal(new Set(checks.map(({ id }) => id)).size, 5);
});
