import test from "node:test";
import assert from "node:assert/strict";
import { ConcurrentTaskLimiter, SlidingWindowLimiter, getHardeningConfig, securityHeaders, clientKey } from "../src/hardening.mjs";

test("sliding window limiter blocks after the configured budget and resets", () => {
  const limiter = new SlidingWindowLimiter({ limit: 2, windowMs: 1000 });
  assert.equal(limiter.allow("a", 0), true);
  assert.equal(limiter.allow("a", 100), true);
  assert.equal(limiter.allow("a", 200), false);
  assert.equal(limiter.allow("a", 1101), true);
});

test("concurrent task limiter caps active tasks per owner", () => {
  const limiter = new ConcurrentTaskLimiter({ limit: 2 });
  assert.equal(limiter.tryAcquire(7), true);
  assert.equal(limiter.tryAcquire(7), true);
  assert.equal(limiter.tryAcquire(7), false);
  assert.equal(limiter.count(7), 2);
  limiter.release(7);
  assert.equal(limiter.tryAcquire(7), true);
  limiter.release(7); limiter.release(7);
  assert.equal(limiter.count(7), 0);
});

test("security headers deny framing and unsafe browser capabilities", () => {
  const headers = securityHeaders({ production: true });
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["x-frame-options"], "DENY");
  assert.match(headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.match(headers["content-security-policy"], /connect-src 'self'/);
  assert.match(headers["strict-transport-security"], /max-age=31536000/);
});

test("hardening config rejects invalid environment values", () => {
  const config = getHardeningConfig({ PINAKA_RATE_LIMIT: "0", PINAKA_RATE_WINDOW_MS: "bad", PINAKA_MAX_CONCURRENT_TASKS: "-2", PINAKA_REQUEST_TIMEOUT_MS: "1" });
  assert.ok(config.rateLimit > 0);
  assert.ok(config.rateWindowMs >= 1000);
  assert.ok(config.concurrentTasks > 0);
  assert.equal(config.requestTimeoutMs, 1);
});

test("client key prefers the first forwarded address", () => {
  assert.equal(clientKey({ headers: { "x-forwarded-for": "203.0.113.8, 10.0.0.1" }, socket: { remoteAddress: "127.0.0.1" } }), "203.0.113.8");
  assert.equal(clientKey({ headers: {}, socket: { remoteAddress: "127.0.0.1" } }), "127.0.0.1");
});

test("concurrency slots can be released after a terminal task", () => {
  const limiter = new ConcurrentTaskLimiter({ limit: 2 });
  assert.equal(limiter.tryAcquire(9), true);
  assert.equal(limiter.tryAcquire(9), true);
  limiter.release(9);
  assert.equal(limiter.count(9), 1);
  assert.equal(limiter.tryAcquire(9), true);
  limiter.release(9);
  limiter.release(9);
  assert.equal(limiter.count(9), 0);
});
