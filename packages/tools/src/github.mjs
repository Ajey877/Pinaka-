import { ToolError } from "./errors.mjs";

const DEFAULT_API_BASE = "https://api.github.com";
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

function validateRepoPart(value, name) {
  if (typeof value !== "string" || !NAME_PATTERN.test(value)) {
    throw new ToolError(`${name} is invalid`, "INVALID_ARGUMENT");
  }
  return value;
}

function buildApiUrl(apiBase, path) {
  const base = new URL(apiBase);
  if (base.protocol !== "https:") {
    throw new ToolError("GitHub API base must use HTTPS", "INVALID_CONFIGURATION");
  }
  const normalizedPath = path.replace(/^\/+/, "");
  return new URL(normalizedPath, base.toString().endsWith("/") ? base.toString() : `${base}/`);
}

async function requestJson(url, { token, timeoutMs, maxResponseBytes }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      signal: controller.signal
    });

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
      throw new ToolError("GitHub response exceeds the size limit", "RESPONSE_TOO_LARGE");
    }

    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxResponseBytes) {
      throw new ToolError("GitHub response exceeds the size limit", "RESPONSE_TOO_LARGE");
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new ToolError("GitHub returned invalid JSON", "UPSTREAM_INVALID_RESPONSE");
    }

    if (!response.ok) {
      throw new ToolError(data?.message || `GitHub request failed with ${response.status}`, "GITHUB_API_ERROR", {
        status: response.status
      });
    }

    return data;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new ToolError("GitHub request timed out", "UPSTREAM_TIMEOUT");
    }
    if (error instanceof ToolError) throw error;
    throw new ToolError(`GitHub request failed: ${error.message}`, "UPSTREAM_REQUEST_FAILED");
  } finally {
    clearTimeout(timer);
  }
}

export class GitHubClient {
  constructor({ token = "", apiBase = DEFAULT_API_BASE, timeoutMs = DEFAULT_TIMEOUT_MS, maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES } = {}) {
    if (typeof token !== "string") {
      throw new ToolError("GitHub token must be a string", "INVALID_CONFIGURATION");
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      throw new ToolError("timeoutMs must be a positive integer", "INVALID_CONFIGURATION");
    }
    if (!Number.isInteger(maxResponseBytes) || maxResponseBytes <= 0) {
      throw new ToolError("maxResponseBytes must be a positive integer", "INVALID_CONFIGURATION");
    }

    this.token = token;
    this.apiBase = apiBase;
    this.timeoutMs = timeoutMs;
    this.maxResponseBytes = maxResponseBytes;
  }

  async getRepository(owner, repo) {
    validateRepoPart(owner, "owner");
    validateRepoPart(repo, "repository");
    const url = buildApiUrl(this.apiBase, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
    return requestJson(url, this);
  }

  async getContents(owner, repo, path = "", ref = undefined) {
    validateRepoPart(owner, "owner");
    validateRepoPart(repo, "repository");
    if (typeof path !== "string") {
      throw new ToolError("path must be a string", "INVALID_ARGUMENT");
    }

    const encodedPath = path
      .split("/")
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const suffix = encodedPath ? `/${encodedPath}` : "";
    const url = buildApiUrl(this.apiBase, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents${suffix}`);
    if (ref !== undefined) {
      if (typeof ref !== "string" || ref.trim() === "") {
        throw new ToolError("ref must be a non-empty string", "INVALID_ARGUMENT");
      }
      url.searchParams.set("ref", ref);
    }
    return requestJson(url, this);
  }
}
