---
title: "Repository Process Docs"
type: "feature"
status: "active"
language: "default"
source_paths:
  - ".docs/reqs/2026/05/14/req-ai-workspace-scaffold.md"
  - ".docs/reqs/2026/05/14/req-streaming-test-cli.md"
  - ".docs/reqs/2026/05/15/req-testing-cli-ask-user-question-tool-call.md"
  - ".docs/reqs/2026/05/15/req-testing-cli-compact-tool-traces.md"
  - ".docs/plans/2026/05/14/plan-ai-workspace-scaffold.md"
  - ".docs/plans/2026/05/14/plan-streaming-test-cli.md"
  - ".docs/plans/2026/05/15/plan-testing-cli-ask-user-question-tool-call.md"
  - ".docs/plans/2026/05/15/plan-testing-cli-compact-tool-traces.md"
  - ".docs/done/2026/05/14/ai-workspace-scaffold.md"
  - ".docs/done/2026/05/14/streaming-test-cli.md"
  - ".docs/done/2026/05/15/testing-cli-ask-user-question-tool-call.md"
  - ".docs/done/2026/05/15/testing-cli-compact-tool-traces.md"
  - ".docs/tests/test-ai-workspace-scaffold.md"
updated_at: "2026-05-15"
---

# Repository Process Docs

The `.docs/` tree is a project journal for planned and completed work. It is not part of request-time runtime loading, but it matters for maintainers because it records requirements, plans, completion notes, and verification logs by date.

## Current Structure

- `.docs/reqs/` stores requirement notes.
- `.docs/plans/` stores implementation plans.
- `.docs/done/` stores delivery summaries and verification commands.
- `.docs/tests/` stores broader testing notes.

## What The Recent Notes Show

The most recent entries focus on the streaming test CLI: structured human-input handling and compact tool-trace rendering. Those notes line up with the shipped behavior documented in [[testing-cli]] and the recent-change summary in [[cli-trace-and-human-input-improvements]].

## Why This Page Exists

These files are easy to miss because they are not used at runtime. Grouping them here keeps the wiki coverage complete for the committed repository without pretending they are production code paths.

## Related Pages

- [[project-overview]]
- [[testing-cli]]
- [[cli-trace-and-human-input-improvements]]