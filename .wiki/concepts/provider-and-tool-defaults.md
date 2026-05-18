---
title: "Provider And Tool Defaults"
type: "concept"
status: "active"
language: "default"
source_paths:
  - "src/config/env.ts"
  - "src/runtime/runtimeConfig.ts"
  - "src/routes/health.ts"
  - "src/storage/utils/config.ts"
updated_at: "2026-05-18"
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
- Built-in tool selection is explicit, not open-ended. The host always enables `shell_cmd`, `ask_user_input`, and `read_file`, always disables `load_skill` and `web_fetch`, and disables the other generic file built-ins when AI workspace storage tools are active.

When AI workspace storage is enabled, the host adds request-scoped tools:

- `api_request` appears only when the workspace `.env` defines `API_BASE_URL`.
- `marp_cli` is registered for user-scoped deck rendering.
- The AI workspace content tools described in [[workspace-tools-and-storage]] are registered and are keyed by the resolved user id.

For AI workspace storage, `AIW_STORAGE` defaults to `file`, `AIW_WORKSPACE_ID` defaults to `local`, and SQL Server mode requires `AIW_MSSQL_CONNECTION_STRING`.

## User Identity Defaults

The chat route does not take a standalone `AUTH_USER_URL` variable. Instead, `src/config/env.ts` derives the identity lookup URL from the host-level `API_BASE_URL` and `AUTH_USER_PATH`. If either part is missing, chat requests fail with `401` before the runtime starts.

The `/health` response shows these resolved defaults so someone running the service can quickly confirm the current runtime settings.

## Related Pages

- [[project-overview]]
- [[runtime-orchestration]]
- [[multi-user-workspace-routing]]
- [[workspace-integration]]
- [[workspace-tools-and-storage]]