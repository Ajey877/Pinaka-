import { spawn } from "node:child_process";
import { ToolError } from "./errors.mjs";
import { resolveSafePath } from "./path-policy.mjs";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;

export const DEFAULT_ALLOWED_EXECUTABLES = Object.freeze([
  "node",
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "git",
  "python",
  "python3",
  "pytest",
  "go",
  "cargo",
  "rustc",
  "java",
  "javac"
]);

const BLOCKED_NODE_FLAGS = new Set(["-e", "--eval", "-p", "--print"]);

function validateExecutable(executable, allowedExecutables) {
  if (typeof executable !== "string" || executable.trim() === "") {
    throw new ToolError("executable is required", "INVALID_ARGUMENT");
  }
  const normalized = executable.trim().toLowerCase();
  if (!allowedExecutables.has(normalized)) {
    throw new ToolError("executable is not allowed by the tool policy", "COMMAND_NOT_ALLOWED", {
      executable
    });
  }
  return normalized;
}

function validateArgs(executable, args) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    throw new ToolError("args must be an array of strings", "INVALID_ARGUMENT");
  }
  if (executable === "node" && args.some((arg) => BLOCKED_NODE_FLAGS.has(arg))) {
    throw new ToolError("node evaluation flags are disabled", "COMMAND_NOT_ALLOWED");
  }
}

export async function runCommand({
  workspaceRoot,
  executable,
  args = [],
  cwd = ".",
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  allowedExecutables = DEFAULT_ALLOWED_EXECUTABLES
}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new ToolError("timeoutMs must be a positive integer", "INVALID_ARGUMENT");
  }
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes <= 0) {
    throw new ToolError("maxOutputBytes must be a positive integer", "INVALID_ARGUMENT");
  }

  const allowed = new Set(allowedExecutables.map((value) => String(value).toLowerCase()));
  const normalizedExecutable = validateExecutable(executable, allowed);
  validateArgs(normalizedExecutable, args);
  const workingDirectory = resolveSafePath(workspaceRoot, cwd);

  return new Promise((resolve, reject) => {
    const child = spawn(normalizedExecutable, args, {
      cwd: workingDirectory,
      shell: false,
      windowsHide: true,
      env: process.env
    });

    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let timedOut = false;
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const append = (target, chunk) => {
      const text = chunk.toString("utf8");
      const bytes = Buffer.byteLength(text, "utf8");
      if (outputBytes >= maxOutputBytes) return target;
      const remaining = maxOutputBytes - outputBytes;
      const accepted = bytes <= remaining ? text : Buffer.from(text).subarray(0, remaining).toString("utf8");
      outputBytes += Buffer.byteLength(accepted, "utf8");
      return target + accepted;
    };

    child.stdout.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });
    child.on("error", (error) => fail(new ToolError(`failed to start command: ${error.message}`, "PROCESS_START_FAILED")));
    child.on("close", (code, signal) => {
      finish({
        executable: normalizedExecutable,
        args: [...args],
        cwd,
        exitCode: code,
        signal,
        timedOut,
        stdout,
        stderr,
        outputTruncated: outputBytes >= maxOutputBytes
      });
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 2_000).unref();
    }, timeoutMs);

    child.once("close", () => clearTimeout(timer));
    child.once("error", () => clearTimeout(timer));
  });
}
