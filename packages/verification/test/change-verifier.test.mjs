import test from "node:test";
import assert from "node:assert/strict";
import { VerificationError, assertChangesSafe, verifyChanges } from "../src/index.mjs";

test("verifyChanges allows a small normal change set", () => {
  const result = verifyChanges([
    { path: "src/login.mjs", status: "modified", additions: 12, deletions: 4, bytes: 4096 }
  ]);
  assert.equal(result.allowed, true);
  assert.equal(result.changedFiles, 1);
  assert.deepEqual(result.violations, []);
});

test("verifyChanges rejects protected paths", () => {
  const result = verifyChanges([
    { path: ".github/workflows/release.yml", status: "modified", additions: 1 },
    { path: ".env", status: "modified", additions: 1 },
    { path: "config/credentials.json", status: "modified", additions: 1 }
  ]);
  assert.equal(result.allowed, false);
  assert.equal(result.violations.some((v) => v.code === "FORBIDDEN_PATHS"), true);
});

test("verifyChanges enforces file, line, and byte budgets", () => {
  const result = verifyChanges([
    { path: "a.mjs", additions: 10, deletions: 1, bytes: 100 },
    { path: "b.mjs", additions: 10, deletions: 1, bytes: 100 },
    { path: "c.mjs", additions: 10, deletions: 1, bytes: 100 }
  ], { maxChangedFiles: 2, maxAddedLines: 20 });

  assert.equal(result.allowed, false);
  assert.equal(result.violations.some((v) => v.code === "TOO_MANY_CHANGED_FILES"), true);
  assert.equal(result.violations.some((v) => v.code === "TOO_MANY_ADDITIONS"), true);
});

test("assertChangesSafe throws a typed error for rejected changes", () => {
  assert.throws(
    () => assertChangesSafe([{ path: ".env", status: "modified" }]),
    (error) => error instanceof VerificationError && error.code === "CHANGES_REJECTED"
  );
});

test("verifyChanges rejects unsafe paths and invalid statuses", () => {
  assert.throws(
    () => verifyChanges([{ path: "../secret.txt" }]),
    (error) => error instanceof VerificationError && error.code === "UNSAFE_CHANGED_FILE"
  );
  assert.throws(
    () => verifyChanges([{ path: "src/x.mjs", status: "unknown" }]),
    (error) => error instanceof VerificationError && error.code === "INVALID_CHANGE_STATUS"
  );
});
