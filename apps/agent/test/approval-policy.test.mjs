import test from "node:test";
import assert from "node:assert/strict";
import { canRequestApproval, canDecideApproval, nextApprovalStatus, isTerminalStatus } from "../src/approval-policy.mjs";

test("approval policy requires an accepted completed job", () => {
  assert.equal(canRequestApproval({ status: "completed", result: { status: "accepted" } }), true);
  assert.equal(canRequestApproval({ status: "completed", result: { status: "failed" } }), false);
  assert.equal(canRequestApproval({ status: "awaiting_approval", result: { status: "accepted" } }), false);
});

test("approval policy accepts only approve or reject", () => {
  const job = { status: "completed", result: { status: "accepted" } };
  assert.equal(canDecideApproval(job, "approve"), true);
  assert.equal(canDecideApproval(job, "reject"), true);
  assert.equal(canDecideApproval(job, "publish"), false);
});

test("approval policy maps decisions to terminal statuses", () => {
  assert.equal(nextApprovalStatus("approve"), "approved");
  assert.equal(nextApprovalStatus("reject"), "rejected");
  assert.throws(() => nextApprovalStatus("publish"), /approve or reject/);
});

test("approval policy knows terminal statuses", () => {
  assert.equal(isTerminalStatus("approved"), true);
  assert.equal(isTerminalStatus("rejected"), true);
  assert.equal(isTerminalStatus("running"), false);
});
