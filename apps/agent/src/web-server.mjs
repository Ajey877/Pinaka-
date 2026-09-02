import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = fileURLToPath(new URL("../web/", import.meta.url));

const ASSETS = Object.freeze({
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.css": { file: "app.css", type: "text/css; charset=utf-8" },
  "/model-ui.css": { file: "model-ui.css", type: "text/css; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/model-ui.js": { file: "model-ui.js", type: "text/javascript; charset=utf-8" },
  "/approval-ui.js": { file: "approval-ui.js", type: "text/javascript; charset=utf-8" },
  "/auth-ui.js": { file: "auth-ui.js", type: "text/javascript; charset=utf-8" },
  "/history-ui.js": { file: "history-ui.js", type: "text/javascript; charset=utf-8" }
});

export async function readWebAsset(pathname) {
  const asset = ASSETS[pathname];
  if (!asset) return null;

  const filename = path.basename(asset.file);
  const absolute = path.resolve(WEB_ROOT, filename);
  const relative = path.relative(WEB_ROOT, absolute);

  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("web asset resolved outside web root");
  }

  const content = await fs.readFile(absolute);
  return { content, contentType: asset.type };
}

export async function sendWebAsset(res, pathname) {
  const asset = await readWebAsset(pathname);
  if (!asset) return false;

  res.writeHead(200, {
    "content-type": asset.contentType,
    "content-length": asset.content.length,
    "cache-control": pathname === "/" ? "no-cache" : "public, max-age=3600"
  });
  res.end(asset.content);
  return true;
}

export const WEB_ASSET_PATHS = Object.freeze(Object.keys(ASSETS));
