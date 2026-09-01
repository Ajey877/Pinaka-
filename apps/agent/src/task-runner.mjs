import crypto from "node:crypto";
import { WorkspaceManager } from "@pinaka/workspace";
import { GitRepository } from "@pinaka/git";
import { ModelRouter, OpenAICompatibleProvider } from "@pinaka/model";
import { runAutonomousRepairLoop } from "@pinaka/core";
import { createToolRegistry } from "./tool-runtime.mjs";

const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const MAX_REPOSITORY_URL = 2_048;
const MAX_TASK_CHARS = 20_000;
const MAX_JOBS = 64;
const MAX_EVENTS_PER_TASK = 64;

function validateText(value, name, maxLength) {
  if (typeof value !== "string" || value.trim() === "" || value.length > maxLength) {
    const error = new Error(`${name} is required and must be at most ${maxLength} characters`);
    error.statusCode = 400;
    error.code = `INVALID_${name.toUpperCase()}`;
    throw error;
  }
  return value.trim();
}

function validateRepositoryUrl(repositoryUrl) {
  const value = validateText(repositoryUrl, "repositoryUrl", MAX_REPOSITORY_URL);
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/i.test(value)) {
    const error = new Error("repositoryUrl must be an HTTPS GitHub repository URL");
    error.statusCode = 400;
    error.code = "INVALID_REPOSITORY_URL";
    throw error;
  }
  return value;
}

function validateTaskId(taskId) {
  if (typeof taskId !== "string" || !TASK_ID_PATTERN.test(taskId)) {
    const error = new Error("invalid task id");
    error.statusCode = 400;
    error.code = "INVALID_TASK_ID";
    throw error;
  }
  return taskId;
}

function buildDefaultRouter({ apiKey = "", baseUrl, model } = {}) {
  const resolvedBaseUrl = baseUrl || process.env.PINAKA_MODEL_BASE_URL || "https://openrouter.ai/api/v1";
  const resolvedModel = model || process.env.PINAKA_MODEL || "";
  if (!resolvedModel) {
    const error = new Error("PINAKA_MODEL is required to run an AI task");
    error.statusCode = 503;
    error.code = "MODEL_NOT_CONFIGURED";
    throw error;
  }

  const provider = new OpenAICompatibleProvider({
    baseUrl: resolvedBaseUrl,
    apiKey: apiKey || process.env.OPENROUTER_API_KEY || process.env.PINAKA_MODEL_API_KEY || "",
    model: resolvedModel
  });
  return new ModelRouter().register("default", provider, { defaultProvider: true });
}

function makeJob(taskId, repositoryUrl, task) {
  return {
    id: taskId,
    repositoryUrl,
    task,
    status: "queued",
    stage: "queued",
    message: "Waiting to start",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    result: null,
    error: null
  };
}

export class AgentTaskRunner {
  #workspaceManager;
  #jobs = new Map();
  #eventHistory = new Map();
  #subscribers = new Map();
  #routerFactory;
  #gitFactory;
  #registryFactory;
  #agentRunner;
  #githubToken;

  constructor({
    workspaceRoot,
    workspaceManager,
    routerFactory = buildDefaultRouter,
    gitFactory = ({ workspaceRoot: root }) => new GitRepository({ workspaceRoot: root }),
    registryFactory = ({ workspaceRoot: root, githubToken }) => createToolRegistry({ workspaceRoot: root, githubToken }),
    agentRunner = runAutonomousRepairLoop,
    githubToken = ""
  } = {}) {
    this.#workspaceManager = workspaceManager || new WorkspaceManager({ rootDirectory: workspaceRoot });
    this.#routerFactory = routerFactory;
    this.#gitFactory = gitFactory;
    this.#registryFactory = registryFactory;
    this.#agentRunner = agentRunner;
    this.#githubToken = githubToken;
  }

