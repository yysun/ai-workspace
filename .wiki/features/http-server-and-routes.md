---
title: "HTTP Server And Routes"
type: "feature"
status: "active"
language: "default"
source_paths:
  - "src/index.ts"
  - "src/server.ts"
  - "src/routes/chatCompletions.ts"
  - "src/routes/health.ts"
  - "src/auth/resolveUserId.ts"
  - "src/auth/verifyRequest.ts"
updated_at: "2026-05-17"
---

# HTTP Server And Routes

This page covers the small web layer at the front of the product. Its job is to accept incoming HTTP requests, validate them, pass valid chat work to the runtime layer, and send the response back in either JSON or streaming form. `src/index.ts` loads local `.env`, reads runtime settings, starts the Express app, and installs shutdown handlers.

## Route Surface

- `GET /health` returns a simple readiness payload plus the runtime defaults exposed by [[provider-and-tool-defaults]].
- `POST /chat/completions` is the main OpenAI-style endpoint.
- `POST /chat` is a direct alias to the same chat handler.

## Request Handling Details

`src/server.ts` keeps the server setup intentionally simple. It disables `x-powered-by`, enables JSON parsing with a `1mb` limit, and still runs a placeholder `verifyRequest` middleware before the route handlers.

The real chat gate now lives inside `src/routes/chatCompletions.ts`. That handler requires `Authorization: Bearer <token>`, rejects requests when the identity lookup URL is not configured, and resolves the user id before starting the runtime. The shared error handler still logs enough detail to debug bad requests, including method, path, content type, and a shortened body preview for malformed JSON. It avoids logging full chat payloads for runtime `5xx` failures.

## Chat Endpoint Responsibilities

Before it validates the chat body, the route extracts the Bearer token, calls [[multi-user-workspace-routing]] to resolve a user id, and creates the user-scoped directory under `users/<id>`. It then makes sure the body looks like a real chat request. In practice that means `messages` must be a non-empty array of objects with string `role` and `content` fields. It also accepts optional `model`, `stream`, `temperature`, `max_tokens`, `tools`, `tool_choice`, and `metadata` fields.

From there it resolves the shared workspace root, wires request aborts into an `AbortController`, and delegates execution to [[runtime-orchestration]]. The runtime input includes the shared workspace root, the resolved user id, and the incoming access token so host-owned tools can stay user-scoped without logging secrets. The same runtime event stream is used for both JSON and SSE modes.

## Related Pages

- [[request-lifecycle]]
- [[multi-user-workspace-routing]]
- [[streaming-chat-turn]]
- [[sse-streaming]]
- [[workspace-tools-and-storage]]
- [[test-suite]]