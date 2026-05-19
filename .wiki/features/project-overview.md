---
title: "Project Overview"
type: "feature"
status: "active"
language: "default"
source_paths:
  - "README.md"
  - "package.json"
  - "package-lock.json"
  - "Dockerfile"
  - ".dockerignore"
  - ".gitignore"
  - ".env.example"
  - "tsconfig.json"
  - "tsconfig.e2e.json"
updated_at: "2026-05-18"
---

# Project Overview

`ai-workspace` is a small server that lets another app ask questions about one mounted workspace at a time. It takes a chat request, resolves which user it belongs to, runs one model turn with that workspace's instructions and tools, and sends the result back. It does not keep long-lived chat history or session state between requests.

## Why It Exists

The server exists to be a thin bridge between a client and `llm-runtime`. A caller sends messages, a Bearer token, and optional model hints; the server fills in missing defaults, resolves the user identity, loads the workspace's extra instructions, reads runtime configuration from the server process environment, then lets `llm-runtime` run the actual model, tools, and skills.

## Main Build And Run Commands

- `npm run dev` starts the server with `tsx watch`.
- `npm run build` compiles TypeScript into `dist/`.
- `npm run start` runs the built server.
- `npm test` runs unit, targeted, and e2e suites.
- `npm run chat:cli` starts the local streaming test client described in [[testing-cli]].

## Main Dependencies

- `express` provides the HTTP server.
- `llm-runtime` owns provider access, built-in tools, and workspace skill loading.
- `dotenv` loads local development variables.
- `mssql` backs the optional SQL Server content store for AI workspace data.
- `zod` validates the host-owned AI workspace content tools.

## Operational Defaults

- The default mounted workspace is `/workspace`.
- The default local server port is `3000`.
- Chat requests require a Bearer token and a configured identity lookup before they reach the runtime.
- User-scoped files and generated API response bodies live under `users/<id>/...` inside the mounted workspace.
- When `AIW_STORAGE` is enabled, the host keeps `read_file` available but turns off the other generic file-mutating or tree-walking built-ins and replaces that surface with host-owned storage tools plus `marp_cli`.
- The host expects model-provider credentials through generic `LLM_*` settings and provider-specific environment variables documented in [[provider-and-tool-defaults]].

## Related Pages

- [[http-server-and-routes]]
- [[runtime-orchestration]]
- [[workspace-integration]]
- [[multi-user-workspace-routing]]
- [[workspace-tools-and-storage]]
- [[test-suite]]