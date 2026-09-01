import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_ALLOWED_EXECUTABLES } from "../src/index.mjs";

test("default shell policy does not include a system shell", () => {
  assert.ok(!DEFAULT_ALLOWED_EXECUTABLES.includes("sh"));
  assert.ok(!DEFAULT_ALLOWED_EXECUTABLES.includes("bash"));
  assert.ok(!DEFAULT_ALLOWED_EXECUTABLES.includes("cmd"));
  assert.ok(!DEFAULT_ALLOWED_EXECUTABLES.includes("powershell"));
});
