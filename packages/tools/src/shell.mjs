import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
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
const MAX_ENV_KEYS = 8;
const MAX_ENV_VALUE_LENGTH = 8_192;

function validateExecutable(executable, allowedExecutables) {
  if (typeof executable !== "string" || executable.trim() === "") {
    throw new ToolError("executable is required", "INVALID_ARGUMENT");
  }
  const normalized = executable.trim().toLowerCase();
  const withoutCmd = normalized.endsWith(".cmd") ? normalized.slice(0, -4) : normalized;
  if (!allowedExecutables.has(normalized) && !allowedExecutables.has(withoutCmd)) {
    throw new ToolError("executable is not allowed by the tool policy", "COMMAND_NOT_ALLOWED", {
      executable
    });
  }
  return withoutCmd;
}

function validateArgs(executable, args) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    throw new ToolError("args must be an array of strings", "INVALID_ARGUMENT");
  }
  if (executable === "node" && args.some((arg) => BLOCKED_NODE_FLAGS.has(arg))) {
    throw new ToolError("node evaluation flags are disabled", "COMMAND_NOT_ALLOWED");
  }
}

function buildChildEnvironment(overrides = {}) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new ToolError("environment must be an object", "INVALID_ARGUMENT");
  }
  const entries = Object.entries(overrides);
  if (entries.length > MAX_ENV_KEYS) throw new ToolError("too many environment overrides", "INVALID_ARGUMENT");
  for (const [key, value] of entries) {
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key) || typeof value !== "string" || value.length > MAX_ENV_VALUE_LENGTH) {
      throw new ToolError("invalid environment override", "INVALID_ARGUMENT");
    }
  }

  const safeKeys = [
    "PATH",
    "HOME",
    "USERPROFILE",
    "SystemRoot",
    "TEMP",
    "TMP",
    "TMPDIR",
    "PATHEXT",
    "NODE_PATH",
    "CI"
  ];
  return Object.assign(
    Object.fromEntries(
      safeKeys
        .filter((key) => typeof process.env[key] === "string")
        .map((key) => [key, process.env[key]])
    ),
    overrides
  );
}

async function resolveChildInvocation(executable) {
  if (process.platform !== "win32") return { executable, argsPrefix: [] };

  if (executable === "npm" || executable === "npx") {
    const cliName = executable === "npm" ? "npm-cli.js" : "npx-cli.js";
    const cliPath = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", cliName);
    try {
      await fs.access(cliPath);
    } catch {
      throw new ToolError(`bundled ${executable} CLI was not found`, "PACKAGE_MANAGER_UNAVAILABLE");
    }
    return { executable: process.execPath, argsPrefix: [cliPath] };
  }

  return { executable, argsPrefix: [] };
}

export async function runCommand({
  workspaceRoot,
  executable,
  args = [],
  cwd = ".",
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  allowedExecutables = DEFAULT_ALLOWED_EXECUTABLES,
  environment = {}
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
  const invocation = await resolveChildInvocation(normalizedExecutable);
  const childExecutable = invocation.executable;
  const childArgs = [...invocation.argsPrefix, ...args];

  return new Promise((resolve, reject) => {
    const child = spawn(childExecutable, childArgs, {
      cwd: workingDirectory,
      shell: false,
      windowsHide: true,
      env: buildChildEnvironment(environment)
    });

    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let timedOut = false;
    let settled = false;
    let truncated = false;

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
      if (outputBytes >= maxOutputBytes) {
        truncated = true;
        return target;
      }
      const text = chunk.toString("utf8");
      const bytes = Buffer.byteLength(text, "utf8");
      const remaining = maxOutputBytes - outputBytes;
      if (bytes <= remaining) {
        outputBytes += bytes;
        return target + text;
      }

      truncated = true;
      const acceptedBuffer = Buffer.from(text, "utf8").subarray(0, remaining);
      const accepted = acceptedBuffer.toString("utf8");
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
        outputTruncated: truncated
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
