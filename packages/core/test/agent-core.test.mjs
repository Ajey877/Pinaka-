import test from "node:test";
import assert from "node:assert/strict";
import { createPlan, getHealth, normalizeTask } from "../src/index.mjs";

test("normalizeTask trims valid tasks", () => {
  assert.equal(normalizeTask("  fix login  "), "fix login");
});

test("normalizeTask rejects empty tasks", () => {
  assert.throws(() => normalizeTask("   "), /cannot be empty/);
});

test("createPlan creates the safe execution stages", () => {
  const plan = createPlan("add a login screen");
  assert.equal(plan.stages.length, 6);
  assert.equal(plan.stages[0].name, "inspect_repository");
  assert.equal(plan.stages.at(-1).name, "review");
  assert.ok(plan.rules.some((rule) => rule.includes("Inspect before modifying")));
});

test("getHealth reports a healthy service", () => {
  assert.deepEqual(getHealth(), {
    service: "pinaka-agent",
    status: "ok",
    version: "0.1.0"
  });
});
