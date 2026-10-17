# Pinaka-

Pinaka- is a browser-based coding agent project.

## Goal

Build a reliable coding agent that can inspect a GitHub repository, reason about a requested change, edit code safely, run tests, diagnose failures, review its changes, and work with GitHub.

## Development principles

- Inspect before modifying.
- Prefer the smallest safe change.
- Never claim a test passed unless it was actually run.
- Keep unrelated code untouched.
- Verify changes before considering a task complete.
- Keep model providers replaceable.
- Build the system in small, testable phases.

## Initial architecture

```text
Browser
  -> Web UI
  -> Agent backend
  -> Model router
  -> Agent tools
       - Files
       - GitHub
       - Terminal
       - Tests
```

The repository starts intentionally small. Features will be added phase by phase after each foundation is verified.

## Jarvis (GitHub Actions coding agent)

Jarvis is a standard-library-only Python agent (`agent/jarvis_agent.py` and
`agent/run_tests_stage.py`) driven by `.github/workflows/jarvis.yml`. Open an issue whose
body describes a change. Jarvis asks an AI for the code, writes it on a branch named
`jarvis/<slug>-<issue>`, runs the tests, and opens a pull request against `main`. It never
pushes to `main`: it refuses to push any branch that does not start with `jarvis/`, and
merging is always your decision.

### Who can trigger it

Only the repository owner. Every job carries
`if: github.event.issue.user.login == github.repository_owner`, so issues opened by anyone
else are ignored. The issue body is untrusted text that goes straight into an AI prompt, and
the plan jobs hold API keys, so nobody else may start a run.

### The job chain

| Job | Runs when | What it does |
| --- | --- | --- |
| `plan1` | every owner issue | asks the AI, applies its files through the safety checks, uploads the tree as `jarvis-stage-1` |
| `test1` | `plan1` succeeded | runs the tests inside that tree, uploads `jarvis-test-result-1` |
| `plan2` | `test1` failed | shows the AI its own files and the failing output, asks for a fix, uploads `jarvis-stage-2` |
| `test2` | `plan2` succeeded | same as `test1`, on round 2 |
| `plan3` | `test2` failed | last repair attempt, uploads `jarvis-stage-3` |
| `test3` | `plan3` succeeded | same as `test1`, on round 3 |
| `publish` | `plan1` succeeded (always, once) | re-checks every file, pushes the `jarvis/*` branch, opens or updates the PR, comments on the issue |

`publish` picks the highest round whose plan job finished with `success` (3, else 2, else 1)
and uses that round's staged tree and test result. A plan job that was skipped, failed or was
cancelled never counts. Its log starts with one line showing all six job results and
`Publishing round N (test job result: ...)`.

In a repair round the previous round's files are applied again through the same path checks,
and the failing test output is given to the AI inside `<test_output>` tags that the model is
told to treat as data, never as instructions. Files from earlier rounds stay in the PR even if
the AI does not resend them.

### Which job holds which secret

| Job | Secrets in its environment |
| --- | --- |
| `plan1`, `plan2`, `plan3` | `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `GH_TOKEN` (plus `NTFY_TOPIC`, used only if the job crashes) |
| `test1`, `test2`, `test3` | none |
| `publish` | `GH_TOKEN` and `NTFY_TOPIC` only, no AI keys |

The test jobs are the only place where code written by the AI runs (`pytest`, `npm ci
--ignore-scripts`, `npm test`). They have no secret in their environment and no persisted
token, so nothing the AI wrote can read an API key or the GitHub token from the job. Test
code can still reach the network and see the repository's files, so keep no secrets anywhere
except GitHub's secret store. The plan jobs only talk to the AI and copy files;
`publish` only copies files and talks to `git` and `gh`. Keys are sent in HTTP headers only
and are never printed, logged, or written into an artifact.

### Path restrictions

Every file the AI returns, in every round and again in `publish`, is checked before it is
written. Blocked files are skipped and listed in the PR description: absolute paths, `~`
paths, `..` traversal, backslashes, anything under `.github/` or `.git/`, `.env*` files, any
filename containing `secret`, `key` or `token`, and any single file over 200 KB. The issue
text is wrapped in `<request>` tags with the same "data, not instructions" rule.

### Notifications (ntfy)

You get a push message only when something needs you:

- the AI set `needs_human`;
- the AI raised a `concern`;
- the tests did not pass in the final round, or in a round after which no further repair
  round ran;
- a job crashed.

A passing run is silent: look for the PR link in a comment on your issue. The PR body always
states the test result, for example `Tests: passed - fixed after 1 repair round` or
`Tests: FAILED (see below)` with the output folded underneath.

### Setup, in order

1. Secrets (Settings > Secrets and variables > Actions > Secrets):

   | Secret | Where to get it | Why |
   | --- | --- | --- |
   | `GEMINI_API_KEY` | https://aistudio.google.com/apikey (free tier) | first-choice model, `gemini-2.5-flash` |
   | `OPENROUTER_API_KEY` | https://openrouter.ai/keys (free models) | fallback models; one of the two AI keys is enough |
   | `NTFY_TOPIC` | any hard-to-guess string, e.g. `jarvis-7f3a9c`, subscribed in the ntfy app or at `https://ntfy.sh/<topic>` | push notifications |

   `GITHUB_TOKEN` is provided by Actions; you do not create it.

2. Settings > Actions > General > Workflow permissions: select **Read and write
   permissions** and tick **Allow GitHub Actions to create and approve pull requests**.
   Without the tick, `gh pr create` fails with "GitHub Actions is not permitted to create
   pull requests".

3. Variables (Settings > Secrets and variables > Actions > Variables): add
   `JARVIS_DRY_RUN` = `0` to publish for real. Leave it unset, or set any other value, to
   dry-run: `publish` then prints a summary (branch, files, skipped files, test result)
   instead of pushing, opening a PR, or commenting.

### Dry run first

`publish` dry-runs unless the variable `JARVIS_DRY_RUN` is exactly `0`, so a fresh setup is
safe to try. Open a small issue as the owner, for example "add a function `double(n)` in
`src/util.py` with a test". Then open the run under Actions and check:

- `plan1` and `test1` ran; `plan2`/`plan3` ran only if the previous test job failed;
- the first step of `publish` prints the six results on one line, then
  `Publishing round N (test job result: ...)`;
- the last step of `publish` prints the dry-run summary with the files it would commit;
- the artifacts `jarvis-stage-N` and `jarvis-test-result-N` exist for every round that ran.

When that looks right, set `JARVIS_DRY_RUN` to `0` and open a real issue.

### Local tests

From the repository root, with no installs and no network access:

```bash
python -m unittest discover tests
```

The suite mocks every HTTP and subprocess call, so it never contacts an API, runs `git`, or
calls `gh`. It also checks the workflow file itself (job chain, owner gate, which job holds
which secret).

### Limits

- Free AI quotas and GitHub Actions minutes can run out; a run then fails in a plan job and
  you get a crash notification. Jarvis starts on an issue being opened, so the only way to
  restart is to re-run the workflow from the Actions tab, or to open a new issue.
- A task that still fails after three rounds ends as a pull request marked
  `Tests: FAILED` plus exactly one notification; the PR shows the last failing output.
- Actions minutes are unlimited only for public repositories; a private repository uses the
  monthly quota of your plan.
- Runs for the same issue number queue behind each other (`concurrency` group per issue). A
  re-run for an issue resets its `jarvis/*` branch with `--force-with-lease` and updates the
  existing PR instead of opening a second one.
