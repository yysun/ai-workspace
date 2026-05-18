---
title: "Runtime Orchestration"
type: "feature"
status: "active"
language: "default"
source_paths:
  - "src/runtime/runChatCompletion.ts"
  - "src/runtime/runtimeConfig.ts"
  - "src/runtime/runtimeTypes.ts"
  - "src/tools/apiRequestTool.ts"
  - "src/storage/providers/index.ts"
  - "src/storage/tools/aiwTools.ts"
updated_at: "2026-05-18"
---

# Runtime Orchestration

This page explains the handoff from the web server into the model runner. In plain terms, this is the part that takes an incoming chat request, adds the workspace's extra instructions and settings, lets `llm-runtime` do the real model and tool work, then sends the results back to the client. The server does not build its own separate tool runner or skill loader.

## Main Responsibilities

- Add the workspace `AGENTS.md` text to the server's default instructions.
- Add runtime user context so the model knows which `users/<id>/...` tree belongs to the current caller.
- Turn incoming chat messages into the format expected by `llm-runtime`.
- Tell the runtime where to find workspace skills.
- Decide which model provider and model name to use when the request leaves those choices open.
- Register the host-owned tools for API access, deck rendering, and AI workspace content storage.
- Send the runtime's progress and final output back to the route layer.

## Event Contract

The runtime reports its work as a small set of event names:

- `message.delta`
- `message.done`
- `tool.call`
- `tool.result`
- `warning`
- `error`

Some tool events also include a `toolCallId`, which is mainly used by the interactive CLI flow in [[human-input-cli-turn]] to keep follow-up answers tied to the right request.

## Safety And Compatibility Work

This layer also handles a few safety details for the host. It expands shell argument placeholders like `$NAME` and `${NAME}` before a tool runs, but hides secret values when those tool results are shown in events. It also recognizes paused human-input tool results from `ask_user_input`, `human_intervention_request`, and the local compatibility alias `ask_user_question`, and it closes any request-scoped storage provider once the turn ends.

## Request-Owned Tools

The runtime still relies on `llm-runtime` for the generic built-ins, but this host adds request-scoped tool surfaces of its own when AI workspace storage is enabled:

- `marp_cli` renders Markdown decks from the user workspace into supported output formats such as `.html`, `.pdf`, `.pptx`, or speaker-note text.
- `api_request` is added only when the workspace `.env` exposes `API_BASE_URL`. The host constrains calls to that base URL, applies auth and security-context headers, returns response bodies inline by default, saves bodies under a user-scoped `api-responses` folder only when the caller provides `outputFilePath`, and can reuse successful `GET` responses from an in-memory cache when the caller provides `cacheTtlMs`.
- The AI workspace content tools described in [[workspace-tools-and-storage]] are always added. They sit on top of either the file provider or the SQL Server provider and are keyed by the resolved user id.

## Design Boundary

The split of responsibilities is still simple: the host owns request parsing, user scoping, extra tools, and HTTP responses, while `llm-runtime` owns provider access, the generic built-ins, and skill loading. That boundary shows up again in [[request-lifecycle]] and [[provider-and-tool-defaults]].

## Related Pages

- [[workspace-integration]]
- [[provider-and-tool-defaults]]
- [[workspace-tools-and-storage]]
- [[streaming-chat-turn]]
- [[test-suite]]