  list() {
    return [...this.#jobs.values()].map((job) => ({ ...job }));
  }

  get(taskId) {
    validateTaskId(taskId);
    const job = this.#jobs.get(taskId);
    if (!job) {
      const error = new Error("task not found");
      error.statusCode = 404;
      error.code = "TASK_NOT_FOUND";
      throw error;
    }
    return { ...job };
  }

  subscribe(taskId, listener) {
    validateTaskId(taskId);
    if (!this.#jobs.has(taskId)) {
      const error = new Error("task not found");
      error.statusCode = 404;
      error.code = "TASK_NOT_FOUND";
      throw error;
    }
    if (typeof listener !== "function") throw new TypeError("event listener must be a function");

    let listeners = this.#subscribers.get(taskId);
    if (!listeners) {
      listeners = new Set();
      this.#subscribers.set(taskId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#subscribers.delete(taskId);
    };
  }

  events(taskId) {
    validateTaskId(taskId);
    if (!this.#jobs.has(taskId)) {
      const error = new Error("task not found");
      error.statusCode = 404;
      error.code = "TASK_NOT_FOUND";
      throw error;
    }
    return [...(this.#eventHistory.get(taskId) || [])];
  }

  async start({ repositoryUrl, task, taskId = crypto.randomUUID().replaceAll("-", "").slice(0, 20), model, apiKey, baseUrl } = {}) {
    const safeRepositoryUrl = validateRepositoryUrl(repositoryUrl);
    const safeTask = validateText(task, "task", MAX_TASK_CHARS);
    validateTaskId(taskId);

    if (this.#jobs.has(taskId)) {
      const error = new Error(`task already exists: ${taskId}`);
      error.statusCode = 409;
      error.code = "TASK_EXISTS";
      throw error;
    }
    if (this.#jobs.size >= MAX_JOBS) {
      const error = new Error("too many retained task results");
      error.statusCode = 429;
      error.code = "TASK_CAPACITY_REACHED";
      throw error;
    }

    const job = makeJob(taskId, safeRepositoryUrl, safeTask);
    this.#jobs.set(taskId, job);
    this.#eventHistory.set(taskId, []);
    this.#emit(job, "queued", "Task queued");
    void this.#run(job, { model, apiKey, baseUrl });
    return { ...job };
  }

  #emit(job, stage, message, data = {}) {
    const event = Object.freeze({
      id: crypto.randomUUID(),
      taskId: job.id,
      stage,
      message,
      status: job.status,
      timestamp: new Date().toISOString(),
      data: data && typeof data === "object" ? { ...data } : {}
    });

    const history = this.#eventHistory.get(job.id) || [];
    if (history.length >= MAX_EVENTS_PER_TASK) history.shift();
    history.push(event);
    this.#eventHistory.set(job.id, history);

    for (const listener of this.#subscribers.get(job.id) || []) {
      try {
        listener(event);
      } catch {
        // A disconnected event consumer must never affect task execution.
      }
    }
  }

  #update(job, patch) {
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    this.#emit(job, job.stage, job.message);
  }

  async #run(job, modelOptions) {
    let workspace = null;
    try {
      this.#update(job, { status: "running", stage: "workspace", message: "Creating an isolated workspace" });
      workspace = await this.#workspaceManager.create(job.id);

      this.#update(job, { stage: "clone", message: "Cloning the repository" });
      const git = this.#gitFactory({ workspaceRoot: workspace.path });
      await git.clone(job.repositoryUrl);

      this.#update(job, { stage: "branch", message: "Creating an isolated agent branch" });
      await git.createBranch(`agent/${job.id}`);

      this.#update(job, { stage: "model", message: "Running Pinaka against the repository" });
      const registry = this.#registryFactory({ workspaceRoot: workspace.path, githubToken: this.#githubToken });
      const router = this.#routerFactory(modelOptions);
      const result = await this.#agentRunner({
        registry,
        router,
        task: job.task,
        provider: "default"
      });

      this.#update(job, {
        status: result.status === "passed" || result.status === "repaired" ? "completed" : "needs_attention",
        stage: "complete",
        message: result.status === "repaired" ? "Task repaired and verified" : result.status === "passed" ? "Task verified" : "Task finished without full verification",
        result
      });
    } catch (error) {
      this.#update(job, {
        status: "failed",
        stage: "error",
        message: error?.message || "Task failed",
        error: {
          code: error?.code || "TASK_FAILED",
          message: error?.message || "Task failed"
        }
      });
    } finally {
      if (workspace) {
        try {
          await this.#workspaceManager.release(job.id);
        } catch {
          try {
            await this.#workspaceManager.discard(job.id);
          } catch {
            // Best-effort cleanup. The task result already records the failure state.
          }
        }
      }
    }
  }
}
