import {
  GitHubClient,
  ToolRegistry,
  listFiles,
  readTextFile,
  runCommand,
  writeTextFile
} from "@pinaka/tools";

export function createToolRegistry({ workspaceRoot, githubToken = "" } = {}) {
  const registry = new ToolRegistry();
  const github = new GitHubClient({ token: githubToken });

  registry.register("files.list", {
    description: "List files in the controlled workspace.",
    run: ({ relativeDirectory = "." } = {}) => listFiles(workspaceRoot, relativeDirectory)
  });

  registry.register("files.read", {
    description: "Read a UTF-8 text file inside the controlled workspace.",
    run: ({ path, maxBytes } = {}) => readTextFile(workspaceRoot, path, { maxBytes })
  });

  registry.register("files.write", {
    description: "Write a UTF-8 text file; overwriting requires explicit approval.",
    run: ({ path, content, overwrite = false, maxBytes } = {}) =>
      writeTextFile(workspaceRoot, path, content, { overwrite, maxBytes })
  });

  registry.register("terminal.run", {
    description: "Run an allow-listed executable without a shell in the controlled workspace.",
    run: (input = {}) => runCommand({ workspaceRoot, ...input })
  });

  registry.register("github.repository", {
    description: "Read GitHub repository metadata.",
    run: ({ owner, repo } = {}) => github.getRepository(owner, repo)
  });

  registry.register("github.contents", {
    description: "Read GitHub repository contents.",
    run: ({ owner, repo, path = "", ref } = {}) => github.getContents(owner, repo, path, ref)
  });

  return registry;
}
