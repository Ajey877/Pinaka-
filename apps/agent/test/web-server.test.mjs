import test from "node:test";
import assert from "node:assert/strict";
import { readWebAsset, WEB_ASSET_PATHS } from "../src/web-server.mjs";

test("web server exposes only the known browser assets", async () => {
  assert.deepEqual(WEB_ASSET_PATHS, ["/", "/app.css", "/app.js", "/approval-ui.js"]);
  const index = await readWebAsset("/");
  assert.equal(index.contentType, "text/html; charset=utf-8");
  assert.match(index.content.toString("utf8"), /<title>Pinaka — Coding Agent<\/title>/);

  const css = await readWebAsset("/app.css");
  assert.equal(css.contentType, "text/css; charset=utf-8");
  assert.match(css.content.toString("utf8"), /--radius-xl/);

  const js = await readWebAsset("/app.js");
  assert.equal(js.contentType, "text/javascript; charset=utf-8");
  assert.match(js.content.toString("utf8"), /\/v1\/agent\/plan/);

  const approval = await readWebAsset("/approval-ui.js");
  assert.equal(approval.contentType, "text/javascript; charset=utf-8");
  assert.match(approval.content.toString("utf8"), /Approve & commit/);
});

test("web server rejects arbitrary or traversal asset paths", async () => {
  assert.equal(await readWebAsset("/favicon.ico"), null);
  assert.equal(await readWebAsset("/../app.js"), null);
  assert.equal(await readWebAsset("/app.js?x=1"), null);
});
