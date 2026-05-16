---
title: "Test And HTTP Fixtures"
type: "feature"
status: "active"
language: "default"
source_paths:
  - "tests/http/01-health.http"
  - "tests/http/02-chat-completions.http"
  - "tests/http/03-chat-completions-stream.http"
  - "tests/http/04-chat-alias.http"
  - "tests/fixtures/workspace/AGENTS.md"
updated_at: "2026-05-15"
---

# Test And HTTP Fixtures

The repository keeps a small set of hand-run request examples and a fixture workspace so contributors can validate behavior without reverse-engineering payloads.

## HTTP Examples

`tests/http/` contains ready-made requests for:

- health checks
- non-stream chat completions
- streaming chat completions
- the `/chat` alias

These examples match the route behavior described in [[http-server-and-routes]] and the streaming contract in [[sse-streaming]].

## Fixture Workspace

`tests/fixtures/workspace/AGENTS.md` gives tests a predictable instruction file for workspace-loading scenarios. That makes it easier to verify that the host appends workspace guidance without relying on an external mounted repo.

## Related Pages

- [[workspace-integration]]
- [[test-suite]]