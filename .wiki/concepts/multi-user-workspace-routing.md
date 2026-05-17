---
title: "Multi-User Workspace Routing"
type: "concept"
status: "active"
language: "default"
source_paths:
  - "src/config/env.ts"
  - "src/auth/resolveUserId.ts"
  - "src/routes/chatCompletions.ts"
  - "src/runtime/runtimeConfig.ts"
  - "src/workspace/resolveWorkspace.ts"
  - "tests/e2e/chatCompletions.e2e.test.ts"
  - "tests/targeted/resolveUserId.test.ts"
updated_at: "2026-05-17"
---

# Multi-User Workspace Routing

This server now treats every chat request as work on behalf of one user inside a shared mounted workspace. The point is not to manage full accounts inside `ai-workspace`; it is to route reads, writes, and tool side effects into the right `users/<id>/...` area before the model starts.

## How The User Is Resolved

The chat route requires `Authorization: Bearer <token>`. It uses that token to call an identity endpoint built from the host's `API_BASE_URL` and `AUTH_USER_PATH`. `resolveUserId` accepts a few response shapes so the host can work with common API patterns: `{ id }`, `{ userId }`, or a one-item array containing either of those fields.

If the token is missing, the identity endpoint is not configured, the call fails, or the response does not contain a usable id, the request stops with `401` instead of falling through to the model.

## How Paths Stay Safe

Once the id is resolved, `sanitizeUserIdForPath` removes path separators, dots, and null bytes before the id becomes part of a filesystem path. The host then creates or reuses `users/<id>` under the mounted workspace.

That split matters:

- shared files like `AGENTS.md`, `skills/`, and the workspace `.env` still come from the mounted root
- user-scoped writes like saved API bodies and file-backed AI workspace content go under `users/<id>/...`

## Runtime Implications

The runtime receives the resolved `userId` as explicit context in the system prompt, and the incoming Bearer token is copied into the request-scoped environment as `API_ACCESS_TOKEN`. That lets [[workspace-tools-and-storage]] stay user-aware without exposing the token in normal logs or forcing the model to rebuild auth headers itself.

## Related Pages

- [[http-server-and-routes]]
- [[request-lifecycle]]
- [[workspace-integration]]
- [[workspace-tools-and-storage]]