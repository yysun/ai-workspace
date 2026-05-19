---
title: "Request Lifecycle"
type: "concept"
status: "active"
language: "default"
source_paths:
  - "src/routes/chatCompletions.ts"
  - "src/runtime/runChatCompletion.ts"
  - "src/runtime/runtimeTypes.ts"
  - "src/sse/mapRuntimeEvent.ts"
  - "src/sse/writeSse.ts"
  - "src/auth/resolveUserId.ts"
updated_at: "2026-05-18"
---

# Request Lifecycle

The main idea in this repository is that normal JSON replies and streaming replies both go through the same runtime path. The server changes how it packages the results at the end, but most of the real work happens only once.

## Lifecycle Steps

1. The route extracts the Bearer token, resolves the user id, and creates the user-scoped `users/<id>` directory.
2. The route validates the incoming JSON body.
3. The route resolves the shared workspace root and abort wiring.
4. [[runtime-orchestration]] builds runtime messages, reads defaults from the already-loaded server environment, registers request-scoped tools, and starts `llm-runtime`.
5. Runtime events are consumed one by one.
6. The route either forwards them as SSE frames or aggregates them into one JSON completion response.

## Why This Matters

Because the server does not split streaming and non-stream logic early, most behavior changes belong in one place: the runtime event stream and the rules for packaging those events back to the client.

## Event Shapes To Remember

- `message.delta` is incremental assistant text.
- `message.done` carries the final assistant message.
- `tool.call` and `tool.result` describe workspace activity.
- `warning` and `error` surface runtime issues without inventing a second status model.

## Related Pages

- [[http-server-and-routes]]
- [[multi-user-workspace-routing]]
- [[streaming-chat-turn]]
- [[sse-streaming]]