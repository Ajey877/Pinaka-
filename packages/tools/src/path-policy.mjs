import path from "node:path";
import { ToolError } from "./errors.mjs";

export function resolveSafePath(rootDirectory, relativePath = ".") {
  if (typeof rootDirectory !== "string" || rootDirectory.trim() === "") {
    throw new ToolError("workspace root is required", "INVALID_ARGUMENT");
  }
  if (typeof relativePath !== "string" || relativePath.trim() === "") {
    throw new ToolError("relative path is required", "INVALID_ARGUMENT");
  }

  const root = path.resolve(rootDirectory);
  const candidate = path.resolve(root, relativePath);
  const relative = path.relative(root, candidate);

  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new ToolError("path escapes the workspace", "PATH_OUTSIDE_WORKSPACE", {
      path: relativePath
    });
  }

  return candidate;
}
