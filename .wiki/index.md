---
title: "Project Wiki"
type: "index"
status: "active"
language: "default"
last_commit: "55ad3d23a2bd160499b2a2d7ecc7b9b8513c5ac2"
updated_at: "2026-05-17"
---

# ai-workspace

This wiki tracks the committed repository state at `55ad3d23a2bd160499b2a2d7ecc7b9b8513c5ac2`.

The product is a small HTTP and SSE host around `llm-runtime`. Each chat request resolves a user identity from a Bearer token, loads shared workspace instructions from `AGENTS.md`, registers host-owned workspace tools, and can store per-user AI workspace content on the filesystem or in SQL Server.

## Core Features

- [[project-overview]]
- [[http-server-and-routes]]
- [[runtime-orchestration]]
- [[workspace-integration]]
- [[workspace-tools-and-storage]]
- [[sse-streaming]]
- [[testing-cli]]
- [[repository-process-docs]]
- [[test-and-http-fixtures]]
- [[test-suite]]

## Concepts And Flows

- [[request-lifecycle]]
- [[provider-and-tool-defaults]]
- [[multi-user-workspace-routing]]
- [[streaming-chat-turn]]
- [[human-input-cli-turn]]

## Notable Recent Change Notes

- [[cli-trace-and-human-input-improvements]]

## Coverage Notes

The current page set groups related files instead of creating one page per file. It covers the committed root docs, auth and route handling, runtime configuration, workspace resolution, host-owned tools, AIW storage providers, CLI modules, tests, HTTP fixtures, and `.docs/` process artifacts.