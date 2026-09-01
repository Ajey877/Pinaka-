import http from "node:http";
import { createPlan, getHealth } from "@pinaka/core";
import { sendWebAsset } from "./web-server.mjs";
import { createToolRegistry } from "./tool-runtime.mjs";
import { AgentTaskRunner } from "./task-runner.mjs";

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const MAX_BODY_BYTES = 256 * 1024;
const WORKSPACE_ROOT = process.env.PINAKA_WORKSPACE_ROOT || process.cwd();
const toolRegistry = createToolRegistry({
  workspaceRoot: WORKSPACE_ROOT,
  githubToken: process.env.GITHUB_TOKEN || ""
});
const taskRunner = new AgentTaskRunner({
  workspaceRoot: process.env.PINAKA_AGENT_WORKSPACE_ROOT || `${WORKSPACE_ROOT}/.pinaka-workspaces`,
  githubToken: process.env.GITHUB_TOKEN || ""
});

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS"
  });
  res.end(body);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];

  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("request body is too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  if (size === 0) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("request body must contain valid JSON");
    error.statusCode = 400;
    throw error;
  }
}

function extractTaskId(pathname) {
  const match = pathname.match(/^\/v1\/agent\/tasks\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})$/);
  return match?.[1] || null;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS"
    });
    res.end();
    return;
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && await sendWebAsset(res, url.pathname)) return;

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, getHealth());
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/tools") {
      sendJson(res, 200, { tools: toolRegistry.list() });
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/agent/plan") {
      const body = await readJson(req);
      sendJson(res, 200, createPlan(body.task));
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/agent/run") {
      const body = await readJson(req);
      const job = await taskRunner.start(body);
      sendJson(res, 202, job);
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/agent/tasks") {
      sendJson(res, 200, { tasks: taskRunner.list() });
      return;
    }

    if (req.method === "GET") {
      const taskId = extractTaskId(url.pathname);
      if (taskId) {
        sendJson(res, 200, taskRunner.get(taskId));
        return;
      }
    }

    sendJson(res, 404, { error: "not_found", message: "endpoint not found" });
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 400;
    sendJson(res, statusCode, {
      error: statusCode >= 500 ? "internal_error" : "invalid_request",
      message: error?.message || "request failed",
      code: error?.code || null
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Pinaka agent listening on http://${HOST}:${PORT}`);
});

function shutdown(signal) {
  console.log(`Received ${signal}; shutting down.`);
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
