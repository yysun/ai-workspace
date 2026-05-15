# Requirement: testing-cli-compact-tool-traces

## Story

Improve the simple streaming test CLI so tool activity renders as a compact trace by default, with optional verbose and debug modes for deeper inspection.

Story slug: `testing-cli-compact-tool-traces`

## Problem Statement

The testing CLI currently writes raw-looking `[tool.call]` and `[tool.result]` blocks with full argument and result payloads. That output is too noisy for manual testing because tool activity visually competes with normal assistant text, dumps large stdout and JSON payloads, and makes it hard to track the paired call/result flow.

## Scope

The delivered change must provide:

- A compact default renderer for tool calls and tool results.
- A verbose renderer that keeps details readable without falling back to raw event dumps.
- A debug renderer that preserves raw event-style output for troubleshooting.
- Special rendering for `ask_user_input` style tool prompts as a user checkpoint instead of a normal tool trace.
- Focused tests for the pure formatting and summarization helpers.

## Non-Goals

The change must not introduce:

- Changes to the agent loop, tool execution semantics, or stream control flow.
- A full-screen TUI or new CLI dependencies.
- Mutation of runtime tool result objects for display purposes.
- Changes to server-side runtime behavior.

## Functional Requirements

The CLI must:

1. Render tool activity in three modes: `default`, `verbose`, and `debug`.
2. Keep the default mode visually subordinate to assistant and user messages through indentation and compact summaries.
3. Pair each tool call and tool result visually so the trace reads as one operation.
4. Summarize long shell commands safely, including collapsing long `python -c` invocations to `python -c "..."` in compact mode.
5. Summarize long stdout and stderr output instead of dumping the full payload in default mode.
6. Show a concise, useful failure reason rather than a large serialized wrapper object when a tool fails.
7. Preserve more structured args and result detail in verbose mode without becoming unbounded.
8. Preserve raw event or JSON-style output in debug mode for runtime troubleshooting.
9. Render `ask_user_input`, `human_intervention_request`, and local `ask_user_question` checkpoints as human-readable input prompts instead of normal tool trace lines.
10. Add CLI flags so `--verbose` selects verbose trace mode, `--debug` selects debug trace mode, and the default mode remains compact.

## Usability Requirements

The CLI should:

- Keep tool traces indented beneath the surrounding conversation.
- Avoid raw JSON, full stdout dumps, and full error objects in default mode.
- Limit preview lines and preview width so traces remain scannable.
- Keep unknown tools readable with a compact fallback summary.
- Keep existing conversational behavior unchanged outside of presentation.

## Verification Requirements

The implementation must be covered by:

- Unit tests for call and result summarization helpers.
- Unit tests for the three trace modes and the special human-input checkpoint rendering.
- A TypeScript build.
- Focused CLI unit tests.