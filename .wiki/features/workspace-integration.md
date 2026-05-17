---
title: "Workspace Integration"
type: "feature"
status: "active"
language: "default"
source_paths:
  - "src/workspace/loadAgentsMd.ts"
  - "src/workspace/loadWorkspaceEnv.ts"
  - "src/workspace/resolveWorkspace.ts"
updated_at: "2026-05-17"
---

# Workspace Integration

The server is built around one mounted workspace per request. This part of the code turns that mounted folder into something the runtime can actually use: shared instructions, local environment variables, skill directories, and safe user-scoped subdirectories.

## What Gets Loaded

- `resolveWorkspaceRoot` normalizes the configured workspace path, falling back to `/workspace`.
- `resolveUserWorkspaceRoot` and `resolveApiResponseDirectory` turn a resolved user id into safe `users/<id>/...` paths inside that mounted workspace.
- `loadAgentsMd` reads `AGENTS.md` when present and returns `null` when it is absent.
- `loadWorkspaceEnv` and `applyWorkspaceEnv` parse `${WORKSPACE_ROOT}/.env` and merge values into a target environment.

## Important Behavior

`applyWorkspaceEnv` also returns a `restore()` callback. That matters because the server reuses one process: without the restore step, values from one workspace request could leak into the next one.

The mounted root is shared, but not every write target is. `AGENTS.md`, `skills/`, and the workspace `.env` are loaded from the shared root, while per-user content writes and saved API bodies land under `users/<id>/...`. User ids are sanitized before they become path segments so a token lookup cannot escape the workspace tree.

When the workspace `.env` defines `API_BASE_URL`, the runtime adds the `api_request` tool described in [[workspace-tools-and-storage]]. That decision happens per request after the workspace env has been applied.

## Skill Discovery

Workspace skill roots are assembled in `runtimeConfig.ts`, not here. The current roots are:

- `${WORKSPACE_ROOT}/skills`
- `${WORKSPACE_ROOT}/.agents/skills`

That dual-root behavior is validated in [[test-suite]] and mirrored by the fixture material summarized in [[test-and-http-fixtures]].

## Related Pages

- [[runtime-orchestration]]
- [[multi-user-workspace-routing]]
- [[provider-and-tool-defaults]]
- [[workspace-tools-and-storage]]
- [[test-and-http-fixtures]]