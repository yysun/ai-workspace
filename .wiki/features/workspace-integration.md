---
title: "Workspace Integration"
type: "feature"
status: "active"
language: "default"
source_paths:
  - "src/workspace/loadAgentsMd.ts"
  - "src/workspace/resolveWorkspace.ts"
  - "src/config/env.ts"
updated_at: "2026-05-18"
---

# Workspace Integration

The server is built around one mounted workspace per request. This part of the code turns that mounted folder into something the runtime can actually use: shared instructions, skill directories, and safe user-scoped subdirectories. Runtime env and host-owned tool settings come from the server process environment instead of the mounted workspace.

## What Gets Loaded

- `resolveWorkspaceRoot` normalizes the configured workspace path, falling back to `/workspace`.
- `resolveUserWorkspaceRoot` and `resolveApiResponseDirectory` turn a resolved user id into safe `users/<id>/...` paths inside that mounted workspace.
- `loadAgentsMd` reads `AGENTS.md` when present and returns `null` when it is absent.
- `src/config/env.ts` reads the server process environment once at startup and derives runtime defaults such as provider settings, `AUTH_USER_URL`, and the AIW storage mode.

## Important Behavior

The mounted root is shared, but not every write target is. `AGENTS.md` and workspace skill folders are loaded from the shared root, while per-user content writes, deck renders, and saved API bodies land under `users/<id>/...`. User ids are sanitized before they become path segments so a token lookup cannot escape the workspace tree.

When the server environment defines `API_BASE_URL`, the runtime can add the `api_request` tool described in [[workspace-tools-and-storage]]. That decision still happens per request, but it is based on process env plus the current user context, not on a mounted workspace `.env` file.

## Skill Discovery

Workspace skill roots are resolved during runtime setup rather than in this folder. The current roots are:

- `${WORKSPACE_ROOT}/skills`
- `${WORKSPACE_ROOT}/.agents/skills`

That dual-root behavior is validated in [[test-suite]] and mirrored by the fixture material summarized in [[test-and-http-fixtures]].

## Related Pages

- [[runtime-orchestration]]
- [[multi-user-workspace-routing]]
- [[provider-and-tool-defaults]]
- [[workspace-tools-and-storage]]
- [[test-and-http-fixtures]]