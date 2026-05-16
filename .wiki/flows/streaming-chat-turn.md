---
title: "Streaming Chat Turn"
type: "flow"
status: "active"
language: "default"
source_paths:
  - "src/routes/chatCompletions.ts"
  - "src/runtime/runChatCompletion.ts"
  - "src/sse/mapRuntimeEvent.ts"
  - "src/sse/writeSse.ts"
  - "tests/http/03-chat-completions-stream.http"
updated_at: "2026-05-15"
---

# Streaming Chat Turn

This is the main live-response path for interactive clients. It describes what happens when a caller wants the answer as a stream instead of waiting for one final JSON payload.

## Step By Step

1. A client posts `stream: true` to `/chat/completions`.
2. The route validates the body and sets SSE headers immediately.
3. The route starts [[runtime-orchestration]] with the resolved workspace root and an abort signal.
4. Each runtime event is serialized by [[sse-streaming]] and written to the response as it arrives.
5. The server emits a final `done` event and closes the stream.

## Failure Shape

Even when runtime setup fails, the stream still stays in SSE form: the client sees an `error` event followed by `done`. The current e2e suite relies on that behavior.

## Client Implication

Clients should trust the event stream itself instead of relying on the HTTP status code alone. A `200` transport can still carry a runtime error event.

## Related Pages

- [[request-lifecycle]]
- [[testing-cli]]
- [[test-suite]]