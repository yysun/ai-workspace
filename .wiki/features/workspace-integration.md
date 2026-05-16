---
title: "Workspace Integration"
type: "feature"
status: "active"
language: "default"
source_paths:
  - "src/workspace/loadAgentsMd.ts"
  - "src/workspace/loadWorkspaceEnv.ts"
  - "src/workspace/resolveWorkspace.ts"
updated_at: "2026-05-15"
---

# Workspace Integration

The server is built around one mounted workspace per request. This part of the code turns that mounted folder into something the runtime can actually use: extra instructions, local environment variables, and skill directories.

## What Gets Loaded

- `resolveWorkspaceRoot` normalizes the configured workspace path, falling back to `/workspace`.
- `loadAgentsMd` reads `AGENTS.md` when present and returns `null` when it is absent.
- `loadWorkspaceEnv` and `applyWorkspaceEnv` parse `${WORKSPACE_ROOT}/.env` and merge values into a target environment.

## Important Behavior

`applyWorkspaceEnv` also returns a `restore()` callback. That matters because the server reuses one process: without the restore step, values from one workspace request could leak into the next one.

## Skill Discovery

Workspace skill roots are assembled in `runtimeConfig.ts`, not here. The current roots are:

- `${WORKSPACE_ROOT}/skills`
- `${WORKSPACE_ROOT}/.agents/skills`

That dual-root behavior is validated in [[test-suite]] and mirrored by the fixture material summarized in [[test-and-http-fixtures]].

## Related Pages

- [[runtime-orchestration]]
- [[provider-and-tool-defaults]]
- [[test-and-http-fixtures]]