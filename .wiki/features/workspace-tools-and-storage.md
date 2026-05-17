---
title: "Workspace Tools And Storage"
type: "feature"
status: "active"
language: "default"
source_paths:
  - "src/runtime/runChatCompletion.ts"
  - "src/tools/readFileTool.ts"
  - "src/tools/apiRequestTool.ts"
  - "src/storage/providers/index.ts"
  - "src/storage/providers/fileProvider.ts"
  - "src/storage/providers/mssqlProvider.ts"
  - "src/storage/tools/aiwTools.ts"
  - "src/storage/utils/config.ts"
  - "src/storage/mssql/mssql-schema.sql"
  - "tests/unit/apiTool.test.ts"
  - "tests/unit/readFileTool.test.ts"
  - "tests/unit/storageFileProvider.test.ts"
updated_at: "2026-05-17"
---

# Workspace Tools And Storage

This page covers the host-owned tool layer that sits beside `llm-runtime`'s generic built-ins. In plain terms, this is where `ai-workspace` adds the pieces that understand the mounted workspace, user-scoped API access, and AI workspace content storage.

## Host-Owned File And API Tools

- `workspace_read_file` is the host replacement for the reserved built-in `read_file` name. It enforces workspace-root boundaries with `realpath`, returns the full file content, accepts legacy line-range arguments only for compatibility, and caches repeated reads by resolved path plus file version.
- `api_request` is optional and appears only when the workspace `.env` defines `API_BASE_URL`. It only accepts relative paths under that base URL, attaches host-owned auth and security-context headers, redacts sensitive headers in its result, and can save response bodies to disk when the body is too large or when the caller requests an output path.

Saved API bodies are tightly scoped. They must stay inside `users/<id>/data/api-responses`, and the tool checks real paths so symlinks cannot redirect writes outside the workspace.

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

## Storage Backends

The storage backend is selected per request:

- `file` storage is the default. It writes inside the current user's `users/<id>` tree, keeps metadata in sidecar JSON files, infers object and layer hints from paths, and blocks symlink escapes.
- `mssql` storage stores the same logical content in SQL Server tables keyed by `workspaceId` and `userId`, including search, version history, and soft deletes.

That means the runtime sees one logical tool surface even though the persistence layer can change underneath it.

## Related Pages

- [[runtime-orchestration]]
- [[provider-and-tool-defaults]]
- [[multi-user-workspace-routing]]
- [[test-suite]]