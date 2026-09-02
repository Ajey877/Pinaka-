import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOTS = ["apps", "packages", "scripts"];
const EXTENSIONS = new Set([".js", ".mjs"]);

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(absolute));
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      files.push(absolute);
    }
  }

  return files;
}

function checkSyntax(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--check", file], { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) return resolve();
      reject(new Error(`${path.relative(process.cwd(), file)} failed syntax check (${signal || `exit ${code}`})`));
    });
  });
}

const files = [];
for (const root of ROOTS) {
  files.push(...await collectFiles(path.resolve(root)));
}

files.sort((a, b) => a.localeCompare(b));

for (const file of files) {
  await checkSyntax(file);
}

console.log(`Syntax check passed for ${files.length} JavaScript files.`);
