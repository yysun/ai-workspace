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
updated_at: "2026-05-15"
---

# Request Lifecycle

The main idea in this repository is that normal JSON replies and streaming replies both go through the same runtime path. The server changes how it packages the results at the end, but most of the real work happens only once.

## Lifecycle Steps

1. The route validates the incoming JSON body.
2. The route resolves the workspace root and abort wiring.
3. [[runtime-orchestration]] builds runtime messages and starts `llm-runtime`.
4. Runtime events are consumed one by one.
5. The route either forwards them as SSE frames or aggregates them into one JSON completion response.

## Why This Matters

Because the server does not split streaming and non-stream logic early, most behavior changes belong in one place: the runtime event stream and the rules for packaging those events back to the client.

## Event Shapes To Remember

- `message.delta` is incremental assistant text.
- `message.done` carries the final assistant message.
- `tool.call` and `tool.result` describe workspace activity.
- `warning` and `error` surface runtime issues without inventing a second status model.

## Related Pages

- [[http-server-and-routes]]
- [[streaming-chat-turn]]
- [[sse-streaming]]