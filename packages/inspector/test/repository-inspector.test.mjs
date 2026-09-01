import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspectRepository } from "../src/index.mjs";

const roots = [];

async function makeRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pinaka-inspector-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

test("inspects files, languages, manifests, and package scripts", async () => {
  const root = await makeRoot();
  await fs.mkdir(path.join(root, "src", "nested"), { recursive: true });
  await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test", build: "node build.mjs", private: true } }));
  await fs.writeFile(path.join(root, "src", "index.ts"), "export const ok = true;\n");
  await fs.writeFile(path.join(root, "src", "nested", "helper.py"), "print('ok')\n");
  await fs.writeFile(path.join(root, "node_modules", "ignored.js"), "ignored\n");

  const report = await inspectRepository(root);

  assert.equal(report.fileCount, 4);
  assert.deepEqual(report.manifests, ["package.json"]);
  assert.deepEqual(report.ecosystems, ["node"]);
  assert.deepEqual(report.languages, { python: 1, typescript: 1 });
  assert.deepEqual(report.scripts, { build: "node build.mjs", test: "node --test" });
  assert.ok(report.files.includes("package.json"));
  assert.ok(report.files.includes("src/index.ts"));
  assert.ok(!report.files.some((file) => file.includes("node_modules")));
  assert.equal(report.truncated, false);
});

test("ignores generated and hidden directories and honors a file limit", async () => {
  const root = await makeRoot();
  await fs.mkdir(path.join(root, ".hidden"), { recursive: true });
  await fs.mkdir(path.join(root, "dist"), { recursive: true });
  await fs.writeFile(path.join(root, ".hidden", "secret.js"), "secret\n");
  await fs.writeFile(path.join(root, "dist", "bundle.js"), "bundle\n");
  await fs.writeFile(path.join(root, "a.js"), "a\n");
  await fs.writeFile(path.join(root, "b.js"), "b\n");
  await fs.writeFile(path.join(root, "c.js"), "c\n");

  const report = await inspectRepository(root, { maxFiles: 2 });
  assert.equal(report.fileCount, 2);
  assert.equal(report.truncated, true);
  assert.deepEqual(report.files, ["a.js", "b.js"]);
});

test("validates input", async () => {
  await assert.rejects(() => inspectRepository(""), /rootDirectory is required/);
  const root = await makeRoot();
  await assert.rejects(() => inspectRepository(root, { maxFiles: 0 }), /maxFiles/);
  await assert.rejects(() => inspectRepository(path.join(root, "missing")), /directory/);
});

test("handles malformed package metadata without failing the inspection", async () => {
  const root = await makeRoot();
  await fs.writeFile(path.join(root, "package.json"), "{not-json");
  const report = await inspectRepository(root);
  assert.deepEqual(report.manifests, ["package.json"]);
  assert.deepEqual(report.scripts, {});
});
