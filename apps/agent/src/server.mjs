import http from "node:http";
import { createPlan, getHealth } from "@pinaka/core";
import { sendWebAsset } from "./web-server.mjs";
import { createToolRegistry } from "./tool-runtime.mjs";
import { AgentTaskRunner } from "./task-runner.mjs";
import { ApprovalService } from "./approval-service.mjs";
import { GitHubAuthService } from "./auth-service.mjs";
import { PersistentTaskStore } from "./task-store.mjs";
import { SlidingWindowLimiter, ConcurrentTaskLimiter, clientKey, getHardeningConfig, securityHeaders } from "./hardening.mjs";

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const MAX_BODY_BYTES = 256 * 1024;
const ROOT = process.env.PINAKA_WORKSPACE_ROOT || process.cwd();
const DATA_ROOT = process.env.PINAKA_DATA_ROOT || `${ROOT}/.pinaka-data`;
const taskStore = new PersistentTaskStore({ filePath: `${DATA_ROOT}/tasks.json` });
const taskRunner = new AgentTaskRunner({ workspaceRoot: process.env.PINAKA_AGENT_WORKSPACE_ROOT || `${ROOT}/.pinaka-workspaces` });
const approvalService = new ApprovalService({ workspaceRoot: `${ROOT}/.pinaka-approvals` });
const authService = new GitHubAuthService();
const tools = createToolRegistry({ workspaceRoot: ROOT });
const TERMINAL = new Set(["completed", "needs_attention", "failed", "rejected", "approved"]);
const HARDENING = getHardeningConfig();
const requestLimiter = new SlidingWindowLimiter({ limit: HARDENING.rateLimit, windowMs: HARDENING.rateWindowMs });
const taskLimiter = new ConcurrentTaskLimiter({ limit: HARDENING.concurrentTasks });

function json(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { ...securityHeaders(), "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-length": Buffer.byteLength(body), ...headers });
  res.end(body);
}
async function readJson(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY_BYTES) throw Object.assign(new Error("request body is too large"), { statusCode: 413, code: "BODY_TOO_LARGE" }); chunks.push(chunk); }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw Object.assign(new Error("request body must contain valid JSON"), { statusCode: 400, code: "INVALID_JSON" }); }
}
function session(req) { const value = authService.getSession(req.headers); if (!value) throw Object.assign(new Error("GitHub sign-in is required"), { statusCode: 401, code: "AUTH_REQUIRED" }); return value; }
function sameOrigin(req) { const configured = String(process.env.PINAKA_PUBLIC_ORIGIN || "").trim().replace(/\/$/, ""); const protocol = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() || (req.socket.encrypted ? "https" : "http"); const expected = configured || `${protocol}://${req.headers.host}`; const origin = String(req.headers.origin || "").replace(/\/$/, ""); if (origin && origin !== expected) throw Object.assign(new Error("request origin is not allowed"), { statusCode: 403, code: "CSRF_ORIGIN_REJECTED" }); if (!origin) { const referer = String(req.headers.referer || ""); if (!referer.startsWith(`${expected}/`)) throw Object.assign(new Error("request origin could not be verified"), { statusCode: 403, code: "CSRF_ORIGIN_REQUIRED" }); } }
function mutationSession(req) { const value = session(req); if (req.headers["x-csrf-token"]) authService.assertCsrf(req.headers); else sameOrigin(req); return value; }
function taskId(pathname) { return pathname.match(/^\/v1\/agent\/tasks\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})$/)?.[1] || null; }
function eventsId(pathname) { return pathname.match(/^\/v1\/agent\/tasks\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/events$/)?.[1] || null; }
function approvalId(pathname) { return pathname.match(/^\/v1\/agent\/tasks\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/approval$/)?.[1] || null; }
function getTask(id) { try { return taskRunner.get(id); } catch (error) { if (error?.code !== "TASK_NOT_FOUND") throw error; const saved = taskStore.get(id); if (!saved) throw error; return saved; } }
function owned(id, userId) { const job = getTask(id); if (job.ownerId !== userId) throw Object.assign(new Error("task is not accessible to this GitHub account"), { statusCode: 403, code: "TASK_FORBIDDEN" }); return job; }
function decorated(job) { const result = approvalService.decorate(job); if (job.approval && typeof job.approval === "object") result.approval = job.approval; return result; }
async function checkpoint(id) { try { const job = taskRunner.get(id); await taskStore.save({ ...job, events: taskRunner.events(id) }); } catch {} }
function track(job) { void checkpoint(job.id); let off = null; try { off = taskRunner.subscribe(job.id, () => { void checkpoint(job.id); }); } catch {} }
function writeSse(res, event) { res.write(`id: ${event.id}\nevent: task\ndata: ${JSON.stringify(event)}\n\n`); }
function stream(res, id) { let history; let live = true; try { history = taskRunner.events(id); } catch { live = false; history = getTask(id).events || []; } res.writeHead(200, { ...securityHeaders(), "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-store, must-revalidate", "connection": "keep-alive", "x-accel-buffering": "no" }); res.flushHeaders?.(); res.write(": connected\n\n"); history.forEach((event) => writeSse(res, event)); if (!live || !history.at(-1) || TERMINAL.has(history.at(-1).status)) { res.end(); return; } let closed = false; const heartbeat = setInterval(() => { if (!closed) res.write(": heartbeat\n\n"); }, 15000); const off = taskRunner.subscribe(id, (event) => { if (closed) return; writeSse(res, event); if (TERMINAL.has(event.status)) { closed = true; clearInterval(heartbeat); off(); res.end(); } }); res.on("close", () => { closed = true; clearInterval(heartbeat); off(); }); }

