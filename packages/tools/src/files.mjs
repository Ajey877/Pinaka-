import fs from "node:fs/promises";
import path from "node:path";
import { ToolError } from "./errors.mjs";
import { resolveSafePath } from "./path-policy.mjs";

const DEFAULT_MAX_READ_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_WRITE_BYTES = 2 * 1024 * 1024;

async function assertResolvedInsideWorkspace(rootDirectory, targetPath) {
  const root = path.resolve(rootDirectory);
  const realRoot = await fs.realpath(root);
  const realTarget = await fs.realpath(targetPath);
  const relative = path.relative(realRoot, realTarget);

  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new ToolError("resolved path escapes the workspace", "PATH_OUTSIDE_WORKSPACE");
  }
}

export async function listFiles(rootDirectory, relativeDirectory = ".") {
  const directory = resolveSafePath(rootDirectory, relativeDirectory);
  await assertResolvedInsideWorkspace(rootDirectory, directory);
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
  await assertResolvedInsideWorkspace(rootDirectory, filePath);
  const stat = await fs.lstat(filePath);

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
  const exists = await fs.lstat(filePath).then(() => true).catch((error) => {
    if (error?.code === "ENOENT") return false;
    throw error;
  });

  if (exists) {
    const stat = await fs.lstat(filePath);
    if (stat.isSymbolicLink()) {
      throw new ToolError("refusing to write through a symbolic link", "SYMLINK_NOT_ALLOWED");
    }
    await assertResolvedInsideWorkspace(rootDirectory, filePath);
    if (stat.isDirectory()) {
      throw new ToolError("cannot write to a directory", "NOT_A_FILE");
    }
    if (options.overwrite !== true) {
      throw new ToolError("refusing to overwrite an existing file without explicit approval", "FILE_EXISTS");
    }
  } else {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await assertResolvedInsideWorkspace(rootDirectory, path.dirname(filePath));
  }

  await fs.writeFile(filePath, content, "utf8");
  return { path: relativePath, bytesWritten: contentBytes };
}
