---
title: "Provider And Tool Defaults"
type: "concept"
status: "active"
language: "default"
source_paths:
  - "src/config/env.ts"
  - "src/runtime/runtimeConfig.ts"
  - "src/routes/health.ts"
updated_at: "2026-05-15"
---

# Provider And Tool Defaults

This page explains how the server decides which model provider, model name, and tool settings to use when a request does not spell out every choice. The code handles that in two steps: first it reads environment settings in `src/config/env.ts`, then it fills in the remaining runtime choices in `src/runtime/runtimeConfig.ts`.

## Provider Selection Order

When a request reaches the runtime layer, the server picks a provider in this order:

1. A provider prefix embedded in `model`, such as `openai:gpt-4.1-mini`.
2. `metadata.provider`.
3. `LLM_PROVIDER` from the server environment.
4. The first configured provider discovered from available credentials.
5. `openai` as the last fallback.

If both a model prefix and `metadata.provider` are present but disagree, the server stops with an error instead of guessing.

## Model Defaults

If the request omits a model or uses `default`, the host tries `LLM_MODEL` first. If that is not set, it falls back to a provider-specific default such as `gpt-4.1-mini`, `claude-sonnet-4-20250514`, or `gemini-2.5-flash`.

## Tool And Reasoning Defaults

- `LLM_PERMISSION` defaults to `auto`.
- `LLM_REASONING` defaults to `medium`.
- Built-in tool selection is currently `true`, which means the host enables all `llm-runtime` built-ins by default.

The `/health` response shows these resolved defaults so someone running the service can quickly confirm the current runtime settings.

## Related Pages

- [[project-overview]]
- [[runtime-orchestration]]
- [[workspace-integration]]