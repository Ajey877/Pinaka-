const GITHUB_API = "https://api.github.com";
const REPOSITORY_PATTERN = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\.git)?\/?$/i;
const MAX_TITLE = 256;
const MAX_BODY = 10_000;

function parseRepositoryUrl(repositoryUrl) {
  if (typeof repositoryUrl !== "string") throw Object.assign(new Error("repositoryUrl is required"), { code: "INVALID_REPOSITORY_URL" });
  const match = repositoryUrl.trim().match(REPOSITORY_PATTERN);
  if (!match) throw Object.assign(new Error("repositoryUrl must be an HTTPS GitHub repository URL"), { code: "INVALID_REPOSITORY_URL" });
  return { owner: match[1], repo: match[2].replace(/\.git$/i, "") };
}

function validateToken(token) {
  if (typeof token !== "string" || token.trim() === "") throw Object.assign(new Error("GITHUB_TOKEN is required to create a pull request"), { code: "GITHUB_TOKEN_REQUIRED", statusCode: 503 });
  return token.trim();
}

async function githubRequest(pathname, { token, method = "GET", body } = {}) {
  const response = await fetch(`${GITHUB_API}${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${validateToken(token)}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(body === undefined ? {} : { "content-type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.message === "string" ? payload.message : `GitHub API request failed (${response.status})`;
    const error = new Error(message);
    error.code = response.status === 401 ? "GITHUB_UNAUTHORIZED" : response.status === 403 ? "GITHUB_FORBIDDEN" : response.status === 404 ? "GITHUB_NOT_FOUND" : response.status === 422 ? "GITHUB_VALIDATION_FAILED" : "GITHUB_API_FAILED";
    error.statusCode = response.status >= 500 ? 502 : response.status === 404 ? 404 : 502;
    throw error;
  }
  return payload;
}

function compactText(value, max, fallback) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return (text || fallback).slice(0, max);
}

export class GitHubPullRequestClient {
  #token;

  constructor({ token } = {}) {
    this.#token = validateToken(token);
  }

  async getRepository(repositoryUrl) {
    const { owner, repo } = parseRepositoryUrl(repositoryUrl);
    const payload = await githubRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { token: this.#token });
    if (typeof payload.default_branch !== "string" || payload.default_branch.trim() === "") {
      throw Object.assign(new Error("GitHub repository did not report a default branch"), { code: "GITHUB_DEFAULT_BRANCH_MISSING", statusCode: 502 });
    }
    return { owner, repo, defaultBranch: payload.default_branch };
  }

  async createPullRequest({ repositoryUrl, headBranch, title, body, draft = false } = {}) {
    const repository = await this.getRepository(repositoryUrl);
    if (typeof headBranch !== "string" || !/^agent\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(headBranch)) {
      throw Object.assign(new Error("headBranch is invalid"), { code: "INVALID_HEAD_BRANCH" });
    }
    const payload = await githubRequest(`/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/pulls`, {
      token: this.#token,
      method: "POST",
      body: {
        title: compactText(title, MAX_TITLE, "Pinaka changes"),
        body: compactText(body, MAX_BODY, "Changes prepared by Pinaka after verification and approval."),
        head: headBranch,
        base: repository.defaultBranch,
        draft: draft === true,
        maintainer_can_modify: false
      }
    });
    return {
      number: Number.isInteger(payload.number) ? payload.number : null,
      url: typeof payload.html_url === "string" ? payload.html_url : null,
      title: typeof payload.title === "string" ? payload.title : null,
      base: repository.defaultBranch,
      head: headBranch
    };
  }
}

export const __test = Object.freeze({ parseRepositoryUrl });
