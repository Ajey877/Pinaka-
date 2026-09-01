import { GitOperationError } from "./errors.mjs";
import { runCommand } from "@pinaka/tools";

const BRANCH_PATTERN = /^(?![./-])(?!.*(?:\.\.|\\|\s|~|\^|:|\?|\*|\[|@\{|\.lock$))[A-Za-z0-9._/-]{1,240}$/;
const GITHUB_HTTPS_REPO = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/i;
const MAX_COMMAND_OUTPUT_BYTES = 512 * 1024;
const MAX_DIFF_BYTES = 512 * 1024;

function validateBranchName(branchName) {
  if (typeof branchName !== "string" || !BRANCH_PATTERN.test(branchName)) {
    throw new GitOperationError("invalid Git branch name", "INVALID_BRANCH_NAME", { branchName });
  }
  return branchName;
}

function validateRepositoryUrl(repositoryUrl) {
  if (typeof repositoryUrl !== "string" || !GITHUB_HTTPS_REPO.test(repositoryUrl.trim())) {
    throw new GitOperationError(
      "repository URL must be an HTTPS GitHub repository URL",
      "INVALID_REPOSITORY_URL"
    );
  }
  return repositoryUrl.trim().replace(/\/+$/, "");
}

function buildGitAuthEnvironment(githubToken) {
  if (typeof githubToken !== "string" || githubToken.trim() === "") return {};
  return {
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Bearer ${githubToken.trim()}`
  };
}

function requireSuccess(result, operation) {
  if (result.timedOut) {
    throw new GitOperationError(`${operation} timed out`, "GIT_COMMAND_TIMEOUT", {
      stdout: result.stdout,
      stderr: result.stderr
    });
  }
  if (result.exitCode !== 0) {
    throw new GitOperationError(`${operation} failed`, "GIT_COMMAND_FAILED", {
      exitCode: result.exitCode,
      signal: result.signal,
      stdout: result.stdout,
      stderr: result.stderr
    });
  }
  return result;
}

function parseStatus(output) {
  const lines = output.split(/\r?\n/).filter(Boolean);
  const branchLine = lines.find((line) => line.startsWith("## ")) || "## ";
  const branchInfo = branchLine.slice(3);
  let branch = "HEAD";

  if (branchInfo.startsWith("No commits yet on ")) {
    branch = branchInfo.slice("No commits yet on ".length).trim() || "HEAD";
  } else if (branchInfo.startsWith("HEAD (no branch)")) {
    branch = "HEAD";
  } else {
    branch = (branchInfo.split("...")[0].split(" ")[0] || "HEAD").trim();
  }

  const entries = lines.filter((line) => !line.startsWith("## "));

  return {
    branch,
    clean: entries.length === 0,
    changedFiles: entries.map((line) => line.slice(3).trim()).filter(Boolean)
  };
}

export class GitRepository {
  #workspaceRoot;

  constructor({ workspaceRoot } = {}) {
    if (typeof workspaceRoot !== "string" || workspaceRoot.trim() === "") {
      throw new GitOperationError("workspaceRoot is required", "INVALID_WORKSPACE_ROOT");
    }
    this.#workspaceRoot = workspaceRoot;
  }

  get workspaceRoot() {
    return this.#workspaceRoot;
  }

  async status() {
    const result = await runCommand({
      workspaceRoot: this.#workspaceRoot,
      executable: "git",
      args: ["status", "--porcelain=v1", "--branch"],
      maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES
    });
    requireSuccess(result, "git status");
    return parseStatus(result.stdout);
  }

  async currentCommit() {
    const result = await runCommand({
      workspaceRoot: this.#workspaceRoot,
      executable: "git",
      args: ["rev-parse", "HEAD"],
      maxOutputBytes: 8 * 1024
    });
    requireSuccess(result, "git rev-parse");
    return result.stdout.trim();
  }

  async diff({ staged = false, maxOutputBytes = MAX_DIFF_BYTES } = {}) {
    if (typeof staged !== "boolean") {
      throw new GitOperationError("staged must be boolean", "INVALID_DIFF_OPTION");
    }
    if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > MAX_DIFF_BYTES) {
      throw new GitOperationError("maxOutputBytes is invalid", "INVALID_DIFF_OPTION");
    }

    const args = staged
      ? ["diff", "--cached", "--no-ext-diff", "--unified=3", "--no-color"]
      : ["diff", "--no-ext-diff", "--unified=3", "--no-color"];
    const result = await runCommand({
      workspaceRoot: this.#workspaceRoot,
      executable: "git",
      args,
      maxOutputBytes
    });
    requireSuccess(result, "git diff");
    return {
      staged,
      text: result.stdout,
      truncated: result.outputTruncated === true
    };
  }

  async clone(repositoryUrl, { githubToken = "" } = {}) {
    const source = validateRepositoryUrl(repositoryUrl);
    let status;
    try {
      status = await this.status();
    } catch (error) {
      if (error?.code !== "GIT_COMMAND_FAILED") throw error;
      status = null;
    }

    if (status !== null) {
      throw new GitOperationError("workspace already contains a Git repository", "WORKSPACE_NOT_EMPTY");
    }

    const result = await runCommand({
      workspaceRoot: this.#workspaceRoot,
      executable: "git",
      args: ["clone", "--no-recurse-submodules", "--depth", "1", source, "."],
      timeoutMs: 120_000,
      maxOutputBytes: MAX_COMMAND_OUTPUT_BYTES,
      environment: buildGitAuthEnvironment(githubToken)
    });
    requireSuccess(result, "git clone");

    return this.status();
  }

  async createBranch(branchName) {
    validateBranchName(branchName);
    const current = await this.status();
    if (!current.clean) {
      throw new GitOperationError("cannot create an agent branch from a dirty workspace", "WORKSPACE_DIRTY", current);
    }

    const result = await runCommand({
      workspaceRoot: this.#workspaceRoot,
      executable: "git",
      args: ["switch", "-c", branchName],
      maxOutputBytes: 32 * 1024
    });
    requireSuccess(result, "git switch -c");
    return this.status();
  }

  async assertClean() {
    const status = await this.status();
    if (!status.clean) {
      throw new GitOperationError("workspace contains uncommitted changes", "WORKSPACE_DIRTY", status);
    }
    return status;
  }
}

export const __test = Object.freeze({ buildGitAuthEnvironment });
