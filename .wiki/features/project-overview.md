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
updated_at: "2026-05-15"
---

# Project Overview

`ai-workspace` is a small server that lets another app ask questions about one mounted workspace at a time. It takes a chat request, runs one model turn with that workspace's instructions and tools, and sends the result back. It does not keep long-lived chat history, user accounts, or session state between requests.

## Why It Exists

The server exists to be a thin bridge between a client and `llm-runtime`. A caller sends messages and optional model hints; the server fills in missing defaults, loads the workspace's extra instructions and local environment variables, then lets `llm-runtime` run the actual model, tools, and skills.

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

## Operational Defaults

- The default mounted workspace is `/workspace`.
- The default local server port is `3000`.
- The host expects model-provider credentials through generic `LLM_*` settings and provider-specific environment variables documented in [[provider-and-tool-defaults]].

## Related Pages

- [[http-server-and-routes]]
- [[runtime-orchestration]]
- [[workspace-integration]]
- [[test-suite]]