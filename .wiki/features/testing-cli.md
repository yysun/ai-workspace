---
title: "Testing CLI"
type: "feature"
status: "active"
language: "default"
source_paths:
  - "src/cli/testChatCli.ts"
  - "src/cli/streamingTestCli.ts"
  - "src/cli/toolTraceRenderer.ts"
updated_at: "2026-05-18"
---

# Testing CLI

The local CLI is the easiest way to try repeated streaming chat requests from a terminal. Instead of rebuilding `curl` commands by hand for every check, you can keep one conversation open, watch the streamed output arrive live, and send the next turn immediately. The tiny entry file `src/cli/testChatCli.ts` keeps the executable surface simple while `streamingTestCli.ts` holds the main behavior.

## Main Behaviors

- Sends `stream: true` chat requests to `/chat/completions`.
- Keeps conversation history in memory for the lifetime of the process.
- Prints assistant text as streamed SSE chunks arrive.
- Can auto-submit a bounded follow-up message such as `go ahead` after planning-style assistant replies when `--auto-continue` is enabled.
- Supports `/clear` and `/exit` style interactive commands documented in the README.

## Trace Rendering

When the model calls tools, `toolTraceRenderer.ts` decides how much detail to show:

- `default` for compact indented call and result pairs.
- `verbose` for bounded argument and payload previews.
- `debug` for raw-style event output.

The renderer includes special handling for shell commands, `read_file`, `path_exists`, `api_request`, and `marp_cli` so tool output does not drown out assistant text. For file reads it now summarizes the actual returned line count instead of merely echoing the requested range.

## Human Input Handling

The CLI also understands structured requests that pause and ask the human to choose an answer. It recognizes `ask_user_input`, `human_intervention_request`, and `ask_user_question`, renders numbered choices, supports comma-separated multiple selection, allows empty responses when a prompt is skippable, and turns the chosen answers back into a follow-up user message. See [[human-input-cli-turn]] for the flow details.

The newer auto-continue path is intentionally cautious. It stays opt-in, only spends a small bounded turn budget, and allows a short grace window for warning-only stalls so narrated progress does not silently turn into an endless loop.

## Related Pages

- [[sse-streaming]]
- [[human-input-cli-turn]]
- [[cli-trace-and-human-input-improvements]]
- [[test-suite]]