---
title: "Human Input CLI Turn"
type: "flow"
status: "active"
language: "default"
source_paths:
  - "src/cli/testChatCli.ts"
  - "src/cli/streamingTestCli.ts"
  - "src/cli/toolTraceRenderer.ts"
  - "src/runtime/runChatCompletion.ts"
  - "tests/unit/streamingTestCli.test.ts"
updated_at: "2026-05-15"
---

# Human Input CLI Turn

The local CLI has a path for runtime tools that pause and ask the human to choose from a list of options. This is the flow that lets a streamed local test continue when the model cannot proceed without a person picking an answer.

## Flow

1. The runtime emits a tool call for `ask_user_input`, `human_intervention_request`, or `ask_user_question`.
2. The host forwards the tool-call id in runtime events.
3. The CLI detects the pending request and renders the questions with numbered choices.
4. The user answers with a number, an option id, or a comma-separated list for multiple select.
5. The CLI sends the chosen labels and ids back as the next user message so the conversation can continue.

## Why It Works This Way

The HTTP client only keeps user and assistant messages. It does not send a formal tool-role reply back into the server. That is why the CLI turns the selection into a structured follow-up user turn instead of inventing a separate reply protocol.

## Related Pages

- [[testing-cli]]
- [[runtime-orchestration]]
- [[cli-trace-and-human-input-improvements]]