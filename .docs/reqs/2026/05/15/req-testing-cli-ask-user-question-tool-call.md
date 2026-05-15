# Requirement: testing-cli-ask-user-question-tool-call

## Story

Teach the interactive testing CLI to handle human-input tool calls from the runtime so local streaming tests can continue when the model asks for a structured user decision.

Story slug: `testing-cli-ask-user-question-tool-call`

## Problem Statement

The streaming test CLI currently prints tool-call and tool-result events, but when `llm-runtime` emits a human-in-the-loop request through `ask_user_input` or its legacy alias, the CLI does not surface the structured questions as an actionable prompt. This leaves manual testers to infer the question from raw tool event output and type an unstructured follow-up, which is slow and error-prone.

## Scope

The delivered change must provide:

- Recognition of pending human-input tool results from runtime stream events.
- Terminal rendering for each structured question and its available choices.
- Interactive answer collection in the CLI after the assistant turn completes.
- A follow-up user message that carries the selected answers back into conversation history and the next request.
- Documentation and focused unit coverage for the parsing and formatting behavior.

## Non-Goals

The change must not introduce:

- A persistent approval queue or durable HITL state store.
- A full TUI or external prompt dependency.
- Server-side session ownership for the test CLI.
- Changes to provider behavior or `llm-runtime` internals.

## Functional Requirements

The CLI must:

1. Detect pending human-input artifacts returned by `ask_user_input` and `human_intervention_request` tool calls.
2. Accept the legacy phrase `ask_user_question` as a local alias when interpreting streamed tool events if it appears in older prompts or fixtures.
3. Display the question header, question text, and options without raw SSE framing.
4. Support single-select prompts by accepting one option number or id.
5. Support multiple-select prompts by accepting comma-separated option numbers or ids.
6. Respect `allowSkip` by allowing an empty answer only when the prompt is explicitly skippable.
7. Convert the collected selections into a clear follow-up user message that includes question ids, option ids, and labels.
8. Continue using the existing bounded auto-continue behavior only when no human-input prompt is pending.

## Usability Requirements

The CLI should:

- Keep prompts readable in plain terminals.
- Re-prompt on invalid selections instead of failing the whole request.
- Keep `/exit` and `/clear` behavior unchanged.
- Avoid exposing raw pending-result JSON to the main assistant output stream.

## Verification Requirements

The implementation must be covered by:

- Unit tests for detecting pending human-input tool results.
- Unit tests for formatting selected answers into a follow-up message.
- A TypeScript build.
- Relevant CLI unit tests.
