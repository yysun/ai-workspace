---
title: "Project Wiki"
type: "index"
status: "active"
language: "default"
last_commit: "0b82050ed1190af4221e4acf165b634c494c9e43"
updated_at: "2026-05-15"
---

# ai-workspace

This wiki is a bootstrap ingest for the committed repository state at `0b82050ed1190af4221e4acf165b634c494c9e43`.

The product is a small HTTP and SSE host around `llm-runtime`. It mounts one workspace, loads workspace instructions from `AGENTS.md`, exposes an OpenAI-style chat API, and ships a local streaming CLI for repeated manual testing.

## Core Features

- [[project-overview]]
- [[http-server-and-routes]]
- [[runtime-orchestration]]
- [[workspace-integration]]
- [[sse-streaming]]
- [[testing-cli]]
- [[repository-process-docs]]
- [[test-and-http-fixtures]]
- [[test-suite]]

## Concepts And Flows

- [[request-lifecycle]]
- [[provider-and-tool-defaults]]
- [[streaming-chat-turn]]
- [[human-input-cli-turn]]

## Notable Recent Change Notes

- [[cli-trace-and-human-input-improvements]]

## Coverage Notes

This bootstrap groups related files into feature pages instead of creating one page per file. The page set covers the committed root docs, build metadata, runtime modules, CLI modules, tests, HTTP fixtures, and `.docs/` process artifacts.