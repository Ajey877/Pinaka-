import fs from "node:fs/promises";
import path from "node:path";
import { readTextFile } from "@pinaka/tools";

const DEFAULT_MAX_FILES = 2_000;
const MAX_DEPTH = 12;
const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".venv",
  "venv",
  "target",
  "bin",
  "obj"
]);

const MANIFESTS = [
  ["package.json", "node"],
  ["pnpm-workspace.yaml", "node"],
  ["yarn.lock", "node"],
  ["package-lock.json", "node"],
  ["pyproject.toml", "python"],
  ["requirements.txt", "python"],
  ["Pipfile", "python"],
  ["go.mod", "go"],
  ["Cargo.toml", "rust"],
  ["pom.xml", "java"],
  ["build.gradle", "java"],
  ["build.gradle.kts", "java"],
  ["composer.json", "php"]
];

const LANGUAGE_BY_EXTENSION = new Map([
  [".js", "javascript"], [".mjs", "javascript"], [".cjs", "javascript"], [".jsx", "javascript"],
  [".ts", "typescript"], [".tsx", "typescript"], [".py", "python"], [".go", "go"],
  [".rs", "rust"], [".java", "java"], [".kt", "kotlin"], [".kts", "kotlin"],
  [".c", "c"], [".h", "c"], [".cpp", "cpp"], [".cc", "cpp"], [".cxx", "cpp"],
  [".cs", "csharp"], [".php", "php"], [".rb", "ruby"], [".swift", "swift"],
  [".dart", "dart"], [".vue", "vue"], [".svelte", "svelte"]
]);

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function sortedObject(map) {
  return Object.fromEntries([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

async function walk(root, current, result, depth = 0) {
  if (depth > MAX_DEPTH || result.files.length >= result.maxFiles) return;

  let entries;
  try {
    entries = await fs.readdir(current, { withFileTypes: true });
  } catch {
    return;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (result.files.length >= result.maxFiles) break;
    if (entry.name.startsWith(".") && entry.name !== ".github") continue;
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;

    const absolute = path.join(current, entry.name);
    const relative = path.relative(root, absolute).replaceAll(path.sep, "/");

    if (entry.isDirectory()) {
      await walk(root, absolute, result, depth + 1);
      continue;
    }
    if (!entry.isFile()) continue;

    result.files.push(relative);
    const extension = path.extname(entry.name).toLowerCase();
    const language = LANGUAGE_BY_EXTENSION.get(extension);
    if (language) increment(result.languages, language);
  }
}

async function detectManifests(root) {
  const manifests = [];
  const ecosystems = new Set();

  for (const [filename, ecosystem] of MANIFESTS) {
    try {
      const stat = await fs.stat(path.join(root, filename));
      if (!stat.isFile()) continue;
      manifests.push(filename);
      ecosystems.add(ecosystem);
    } catch {
      // Missing optional manifest is expected.
    }
  }

  return { manifests, ecosystems: [...ecosystems].sort() };
}

async function detectScripts(root, manifests) {
  const scripts = {};
  if (!manifests.includes("package.json")) return scripts;

  try {
    const packageJson = JSON.parse(await readTextFile(root, "package.json", { maxBytes: 256 * 1024 }));
    if (packageJson.scripts && typeof packageJson.scripts === "object") {
      for (const name of ["test", "lint", "build", "check", "typecheck", "format"]) {
        if (typeof packageJson.scripts[name] === "string") scripts[name] = packageJson.scripts[name];
      }
    }
  } catch {
    // Invalid or unreadable package metadata should not make inspection fail.
  }
  return scripts;
}

export async function inspectRepository(rootDirectory, { maxFiles = DEFAULT_MAX_FILES } = {}) {
  if (typeof rootDirectory !== "string" || rootDirectory.trim() === "") {
    throw new TypeError("rootDirectory is required");
  }
  if (!Number.isInteger(maxFiles) || maxFiles <= 0 || maxFiles > 100_000) {
    throw new TypeError("maxFiles must be a positive integer no greater than 100000");
  }

  const root = path.resolve(rootDirectory);
  const stat = await fs.stat(root).catch(() => null);
  if (!stat?.isDirectory()) throw new TypeError("rootDirectory must point to a directory");

  const result = { root, maxFiles, files: [], languages: new Map() };
  await walk(root, root, result);

  const { manifests, ecosystems } = await detectManifests(root);
  const scripts = await detectScripts(root, manifests);

  return {
    fileCount: result.files.length,
    truncated: result.files.length >= maxFiles,
    files: result.files,
    languages: sortedObject(result.languages),
    manifests,
    ecosystems,
    scripts
  };
}
