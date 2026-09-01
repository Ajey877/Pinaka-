import http from "node:http";
import { createPlan, getHealth } from "@pinaka/core";
import { sendWebAsset } from "./web-server.mjs";
import { createToolRegistry } from "./tool-runtime.mjs";
import { AgentTaskRunner } from "./task-runner.mjs";
import { ApprovalService } from "./approval-service.mjs";

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const MAX_BODY_BYTES = 256 * 1024;
const WORKSPACE_ROOT = process.env.PINAKA_WORKSPACE_ROOT || process.cwd();
const toolRegistry = createToolRegistry({ workspaceRoot: WORKSPACE_ROOT, githubToken: process.env.GITHUB_TOKEN || "" });
const taskRunner = new AgentTaskRunner({ workspaceRoot: process.env.PINAKA_AGENT_WORKSPACE_ROOT || `${WORKSPACE_ROOT}/.pinaka-workspaces`, githubToken: process.env.GITHUB_TOKEN || "" });
const approvalService = new ApprovalService({ workspaceRoot: `${WORKSPACE_ROOT}/.pinaka-approvals` });
const TERMINAL_STATUSES = new Set(["completed", "needs_attention", "failed"]);

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,OPTIONS" });
  res.end(body);
}
async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) { const error = new Error("request body is too large"); error.statusCode = 413; throw error; }
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { const error = new Error("request body must contain valid JSON"); error.statusCode = 400; throw error; }
}
function extractTaskId(pathname) { return pathname.match(/^\/v1\/agent\/tasks\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})$/)?.[1] || null; }
function extractTaskEventsId(pathname) { return pathname.match(/^\/v1\/agent\/tasks\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/events$/)?.[1] || null; }
function extractApprovalId(pathname) { return pathname.match(/^\/v1\/agent\/tasks\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/approval$/)?.[1] || null; }
function writeSse(res, event) { res.write(`id: ${event.id}\n`); res.write("event: task\n"); res.write(`data: ${JSON.stringify(event)}\n\n`); }
function streamTaskEvents(res, taskId) {
  const history = taskRunner.events(taskId);
  res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-store, must-revalidate", "connection": "keep-alive", "x-accel-buffering": "no", "access-control-allow-origin": "*" });
  res.flushHeaders?.();
  res.write(": connected\n\n");
  for (const event of history) writeSse(res, event);
  const lastEvent = history.at(-1);
  if (lastEvent && TERMINAL_STATUSES.has(lastEvent.status)) { res.end(); return; }
  let closed = false;
  let heartbeat = null;
  const unsubscribe = taskRunner.subscribe(taskId, (event) => {
    if (closed) return;
    writeSse(res, event);
    if (TERMINAL_STATUSES.has(event.status)) { closed = true; if (heartbeat) clearInterval(heartbeat); unsubscribe(); res.end(); }
  });
  heartbeat = setInterval(() => { if (!closed) res.write(": heartbeat\n\n"); }, 15_000);
  res.on("close", () => { closed = true; if (heartbeat) clearInterval(heartbeat); unsubscribe(); });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET,POST,OPTIONS" }); res.end(); return; }
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (req.method === "GET" && await sendWebAsset(res, url.pathname)) return;
    if (req.method === "GET" && url.pathname === "/health") { sendJson(res, 200, getHealth()); return; }
    if (req.method === "GET" && url.pathname === "/v1/tools") { sendJson(res, 200, { tools: toolRegistry.list() }); return; }
    if (req.method === "POST" && url.pathname === "/v1/agent/plan") { const body = await readJson(req); sendJson(res, 200, createPlan(body.task)); return; }
    if (req.method === "POST" && url.pathname === "/v1/agent/run") { const body = await readJson(req); const job = await taskRunner.start(body); sendJson(res, 202, approvalService.decorate(job)); return; }
    if (req.method === "GET" && url.pathname === "/v1/agent/tasks") { sendJson(res, 200, { tasks: taskRunner.list().map((job) => approvalService.decorate(job)) }); return; }
    if (req.method === "POST") {
      const approvalTaskId = extractApprovalId(url.pathname);
      if (approvalTaskId) { const body = await readJson(req); const updated = await approvalService.decide(taskRunner.get(approvalTaskId), body.decision); sendJson(res, 200, updated); return; }
    }
    if (req.method === "GET") {
      const eventsTaskId = extractTaskEventsId(url.pathname);
      if (eventsTaskId) { streamTaskEvents(res, eventsTaskId); return; }
      const taskId = extractTaskId(url.pathname);
      if (taskId) { sendJson(res, 200, approvalService.decorate(taskRunner.get(taskId))); return; }
    }
    sendJson(res, 404, { error: "not_found", message: "endpoint not found" });
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 400;
    sendJson(res, statusCode, { error: statusCode >= 500 ? "internal_error" : "invalid_request", message: error?.message || "request failed", code: error?.code || null });
  }
});
server.listen(PORT, HOST, () => console.log(`Pinaka agent listening on http://${HOST}:${PORT}`));
function shutdown(signal) { console.log(`Received ${signal}; shutting down.`); server.close(() => process.exit(0)); }
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
