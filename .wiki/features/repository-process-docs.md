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
  - ".docs/plans/2026/05/16/plan-cached-read-file-tool.md"
  - ".docs/done/2026/05/14/ai-workspace-scaffold.md"
  - ".docs/done/2026/05/14/streaming-test-cli.md"
  - ".docs/done/2026/05/15/testing-cli-ask-user-question-tool-call.md"
  - ".docs/done/2026/05/15/testing-cli-compact-tool-traces.md"
  - ".docs/done/2026/05/16/cached-read-file-tool.md"
  - ".docs/tests/test-ai-workspace-scaffold.md"
updated_at: "2026-05-18"
---

# Repository Process Docs

The `.docs/` tree is a project journal for planned and completed work. It is not part of request-time runtime loading, but it matters for maintainers because it records requirements, plans, completion notes, and verification logs by date.

## Current Structure

- `.docs/reqs/` stores requirement notes.
- `.docs/plans/` stores implementation plans.
- `.docs/done/` stores delivery summaries and verification commands.
- `.docs/tests/` stores broader testing notes.

## What The Recent Notes Show

The recent entries show two threads of work: the shipped streaming test CLI improvements, and a short-lived cached `read_file` experiment in the runtime layer. The CLI notes line up with the behavior documented in [[testing-cli]]. The cached-read-file notes are still useful as project history, but the current code no longer uses that host-owned replacement; the repo moved back to the built-in `read_file` path with AIW-specific tool gating documented in [[provider-and-tool-defaults]].

## Why This Page Exists

These files are easy to miss because they are not used at runtime. Grouping them here keeps the wiki coverage complete for the committed repository without pretending they are production code paths.

## Related Pages

- [[project-overview]]
- [[testing-cli]]
- [[cli-trace-and-human-input-improvements]]