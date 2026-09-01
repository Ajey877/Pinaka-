import fs from "node:fs/promises";
import path from "node:path";
import { ToolError } from "./errors.mjs";
import { resolveSafePath } from "./path-policy.mjs";

const DEFAULT_MAX_READ_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_WRITE_BYTES = 2 * 1024 * 1024;

export async function listFiles(rootDirectory, relativeDirectory = ".") {
  const directory = resolveSafePath(rootDirectory, relativeDirectory);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => !entry.isSymbolicLink())
    .map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other"
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function readTextFile(rootDirectory, relativePath, options = {}) {
  const filePath = resolveSafePath(rootDirectory, relativePath);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_READ_BYTES;
  const stat = await fs.stat(filePath);

  if (!stat.isFile()) {
    throw new ToolError("path is not a regular file", "NOT_A_FILE");
  }
  if (stat.size > maxBytes) {
    throw new ToolError("file exceeds the read size limit", "FILE_TOO_LARGE", {
      size: stat.size,
      maxBytes
    });
  }

  return fs.readFile(filePath, "utf8");
}

export async function writeTextFile(rootDirectory, relativePath, content, options = {}) {
  if (typeof content !== "string") {
    throw new ToolError("file content must be a string", "INVALID_ARGUMENT");
  }

  const maxBytes = options.maxBytes ?? DEFAULT_MAX_WRITE_BYTES;
  const contentBytes = Buffer.byteLength(content, "utf8");
  if (contentBytes > maxBytes) {
    throw new ToolError("file content exceeds the write size limit", "FILE_TOO_LARGE", {
      size: contentBytes,
      maxBytes
    });
  }

  const filePath = resolveSafePath(rootDirectory, relativePath);
  const exists = await fs.access(filePath).then(() => true).catch(() => false);

  if (exists && options.overwrite !== true) {
    throw new ToolError("refusing to overwrite an existing file without explicit approval", "FILE_EXISTS");
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
  return { path: relativePath, bytesWritten: contentBytes };
}
