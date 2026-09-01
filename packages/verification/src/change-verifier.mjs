import { VerificationError } from "./errors.mjs";

const DEFAULT_MAX_CHANGED_FILES = 40;
const DEFAULT_MAX_ADDED_LINES = 2_500;
const DEFAULT_MAX_DELETED_LINES = 2_500;
const DEFAULT_MAX_FILE_BYTES = 750_000;
const FORBIDDEN_PATTERNS = [
  /^\.github\/workflows\//i,
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)id_rsa(?:\.|$)/i,
  /(^|\/)credentials?(?:\.|$)/i,
  /(^|\/)secrets?(?:\.|$)/i
];

function validateNonNegativeInteger(value, name, max) {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new VerificationError(
      `${name} must be an integer between 0 and ${max}`,
      "INVALID_VERIFICATION_LIMIT",
      { name, value, max }
    );
  }
  return value;
}

function normalizeFileName(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 1_024) {
    throw new VerificationError("changed file name is invalid", "INVALID_CHANGED_FILE");
  }
  const normalized = value.replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.includes("../") || normalized === ".." || normalized.includes("/..")) {
    throw new VerificationError("changed file path is unsafe", "UNSAFE_CHANGED_FILE", { path: value });
  }
  return normalized;
}

function isForbiddenPath(path) {
  return FORBIDDEN_PATTERNS.some((pattern) => pattern.test(path));
}

function normalizeChanges(changes) {
  if (!Array.isArray(changes)) {
    throw new VerificationError("changes must be an array", "INVALID_CHANGES");
  }

  return changes.map((change, index) => {
    if (!change || typeof change !== "object" || Array.isArray(change)) {
      throw new VerificationError("each change must be an object", "INVALID_CHANGE", { index });
    }
    const path = normalizeFileName(change.path);
    const status = change.status || "modified";
    if (!["added", "modified", "deleted", "renamed", "copied"].includes(status)) {
      throw new VerificationError("change status is invalid", "INVALID_CHANGE_STATUS", { index, status });
    }
    const additions = validateNonNegativeInteger(change.additions ?? 0, "additions", 10_000_000);
    const deletions = validateNonNegativeInteger(change.deletions ?? 0, "deletions", 10_000_000);
    const bytes = validateNonNegativeInteger(change.bytes ?? 0, "bytes", 100_000_000);
    return { path, status, additions, deletions, bytes };
  });
}

export function verifyChanges(changes, options = {}) {
  const safeChanges = normalizeChanges(changes);
  const maxChangedFiles = validateNonNegativeInteger(
    options.maxChangedFiles ?? DEFAULT_MAX_CHANGED_FILES,
    "maxChangedFiles",
    10_000
  );
  const maxAddedLines = validateNonNegativeInteger(
    options.maxAddedLines ?? DEFAULT_MAX_ADDED_LINES,
    "maxAddedLines",
    10_000_000
  );
  const maxDeletedLines = validateNonNegativeInteger(
    options.maxDeletedLines ?? DEFAULT_MAX_DELETED_LINES,
    "maxDeletedLines",
    10_000_000
  );
  const maxFileBytes = validateNonNegativeInteger(
    options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    "maxFileBytes",
    100_000_000
  );

  const forbidden = safeChanges.filter(({ path }) => isForbiddenPath(path)).map(({ path }) => path);
  const additions = safeChanges.reduce((sum, change) => sum + change.additions, 0);
  const deletions = safeChanges.reduce((sum, change) => sum + change.deletions, 0);
  const oversized = safeChanges.filter(({ bytes }) => bytes > maxFileBytes).map(({ path }) => path);

  const violations = [];
  if (safeChanges.length > maxChangedFiles) {
    violations.push({ code: "TOO_MANY_CHANGED_FILES", limit: maxChangedFiles, actual: safeChanges.length });
  }
  if (additions > maxAddedLines) {
    violations.push({ code: "TOO_MANY_ADDITIONS", limit: maxAddedLines, actual: additions });
  }
  if (deletions > maxDeletedLines) {
    violations.push({ code: "TOO_MANY_DELETIONS", limit: maxDeletedLines, actual: deletions });
  }
  if (forbidden.length > 0) {
    violations.push({ code: "FORBIDDEN_PATHS", paths: forbidden });
  }
  if (oversized.length > 0) {
    violations.push({ code: "FILES_TOO_LARGE", paths: oversized, limit: maxFileBytes });
  }

  return {
    allowed: violations.length === 0,
    changedFiles: safeChanges.length,
    additions,
    deletions,
    violations
  };
}

export function assertChangesSafe(changes, options = {}) {
  const result = verifyChanges(changes, options);
  if (!result.allowed) {
    throw new VerificationError("proposed changes failed safety verification", "CHANGES_REJECTED", result);
  }
  return result;
}
