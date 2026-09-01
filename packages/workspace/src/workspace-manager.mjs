import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { WorkspaceError } from "./errors.mjs";

const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const DEFAULT_ROOT_DIRECTORY = path.join(process.cwd(), ".pinaka-workspaces");

function validateTaskId(taskId) {
  if (typeof taskId !== "string" || !TASK_ID_PATTERN.test(taskId)) {
    throw new WorkspaceError(
      "taskId must contain only letters, numbers, underscores, and hyphens",
      "INVALID_TASK_ID"
    );
  }
  return taskId;
}

function validateRootDirectory(rootDirectory) {
  if (typeof rootDirectory !== "string" || rootDirectory.trim() === "") {
    throw new WorkspaceError("rootDirectory is required", "INVALID_ROOT_DIRECTORY");
  }
  return path.resolve(rootDirectory);
}

export class WorkspaceManager {
  #rootDirectory;
  #workspaces = new Map();
  #creating = new Set();

  constructor({ rootDirectory = DEFAULT_ROOT_DIRECTORY } = {}) {
    this.#rootDirectory = validateRootDirectory(rootDirectory);
  }

  get rootDirectory() {
    return this.#rootDirectory;
  }

  async initialize() {
    await fs.mkdir(this.#rootDirectory, { recursive: true });
    return this;
  }

  async create(taskId) {
    validateTaskId(taskId);
    if (this.#workspaces.has(taskId) || this.#creating.has(taskId)) {
      throw new WorkspaceError(`workspace already exists for task: ${taskId}`, "WORKSPACE_EXISTS");
    }

    this.#creating.add(taskId);
    try {
      await this.initialize();
      const workspaceId = crypto.randomUUID();
      const workspacePath = path.join(this.#rootDirectory, `${taskId}-${workspaceId}`);
      await fs.mkdir(workspacePath, { recursive: false });

      const record = Object.freeze({
        id: workspaceId,
        taskId,
        path: workspacePath,
        status: "active"
      });
      this.#workspaces.set(taskId, record);
      return record;
    } catch (error) {
      if (error instanceof WorkspaceError) throw error;
      throw new WorkspaceError(`failed to create workspace: ${error.message}`, "CREATE_FAILED");
    } finally {
      this.#creating.delete(taskId);
    }
  }

  get(taskId) {
    validateTaskId(taskId);
    const workspace = this.#workspaces.get(taskId);
    if (!workspace) {
      throw new WorkspaceError(`workspace not found for task: ${taskId}`, "WORKSPACE_NOT_FOUND");
    }
    return workspace;
  }

  has(taskId) {
    if (typeof taskId !== "string" || !TASK_ID_PATTERN.test(taskId)) return false;
    return this.#workspaces.has(taskId);
  }

  list() {
    return [...this.#workspaces.values()];
  }

  async release(taskId) {
    const workspace = this.get(taskId);
    await fs.rm(workspace.path, { recursive: true, force: false });
    this.#workspaces.delete(taskId);
    return { ...workspace, status: "released" };
  }

  async discard(taskId) {
    const workspace = this.get(taskId);
    await fs.rm(workspace.path, { recursive: true, force: true });
    this.#workspaces.delete(taskId);
    return { ...workspace, status: "discarded" };
  }
}
