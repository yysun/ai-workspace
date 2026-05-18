---
title: "Test Suite"
type: "feature"
status: "active"
language: "default"
source_paths:
  - "tests/e2e/chatCompletions.e2e.test.ts"
  - "tests/targeted/apiRequestTool.test.ts"
  - "tests/targeted/loadAgentsMd.test.ts"
  - "tests/targeted/resolveUserId.test.ts"
  - "tests/unit/apiTool.test.ts"
  - "tests/unit/contentUtils.test.ts"
  - "tests/unit/loadWorkspaceEnv.test.ts"
  - "tests/unit/runChatCompletion.test.ts"
  - "tests/unit/runtimeConfig.test.ts"
  - "tests/unit/storageFileProvider.test.ts"
  - "tests/unit/streamingTestCli.test.ts"
updated_at: "2026-05-18"
---

# Test Suite

The test layout is organized by how broad each check is, not by which folder owns the code. That makes it easier to tell whether a failure is a small helper issue, a workspace-integration issue, or a full HTTP behavior break.

## Unit Tests

Unit coverage focuses on small helpers that do not need a live model provider. Examples include:

- shell argument environment expansion and secret redaction
- runtime configuration parsing and provider selection defaults
- workspace `.env` loading behavior
- host-owned `api_request`, `marp_cli`, and runtime request-tool behavior
- AI workspace file-provider reads, writes, search, binary handling, and path-boundary checks
- streaming CLI rendering and human-input formatting

## Targeted Tests

Targeted tests sit between unit and e2e checks. They validate workspace-specific integration points such as loading `AGENTS.md`, exchanging a Bearer token for a user id, and wiring the workspace API tool into runtime-facing behavior.

## End-To-End Tests

The e2e suite starts the Express app and checks the server through real HTTP requests. Current checks include:

- valid non-stream requests return a runtime `5xx` when no provider credentials are configured
- chat requests require a Bearer token plus a working identity lookup before they create a user-scoped workspace directory
- malformed JSON returns `400` with logged body-preview diagnostics
- streaming requests emit SSE `error` and `done` events when runtime setup fails

## Related Pages

- [[http-server-and-routes]]
- [[multi-user-workspace-routing]]
- [[runtime-orchestration]]
- [[workspace-tools-and-storage]]
- [[workspace-integration]]
- [[testing-cli]]