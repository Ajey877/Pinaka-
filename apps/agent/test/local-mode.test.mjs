import test from "node:test";
import assert from "node:assert/strict";
import { LOCAL_USER_ID, isLocalMode, localSession } from "../src/local-mode.mjs";

test("local mode is enabled outside production by default", () => {
  assert.equal(isLocalMode({ NODE_ENV: "development" }), true);
  assert.equal(isLocalMode({}), true);
  assert.equal(isLocalMode({ NODE_ENV: "production" }), false);
});

test("explicit local mode overrides production for local testing", () => {
  assert.equal(isLocalMode({ NODE_ENV: "production", PINAKA_LOCAL_MODE: "1" }), true);
  assert.equal(isLocalMode({ NODE_ENV: "production", PINAKA_LOCAL_MODE: "0" }), false);
});

test("local session has a stable non-GitHub identity and no credentials", () => {
  const session = localSession();
  assert.equal(session.id, LOCAL_USER_ID);
  assert.equal(session.local, true);
  assert.equal(session.user.id, LOCAL_USER_ID);
  assert.equal(session.user.login, "local");
  assert.equal(session.githubToken, "");
  assert.equal(session.csrfToken, null);
});
