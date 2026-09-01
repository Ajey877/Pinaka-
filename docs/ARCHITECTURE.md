# Pinaka- Architecture

## Mission

Pinaka- is intended to become a browser-based coding agent that can safely work on software repositories.

## Core loop

```text
User task
   |
   v
Understand -> Inspect -> Plan -> Implement -> Test -> Diagnose -> Fix -> Review
                                                            |
                                                            v
                                                         Verify
```

## Components

### Web application
Browser interface for submitting tasks, selecting repositories, viewing agent progress, reviewing proposed changes, and inspecting results.

### Agent backend
Orchestrates the agent loop, maintains execution state, applies safety policies, and coordinates tools and model providers.

### Model router
Keeps the AI provider behind a replaceable interface so the project is not locked to one model or vendor.

### Workspace manager
Creates an isolated filesystem workspace for each agent task. Workspace identifiers are validated, workspace paths are derived from a controlled root, concurrent creation for the same task is rejected, and completed workspaces can be released or discarded.

### Tools
The agent will use controlled tools for:

- reading and writing files
- repository search
- Git operations
- GitHub operations
- terminal commands
- test execution

## Safety rules

1. Inspect repository state before making changes.
2. Keep each task scoped to the user's request.
3. Do not silently overwrite unrelated work.
4. Treat tool output as evidence; do not invent successful results.
5. Prefer isolated branches or workspaces for agent changes.
6. Run relevant verification before reporting completion.
7. Keep credentials and secrets outside source control.

## Phase strategy

The project will be implemented incrementally. Each phase should produce a working, testable improvement before the next layer is added.
