---
title: "Runtime Orchestration"
type: "feature"
status: "active"
language: "default"
source_paths:
  - "src/runtime/runChatCompletion.ts"
  - "src/runtime/runtimeConfig.ts"
  - "src/runtime/runtimeTypes.ts"
updated_at: "2026-05-15"
---

# Runtime Orchestration

This page explains the handoff from the web server into the model runner. In plain terms, this is the part that takes an incoming chat request, adds the workspace's extra instructions and settings, lets `llm-runtime` do the real model and tool work, then sends the results back to the client. The server does not build its own separate tool runner or skill loader.

## Main Responsibilities

- Add the workspace `AGENTS.md` text to the server's default instructions.
- Turn incoming chat messages into the format expected by `llm-runtime`.
- Tell the runtime where to find workspace skills.
- Decide which model provider and model name to use when the request leaves those choices open.
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

This layer also handles a few safety details for the host. It expands shell argument placeholders like `$NAME` and `${NAME}` before a tool runs, but hides secret values when those tool results are shown in events. It also recognizes paused human-input tool results from `ask_user_input`, `human_intervention_request`, and the local compatibility alias `ask_user_question`.

## Design Boundary

The split of responsibilities is simple: the host owns request parsing and HTTP responses, while `llm-runtime` owns provider access, built-in tools, and skill loading. That boundary shows up again in [[request-lifecycle]] and [[provider-and-tool-defaults]].

## Related Pages

- [[workspace-integration]]
- [[provider-and-tool-defaults]]
- [[streaming-chat-turn]]
- [[test-suite]]