const DEFAULT_RATE_LIMIT = 60;
const DEFAULT_RATE_WINDOW_MS = 60_000;
const DEFAULT_CONCURRENT_TASKS = 2;
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const MAX_RATE_ENTRIES = 2_048;

export class SlidingWindowLimiter {
  #limit;
  #windowMs;
  #entries = new Map();
  constructor({ limit = DEFAULT_RATE_LIMIT, windowMs = DEFAULT_RATE_WINDOW_MS } = {}) {
    this.#limit = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_RATE_LIMIT;
    this.#windowMs = Number.isInteger(windowMs) && windowMs >= 1_000 ? windowMs : DEFAULT_RATE_WINDOW_MS;
  }
  allow(key, now = Date.now()) {
    const safeKey = typeof key === "string" && key ? key.slice(0, 128) : "unknown";
    let timestamps = this.#entries.get(safeKey) || [];
    const cutoff = now - this.#windowMs;
    timestamps = timestamps.filter((value) => value > cutoff);
    const allowed = timestamps.length < this.#limit;
    if (allowed) timestamps.push(now);
    if (timestamps.length) this.#entries.set(safeKey, timestamps);
    else this.#entries.delete(safeKey);
    if (this.#entries.size > MAX_RATE_ENTRIES) {
      const oldest = [...this.#entries.entries()].sort((a, b) => (a[1][0] || 0) - (b[1][0] || 0)).slice(0, Math.ceil(this.#entries.size / 10));
      for (const [entryKey] of oldest) this.#entries.delete(entryKey);
    }
    return allowed;
  }
}

export class ConcurrentTaskLimiter {
  #limit;
  #active = new Map();
  constructor({ limit = DEFAULT_CONCURRENT_TASKS } = {}) { this.#limit = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_CONCURRENT_TASKS; }
  tryAcquire(ownerId) {
    const key = String(ownerId);
    const current = this.#active.get(key) || 0;
    if (current >= this.#limit) return false;
    this.#active.set(key, current + 1);
    return true;
  }
  release(ownerId) {
    const key = String(ownerId);
    const current = this.#active.get(key) || 0;
    if (current <= 1) this.#active.delete(key); else this.#active.set(key, current - 1);
  }
  count(ownerId) { return this.#active.get(String(ownerId)) || 0; }
}

export function securityHeaders({ production = process.env.NODE_ENV === "production" } = {}) {
  const headers = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "content-security-policy": "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: https:"
  };
  if (production) headers["strict-transport-security"] = "max-age=31536000; includeSubDomains";
  return headers;
}

export function clientKey(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || String(req.socket?.remoteAddress || "unknown");
}

export function getHardeningConfig(env = process.env) {
  const number = (name, fallback) => {
    const value = Number(env[name]);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  };
  return {
    rateLimit: number("PINAKA_RATE_LIMIT", DEFAULT_RATE_LIMIT),
    rateWindowMs: number("PINAKA_RATE_WINDOW_MS", DEFAULT_RATE_WINDOW_MS),
    concurrentTasks: number("PINAKA_MAX_CONCURRENT_TASKS", DEFAULT_CONCURRENT_TASKS),
    requestTimeoutMs: number("PINAKA_REQUEST_TIMEOUT_MS", DEFAULT_REQUEST_TIMEOUT_MS)
  };
}

export const __test = Object.freeze({ DEFAULT_RATE_LIMIT, DEFAULT_RATE_WINDOW_MS, DEFAULT_CONCURRENT_TASKS, DEFAULT_REQUEST_TIMEOUT_MS });
