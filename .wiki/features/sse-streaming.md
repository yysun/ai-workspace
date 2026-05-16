---
title: "SSE Streaming"
type: "feature"
status: "active"
language: "default"
source_paths:
  - "src/sse/mapRuntimeEvent.ts"
  - "src/sse/writeSse.ts"
updated_at: "2026-05-15"
---

# SSE Streaming

When a client asks for streaming output, the server replies with plain server-sent events, or SSE. The host keeps this transport simple: it does not rename event types or invent a second event format just for HTTP clients.

## How It Works

- `mapRuntimeEvent` preserves the runtime event name and serializes the whole payload as JSON.
- `writeSseHeaders` sets `text/event-stream`, `no-cache, no-transform`, and `keep-alive` headers.
- `writeSseEvent` writes the standard `event:` and `data:` frame pair.
- `writeSseDone` always emits a final `done` event with `{}` before closing the response.

## Why It Matters

Because the transport keeps the internal event names intact, the local CLI and any custom clients can react to tool calls, warnings, and errors without learning a second naming scheme.

## Related Pages

- [[http-server-and-routes]]
- [[streaming-chat-turn]]
- [[testing-cli]]