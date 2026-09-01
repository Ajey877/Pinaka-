import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const MAX_TASKS = 256;
const MAX_EVENTS_PER_TASK = 128;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function safeRecord(record) {
  if (!record || typeof record !== "object" || typeof record.id !== "string") return null;
  const safe = clone(record);
  delete safe.githubToken;
  delete safe.apiKey;
  delete safe.modelApiKey;
  delete safe.clientSecret;
  if (safe.credentials && typeof safe.credentials === "object") delete safe.credentials;
  if (Array.isArray(safe.events)) safe.events = safe.events.slice(-MAX_EVENTS_PER_TASK);
  return safe;
}

function normalizeState(value) {
  if (!value || typeof value !== "object") return { version: 1, tasks: [] };
  const tasks = Array.isArray(value.tasks) ? value.tasks.map(safeRecord).filter(Boolean).slice(-MAX_TASKS) : [];
  return { version: 1, tasks };
}

export class PersistentTaskStore {
  #filePath;
  #state;
  #writeChain = Promise.resolve();

  constructor({ filePath = path.resolve(process.cwd(), ".pinaka-data", "tasks.json") } = {}) {
    this.#filePath = path.resolve(filePath);
    this.#state = this.#loadSync();
  }

  list(ownerId = null) {
    return this.#state.tasks
      .filter((task) => ownerId === null || task.ownerId === ownerId)
      .map(clone);
  }

  get(taskId) {
    const task = this.#state.tasks.find((item) => item.id === taskId);
    return task ? clone(task) : null;
  }

  save(task) {
    const safe = safeRecord(task);
    if (!safe) throw new TypeError("task record is invalid");
    const index = this.#state.tasks.findIndex((item) => item.id === safe.id);
    if (index >= 0) this.#state.tasks[index] = safe;
    else this.#state.tasks.push(safe);
    if (this.#state.tasks.length > MAX_TASKS) this.#state.tasks.splice(0, this.#state.tasks.length - MAX_TASKS);
    return this.flush();
  }

  remove(taskId) {
    const before = this.#state.tasks.length;
    this.#state.tasks = this.#state.tasks.filter((item) => item.id !== taskId);
    return before === this.#state.tasks.length ? Promise.resolve(false) : this.flush().then(() => true);
  }

  async flush() {
    const snapshot = JSON.stringify(this.#state, null, 2) + "\n";
    if (Buffer.byteLength(snapshot, "utf8") > MAX_FILE_BYTES) throw new Error("persistent task store is too large");
    const directory = path.dirname(this.#filePath);
    const tempPath = `${this.#filePath}.${process.pid}.tmp`;
    this.#writeChain = this.#writeChain.then(async () => {
      await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
      await fsp.writeFile(tempPath, snapshot, { encoding: "utf8", mode: 0o600 });
      await fsp.rename(tempPath, this.#filePath);
    });
    return this.#writeChain;
  }

  get filePath() { return this.#filePath; }

  #loadSync() {
    try {
      const stats = fs.statSync(this.#filePath);
      if (stats.size > MAX_FILE_BYTES) throw new Error("persistent task store is too large");
      return normalizeState(JSON.parse(fs.readFileSync(this.#filePath, "utf8")));
    } catch (error) {
      if (error?.code === "ENOENT") return { version: 1, tasks: [] };
      throw new Error(`unable to load persistent task store: ${error.message}`);
    }
  }
}

export const __test = Object.freeze({ safeRecord, normalizeState });
