import test from "node:test";
import assert from "node:assert/strict";
import { GitHubPullRequestClient, __test } from "../src/github-pr-client.mjs";

test("pull request client parses only HTTPS GitHub repository URLs", () => {
  assert.deepEqual(__test.parseRepositoryUrl("https://github.com/Ajey877/Pinaka-"), { owner: "Ajey877", repo: "Pinaka-" });
  assert.deepEqual(__test.parseRepositoryUrl("https://github.com/Ajey877/Pinaka-.git/"), { owner: "Ajey877", repo: "Pinaka-" });
  assert.throws(() => __test.parseRepositoryUrl("https://example.com/a/b"), /HTTPS GitHub/);
});

test("pull request client defers token validation until API use", () => {
  const client = new GitHubPullRequestClient();
  assert.rejects(() => client.getRepository("https://github.com/Ajey877/Pinaka-"), (error) => error.code === "GITHUB_TOKEN_REQUIRED");
});

test("pull request client gets default branch and opens a PR", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    if (url.endsWith("/repos/Ajey877/Pinaka-")) {
      return new Response(JSON.stringify({ default_branch: "main" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ number: 42, html_url: "https://github.com/Ajey877/Pinaka-/pull/42", title: "Pinaka: fix login" }), { status: 201, headers: { "content-type": "application/json" } });
  };
  try {
    const client = new GitHubPullRequestClient({ token: "test-token" });
    const result = await client.createPullRequest({
      repositoryUrl: "https://github.com/Ajey877/Pinaka-",
      headBranch: "agent/task-123",
      title: "Pinaka: fix login",
      body: "Verified change",
      draft: false
    });
    assert.deepEqual(result, {
      number: 42,
      url: "https://github.com/Ajey877/Pinaka-/pull/42",
      title: "Pinaka: fix login",
      base: "main",
      head: "agent/task-123"
    });
    assert.equal(requests.length, 2);
    assert.equal(requests[0].init.headers.authorization, "Bearer test-token");
    const prBody = JSON.parse(requests[1].init.body);
    assert.equal(prBody.base, "main");
    assert.equal(prBody.head, "agent/task-123");
    assert.equal(prBody.draft, false);
    assert.equal(prBody.maintainer_can_modify, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
