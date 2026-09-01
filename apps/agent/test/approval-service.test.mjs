import test from "node:test";
import assert from "node:assert/strict";
import { ApprovalService } from "../src/approval-service.mjs";

function acceptedJob(overrides = {}) {
  return {
    id: "task-approve",
    repositoryUrl: "https://github.com/example/repo",
    task: "Fix the login bug",
    status: "completed",
    result: {
      status: "accepted",
      diff: { text: "diff --git a/app.js b/app.js\n+fixed\n", truncated: false },
      finalReview: { summary: "All checks passed." }
    },
    ...overrides
  };
}

test("approval service exposes pending approval only for accepted completed jobs", () => {
  const service = new ApprovalService({ workspaceManager: {} });
  assert.deepEqual(service.decorate(acceptedJob()).approval, { status: "pending", actions: ["approve", "reject"] });
  assert.equal(service.decorate(acceptedJob({ status: "failed" })).approval, null);
});

test("approval service records a reject decision without publishing changes", async () => {
  let published = false;
  const service = new ApprovalService({ workspaceManager: {}, githubPrClient: { createPullRequest: async () => { published = true; } } });
  const result = await service.decide(acceptedJob(), "reject");
  assert.equal(result.status, "rejected");
  assert.equal(result.approval.status, "rejected");
  assert.equal(result.approval.published, false);
  assert.equal(result.approval.commit, undefined);
  assert.equal(published, false);
});

test("approval service rejects duplicate decisions", async () => {
  const service = new ApprovalService({ workspaceManager: {} });
  await service.decide(acceptedJob(), "reject");
  await assert.rejects(() => service.decide(acceptedJob(), "reject"), (error) => error.code === "APPROVAL_ALREADY_DECIDED");
});

test("approval service rejects approval when the retained diff is truncated", async () => {
  const service = new ApprovalService({ workspaceManager: {}, githubToken: "token" });
  const job = acceptedJob({ result: { status: "accepted", diff: { text: "diff", truncated: true } } });
  await assert.rejects(() => service.decide(job, "approve"), (error) => error.code === "DIFF_TRUNCATED");
});

test("approval service requires a GitHub sign-in token before publishing", async () => {
  let created = false;
  const workspaceManager = { create: async () => { created = true; }, release: async () => {}, discard: async () => {} };
  const service = new ApprovalService({ workspaceManager, githubPrClient: { createPullRequest: async () => null } });
  await assert.rejects(() => service.decide(acceptedJob({ id: "task-no-token" }), "approve"), (error) => error.code === "GITHUB_AUTH_REQUIRED" && error.statusCode === 401);
  assert.equal(created, false);
});

test("approval service accepts a per-session GitHub token for publishing", async () => {
  const workspaceManager = {
    async create() { return { path: "/tmp/pinaka-approval-session" }; },
    async release() {},
    async discard() {}
  };
  let prCalled = false;
  const service = new ApprovalService({
    workspaceManager,
    githubPrClient: { createPullRequest: async () => { prCalled = true; return { number: 7, url: "https://github.com/example/repo/pull/7" }; } }
  });
  const result = await service.decide(acceptedJob({ id: "task-session" }), "approve", { githubToken: "gho_session" });
  assert.equal(result.approval.published, true);
  assert.equal(prCalled, true);
});
