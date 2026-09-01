import { VerificationError } from "./errors.mjs";

const DEFAULT_TIMEOUT_MS = 120_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_CHECKS = 8;
const MAX_OUTPUT_BYTES = 256 * 1024;
const DEFAULT_ALLOWED_CHECKS = Object.freeze(["test", "lint", "typecheck", "check", "build"]);

function validatePositiveInteger(value, name, max) {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new VerificationError(
      `${name} must be a positive integer no greater than ${max}`,
      "INVALID_VERIFICATION_OPTION",
      { name, value, max }
    );
  }
  return value;
}

function validateTimeout(value) {
  if (!Number.isInteger(value) || value < MIN_TIMEOUT_MS || value > MAX_TIMEOUT_MS) {
    throw new VerificationError(
      `timeoutMs must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`,
      "INVALID_VERIFICATION_OPTION",
      { name: "timeoutMs", value, min: MIN_TIMEOUT_MS, max: MAX_TIMEOUT_MS }
    );
  }
  return value;
}

function validateInspection(inspection) {
  if (!inspection || typeof inspection !== "object" || Array.isArray(inspection)) {
    throw new VerificationError("repository inspection is required", "INVALID_INSPECTION");
  }
  const scripts = inspection.scripts;
  if (scripts !== undefined && (!scripts || typeof scripts !== "object" || Array.isArray(scripts))) {
    throw new VerificationError("inspection.scripts must be an object", "INVALID_INSPECTION_SCRIPTS");
  }
  const ecosystems = inspection.ecosystems;
  if (ecosystems !== undefined && (!Array.isArray(ecosystems) || ecosystems.some((item) => typeof item !== "string"))) {
    throw new VerificationError("inspection.ecosystems must be an array of strings", "INVALID_INSPECTION_ECOSYSTEMS");
  }
  return inspection;
}

function addUnique(checks, name, executable, args, source) {
  const key = `${executable}\u0000${args.join("\u0000")}`;
  if (checks.some((check) => check.key === key)) return;
  if (checks.length >= MAX_CHECKS) return;
  checks.push({
    id: `${name}-${checks.length + 1}`,
    name,
    executable,
    args,
    source,
    key
  });
}

export function planVerificationChecks(inspection, { allowedChecks = DEFAULT_ALLOWED_CHECKS } = {}) {
  const safeInspection = validateInspection(inspection);
  const allowed = new Set((Array.isArray(allowedChecks) ? allowedChecks : DEFAULT_ALLOWED_CHECKS).map(String));
  const checks = [];
  const scripts = safeInspection.scripts || {};
  const scriptOrder = ["test", "lint", "typecheck", "check", "build"];

  for (const name of scriptOrder) {
    if (!allowed.has(name) || typeof scripts[name] !== "string" || scripts[name].trim() === "") continue;
    addUnique(checks, name, "npm", ["run", name], "package-script");
  }

  const ecosystems = new Set(safeInspection.ecosystems || []);
  if (checks.length === 0 && ecosystems.has("python")) {
    addUnique(checks, "test", "pytest", [], "python-fallback");
  }
  if (checks.length === 0 && ecosystems.has("go")) {
    addUnique(checks, "test", "go", ["test", "./..."], "go-fallback");
    addUnique(checks, "build", "go", ["build", "./..."], "go-fallback");
  }
  if (checks.length === 0 && ecosystems.has("rust")) {
    addUnique(checks, "test", "cargo", ["test"], "rust-fallback");
    addUnique(checks, "check", "cargo", ["check"], "rust-fallback");
  }

  return checks.map(({ key, ...check }) => check);
}

function normalizeOutput(value) {
  if (typeof value !== "string") return "";
  if (Buffer.byteLength(value, "utf8") <= MAX_OUTPUT_BYTES) return value;
  const accepted = Buffer.from(value, "utf8").subarray(0, MAX_OUTPUT_BYTES).toString("utf8");
  return `${accepted}\n[output truncated by Pinaka]`;
}

function normalizeExecutionResult(result) {
  if (!result || typeof result !== "object") {
    throw new VerificationError("verification command returned invalid data", "INVALID_EXECUTION_RESULT");
  }
  return {
    exitCode: Number.isInteger(result.exitCode) ? result.exitCode : null,
    signal: result.signal || null,
    timedOut: result.timedOut === true,
    stdout: normalizeOutput(result.stdout),
    stderr: normalizeOutput(result.stderr),
    outputTruncated: result.outputTruncated === true
  };
}

export async function runVerificationChecks({
  inspection,
  execute,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  continueOnFailure = false
} = {}) {
  if (typeof execute !== "function") {
    throw new VerificationError("execute function is required", "EXECUTOR_REQUIRED");
  }
  const timeout = validateTimeout(timeoutMs);
  const checks = planVerificationChecks(inspection);
  const results = [];

  for (const check of checks) {
    let execution;
    try {
      execution = normalizeExecutionResult(await execute({
        executable: check.executable,
        args: [...check.args],
        timeoutMs: timeout,
        maxOutputBytes: MAX_OUTPUT_BYTES
      }));
    } catch (error) {
      execution = {
        exitCode: null,
        signal: null,
        timedOut: false,
        stdout: "",
        stderr: normalizeOutput(error?.message || "verification command failed to start"),
        outputTruncated: false,
        startError: true,
        errorCode: error?.code || "EXECUTION_FAILED"
      };
    }

    const passed = execution.exitCode === 0 && !execution.timedOut && !execution.startError;
    results.push({
      ...check,
      passed,
      execution
    });

    if (!passed && !continueOnFailure) break;
  }

  return {
    passed: checks.length > 0 && results.every((result) => result.passed),
    checksPlanned: checks.length,
    checksRun: results.length,
    results
  };
}

export function assertVerificationPassed(result) {
  if (!result || result.passed !== true) {
    throw new VerificationError("verification checks did not all pass", "VERIFICATION_FAILED", result || null);
  }
  return result;
}
