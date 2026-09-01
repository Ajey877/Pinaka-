import test from "node:test";
import assert from "node:assert/strict";
import { readWebAsset, WEB_ASSET_PATHS } from "../src/web-server.mjs";

test("web server exposes only the known browser assets", async () => {
  assert.deepEqual(WEB_ASSET_PATHS, ["/", "/app.css", "/app.js", "/approval-ui.js", "/auth-ui.js", "/history-ui.js"]);
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
  assert.match(approval.content.toString("utf8"), /Approve & create PR/);

  const auth = await readWebAsset("/auth-ui.js");
  assert.equal(auth.contentType, "text/javascript; charset=utf-8");
  assert.match(auth.content.toString("utf8"), /Sign in with GitHub/);

  const history = await readWebAsset("/history-ui.js");
  assert.equal(history.contentType, "text/javascript; charset=utf-8");
  assert.match(history.content.toString("utf8"), /Task history/);
});

test("web server rejects arbitrary or traversal asset paths", async () => {
  assert.equal(await readWebAsset("/favicon.ico"), null);
  assert.equal(await readWebAsset("/../app.js"), null);
  assert.equal(await readWebAsset("/app.js?x=1"), null);
});
