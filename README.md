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
