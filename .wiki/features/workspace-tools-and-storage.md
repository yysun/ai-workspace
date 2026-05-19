---
title: "Workspace Tools And Storage"
type: "feature"
status: "active"
language: "default"
source_paths:
  - "src/runtime/runChatCompletion.ts"
  - "src/tools/apiRequestTool.ts"
  - "src/storage/providers/index.ts"
  - "src/storage/providers/fileProvider.ts"
  - "src/storage/providers/mssqlProvider.ts"
  - "src/storage/tools/aiwTools.ts"
  - "src/storage/utils/config.ts"
  - "src/storage/mssql/mssql-schema.sql"
  - "tests/unit/apiTool.test.ts"
  - "tests/unit/storageFileProvider.test.ts"
updated_at: "2026-05-18"
---

# Workspace Tools And Storage

This page covers the host-owned tool layer that sits beside `llm-runtime`'s generic built-ins. In plain terms, this is where `ai-workspace` adds the pieces that understand the mounted workspace, user-scoped API access, and AI workspace content storage.

## Host-Owned File And API Tools

- `marp_cli` renders user-scoped Markdown decks into supported output formats without exposing unrestricted shell access to the model.
- `api_request` is optional and appears only when the server process environment defines `API_BASE_URL`. It only accepts relative paths under that base URL, attaches host-owned auth and security-context headers, redacts sensitive headers in its result, can save response bodies to disk when the body is too large or when the caller requests an output path, and supports opt-in `GET` caching with `cacheTtlMs` plus `bypassCache`.

Saved API bodies are tightly scoped. By default, auto-saved oversized responses land under `users/<id>/data/api-responses`, and explicit `outputFilePath` values must still resolve inside the current user's workspace root. The tool checks real paths so symlinks cannot redirect writes outside the workspace.

Cached API entries are process-local. They are keyed by the resolved user identity plus the normalized request URL and request headers, and are reused only until the caller-provided TTL expires.

`marp_cli` is also path-bound. It only reads Markdown files that already exist under the current user's workspace root, only writes outputs under that same root, validates the output format from the file extension or explicit `format`, and can optionally pass a workspace-local Marp config file plus `--allow-local-files` when the caller requests it.

## AI Workspace Content Tools

Every request also gets a small CRUD-style tool set for AI workspace content:

- `resolve_object`
- `search_content`
- `list_content`
- `read_content`
- `write_content`
- `create_content`
- `delete_content`

These tools give the model a stable path-addressable content layer for notes, summaries, outputs, and similar structured workspace artifacts. The tool wrappers validate inputs with `zod` and return structured success or error payloads instead of throwing raw backend details into the model.

The read-oriented AIW tools also support optional in-memory caching through `cacheTtlMs` and `bypassCache`. Cache keys are namespaced per request tool root so one user's cached reads do not leak into another user's workspace.

## Storage Backends

The storage backend is selected per request:

- `file` storage is the default. It writes inside the current user's `users/<id>` tree, keeps metadata in sidecar JSON files, infers object and layer hints from paths, and blocks symlink escapes.
- `mssql` storage stores the same logical content in SQL Server tables keyed by `workspaceId` and `userId`, including search, version history, and soft deletes.

That means the runtime sees one logical tool surface even though the persistence layer can change underneath it.

When `AIW_STORAGE` is not enabled, none of these host-owned storage tools are registered and the runtime falls back to the normal `llm-runtime` built-ins.

## Related Pages

- [[runtime-orchestration]]
- [[provider-and-tool-defaults]]
- [[multi-user-workspace-routing]]
- [[test-suite]]