---
title: "CLI Trace And Human Input Improvements"
type: "bug-fix"
status: "active"
language: "default"
source_paths:
  - "src/cli/testChatCli.ts"
  - "src/cli/streamingTestCli.ts"
  - "src/cli/toolTraceRenderer.ts"
  - "tests/unit/streamingTestCli.test.ts"
  - ".docs/done/2026/05/15/testing-cli-ask-user-question-tool-call.md"
  - ".docs/done/2026/05/15/testing-cli-compact-tool-traces.md"
updated_at: "2026-05-15"
---

# CLI Trace And Human Input Improvements

The recent CLI work focused on making local streamed runs easier to follow without breaking the places where the model has to stop and ask the human for input.

## Shipped Improvements

- Added mode-aware trace rendering with `default`, `verbose`, and `debug` modes.
- Added compact summaries for common tools so routine file and shell activity stays readable.
- Rendered structured human-input checkpoints as prompts instead of raw tool dumps.
- Added support for the local compatibility alias `ask_user_question`.
- Forwarded tool-call ids so pending requests can be matched to later answers.

## Why This Was Needed

Before these changes, local streaming tests were harder to follow during tool-heavy runs and did not handle every human-input tool name consistently. The new path makes the CLI a more reliable local test tool for real runtime behavior.

## Verification History

The done notes record focused unit-test runs and full-suite verification around these changes. The current behavior is also summarized in [[testing-cli]] and [[human-input-cli-turn]].

## Related Pages

- [[testing-cli]]
- [[human-input-cli-turn]]
- [[repository-process-docs]]