const server = http.createServer(async (req, res) => {
  let timeout = null;
  try {
    timeout = setTimeout(() => { if (!res.writableEnded) { res.writeHead(408, { ...securityHeaders(), "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify({ error: "request_timeout", code: "REQUEST_TIMEOUT" })); } req.destroy(); }, HARDENING.requestTimeoutMs);
    if (req.method !== "GET" && !requestLimiter.allow(clientKey(req))) throw Object.assign(new Error("request rate limit exceeded"), { statusCode: 429, code: "RATE_LIMITED" });
    if (req.method === "OPTIONS") { res.writeHead(204, { ...securityHeaders(), "cache-control": "no-store", "allow": "GET,POST,OPTIONS" }); return res.end(); }
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (req.method === "GET" && url.pathname === "/auth/github") { res.writeHead(302, { ...securityHeaders(), location: authService.begin(), "cache-control": "no-store" }); return res.end(); }
    if (req.method === "GET" && url.pathname === "/auth/github/callback") { const result = await authService.callback({ code: url.searchParams.get("code") || "", state: url.searchParams.get("state") || "" }); res.writeHead(302, { ...securityHeaders(), location: "/?auth=success", "set-cookie": result.setCookies, "cache-control": "no-store" }); return res.end(); }
    if (req.method === "GET" && url.pathname === "/v1/auth/me") { const value = authService.getSession(req.headers); return json(res, 200, { authenticated: Boolean(value), user: value?.user || null }); }
    if (req.method === "POST" && url.pathname === "/v1/auth/logout") { mutationSession(req); return json(res, 200, { authenticated: false }, { "set-cookie": authService.logout(req.headers) }); }
    if (req.method === "GET" && await sendWebAsset(res, url.pathname)) return;
    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, getHealth());
    if (req.method === "GET" && url.pathname === "/v1/tools") return json(res, 200, { tools: tools.list() });
    if (req.method === "POST" && url.pathname === "/v1/agent/plan") { const body = await readJson(req); return json(res, 200, createPlan(body.task)); }
    if (req.method === "POST" && url.pathname === "/v1/agent/run") {
      const user = mutationSession(req);
      if (!taskLimiter.tryAcquire(user.user.id)) throw Object.assign(new Error("maximum concurrent tasks reached"), { statusCode: 429, code: "TASK_CONCURRENCY_LIMIT" });
      try {
        const body = await readJson(req);
        const job = await taskRunner.start({ ...body, ownerId: user.user.id, githubToken: user.githubToken });
        await taskStore.save({ ...job, events: taskRunner.events(job.id) }); track(job);
        return json(res, 202, decorated(job));
      } catch (error) { taskLimiter.release(user.user.id); throw error; }
    }
    if (req.method === "GET" && url.pathname === "/v1/agent/tasks") { const user = session(req); const jobs = new Map(taskStore.list(user.user.id).map((job) => [job.id, job])); for (const job of taskRunner.list(user.user.id)) jobs.set(job.id, job); return json(res, 200, { tasks: [...jobs.values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).map(decorated) }); }
    if (req.method === "POST") { const id = approvalId(url.pathname); if (id) { const user = mutationSession(req); const job = owned(id, user.user.id); const body = await readJson(req); if (job.approval?.status && job.approval.status !== "pending") throw Object.assign(new Error("approval decision already recorded"), { statusCode: 409, code: "APPROVAL_ALREADY_DECIDED" }); const updated = await approvalService.decide(job, body.decision, { githubToken: user.githubToken }); await taskStore.save(updated); return json(res, 200, decorated(updated)); } }
    if (req.method === "GET") { const eid = eventsId(url.pathname); if (eid) { const user = session(req); owned(eid, user.user.id); return stream(res, eid); } const id = taskId(url.pathname); if (id) { const user = session(req); return json(res, 200, decorated(owned(id, user.user.id))); } }
    return json(res, 404, { error: "not_found", message: "endpoint not found" });
  } catch (error) {
    const status = Number.isInteger(error?.statusCode) ? error.statusCode : 400;
    return json(res, status, { error: status >= 500 ? "internal_error" : "invalid_request", message: error?.message || "request failed", code: error?.code || null, ...(status === 429 ? { retryAfterMs: HARDENING.rateWindowMs } : {}) });
  } finally { if (timeout) clearTimeout(timeout); }
});
server.listen(PORT, HOST, () => console.log(`Pinaka agent listening on http://${HOST}:${PORT}`));
function shutdown(signal) { console.log(`Received ${signal}; shutting down.`); server.close(() => process.exit(0)); }
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
