import test from "node:test";
import assert from "node:assert/strict";
import { ApprovalService } from "../src/approval-service.mjs";

function acceptedJob(overrides = {}) {
  return {
    id: "task-approve",
    repositoryUrl: "https://github.com/example/repo",
    task: "Fix the login bug",
    status: "completed",
    result: { status: "accepted", diff: { text: "diff --git a/app.js b/app.js\n+fixed\n", truncated: false }, finalReview: { summary: "All checks passed." } },
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
  const service = new ApprovalService({ workspaceManager: {}, githubPrClientFactory: () => ({ createPullRequest: async () => { published = true; } }) });
  const result = await service.decide(acceptedJob(), "reject");
  assert.equal(result.status, "rejected"); assert.equal(result.approval.status, "rejected"); assert.equal(result.approval.published, false); assert.equal(result.approval.commit, undefined); assert.equal(published, false);
});

test("approval service rejects duplicate decisions", async () => {
  const service = new ApprovalService({ workspaceManager: {} });
  await service.decide(acceptedJob(), "reject");
  await assert.rejects(() => service.decide(acceptedJob(), "reject"), (error) => error.code === "APPROVAL_ALREADY_DECIDED");
});

test("approval service rejects approval when the retained diff is truncated", async () => {
  const service = new ApprovalService({ workspaceManager: {} });
  const job = acceptedJob({ result: { status: "accepted", diff: { text: "diff", truncated: true } } });
  await assert.rejects(() => service.decide(job, "approve", { githubToken: "token" }), (error) => error.code === "DIFF_TRUNCATED");
});

test("approval service requires a per-session GitHub token before publishing", async () => {
  let created = false;
  const workspaceManager = { create: async () => { created = true; }, release: async () => {}, discard: async () => {} };
  const service = new ApprovalService({ workspaceManager, githubPrClientFactory: () => ({ createPullRequest: async () => null }) });
  await assert.rejects(() => service.decide(acceptedJob({ id: "task-no-token" }), "approve"), (error) => error.code === "GITHUB_AUTH_REQUIRED" && error.statusCode === 401);
  assert.equal(created, false);
});

test("approval service receives the supplied session token and does not fall back to a global token", async () => {
  let receivedToken = null;
  const workspaceManager = { create: async () => ({ path: "/tmp/not-a-real-approval-workspace" }), release: async () => {}, discard: async () => {} };
  const service = new ApprovalService({ workspaceManager, githubPrClientFactory: (token) => { receivedToken = token; return { createPullRequest: async () => null }; } });
  await assert.rejects(() => service.decide(acceptedJob({ id: "task-token" }), "approve", { githubToken: "session-token" }));
  assert.equal(receivedToken, "session-token");
});
