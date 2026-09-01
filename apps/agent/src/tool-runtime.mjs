import { GitRepository } from "@pinaka/git";
import { inspectRepository } from "@pinaka/inspector";
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
  const git = new GitRepository({ workspaceRoot });

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

  registry.register("git.status", {
    description: "Read the current Git branch and working-tree status.",
    run: () => git.status()
  });

  registry.register("git.current_commit", {
    description: "Read the current Git HEAD commit.",
    run: () => git.currentCommit()
  });

  registry.register("git.clone", {
    description: "Clone an HTTPS GitHub repository into the controlled workspace.",
    run: ({ repositoryUrl } = {}) => git.clone(repositoryUrl)
  });

  registry.register("git.create_branch", {
    description: "Create an isolated agent branch from a clean workspace.",
    run: ({ branchName } = {}) => git.createBranch(branchName)
  });

  registry.register("git.assert_clean", {
    description: "Verify that the workspace has no uncommitted changes.",
    run: () => git.assertClean()
  });

  registry.register("repository.inspect", {
    description: "Build a bounded structural map of the repository for agent reasoning.",
    run: ({ maxFiles } = {}) => inspectRepository(workspaceRoot, { maxFiles })
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
