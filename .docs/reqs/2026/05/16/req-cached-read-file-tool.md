# Requirement: cached-read-file-tool

## Story

Add a host-owned file-reading tool with caching and replace the current built-in file reader used by the runtime.

Story slug: `cached-read-file-tool`

## Problem Statement

The runtime currently exposes the built-in file-reading tool, and repeated reads of the same workspace files can occur many times during one or more chat requests. That creates unnecessary latency, duplicate I/O, and avoidable cost, especially when common instruction files or process documents are reread in small identical ranges. The server needs a host-controlled file-reading surface that can enforce caching behavior safely across repeated calls while preserving correct results for changing files and multi-user workloads.

## Scope

The delivered change must provide:

- A host-owned file-reading tool that is registered during runtime creation for each chat request.
- Replacement of the current built-in file reader so the runtime uses the host-owned tool instead of the delegated built-in one.
- Cache-aware handling for repeated reads of the same file segment.
- Cache behavior that remains correct when file contents change.
- Behavior that is safe for multiple concurrent users sharing the same server process.
- Focused documentation and automated coverage for tool registration, cache behavior, and invalidation behavior.

## Non-Goals

The change must not introduce:

- Caching for unrelated built-in tools such as shell execution or directory mutation.
- Stale file results after a file has changed and the tool can detect the new version.
- Cross-user leakage of file content between different resolved workspace roots.
- A requirement to persist cache entries across process restarts.
- Broader runtime refactors unrelated to replacing the file-reading tool.

## Functional Requirements

The runtime integration must:

1. Register a host-owned file-reading tool as part of runtime creation for each chat request.
2. Disable or otherwise stop using the current built-in file-reading tool so file reads go through the host-owned tool.
3. Accept the file path and requested read range needed to preserve the current file-reading behavior exposed to the model.
4. Return the same class of readable file content the runtime currently exposes for successful file reads.
5. Reuse a prior result when a later file-read call resolves to the same cache identity.
6. Define the cache identity using the resolved workspace file path, the requested read range, and the file version.
7. Treat file-version changes as a cache miss so updated file contents are returned after an edit.
8. Keep cache behavior correct when multiple requests from one or more users read files concurrently.
9. Fail with clear tool errors when the target path is missing, invalid, unreadable, or outside the allowed workspace boundary.

## Cache Correctness Requirements

The file-read cache must:

- Distinguish different resolved workspace roots so one user's files cannot satisfy another user's read unless they refer to the same resolved file on disk.
- Distinguish different requested ranges within the same file.
- Distinguish different file versions for the same path and range.
- Allow repeated identical reads of the same file version to reuse the earlier result.
- Avoid returning stale content once the underlying file version changes.

## Security Requirements

The file-reading tool must:

- Restrict reads to the resolved workspace boundary used for the current request.
- Prevent path traversal or equivalent attempts to escape the allowed workspace root.
- Avoid exposing cached contents from one workspace root to another when the underlying files differ.
- Preserve existing secret-handling expectations for observable runtime events and logs.

## Usability Requirements

The tool should:

- Preserve a predictable file-read schema for the model.
- Surface cache behavior transparently enough that repeated successful reads do not change the user-visible contract.
- Keep error messages specific enough for the model to recover from bad paths or invalid ranges.
- Maintain parity with the current read_file behavior closely enough that existing workspace prompting remains usable after the replacement, even if the host-owned tool must use a non-reserved name because llm-runtime reserves built-in names.

## Runtime Constraint

- The implementation must account for the fact that llm-runtime reserves built-in tool names such as `read_file`, so the host-owned replacement may need a non-reserved tool name while still functionally replacing the built-in path.

## Verification Requirements

The implementation must be covered by:

- Automated tests for registration of the host-owned file-reading tool and replacement of the built-in one.
- Automated tests for cache hits on repeated identical reads.
- Automated tests for cache misses when path, range, workspace root, or file version differs.
- Automated tests for invalidation after file content changes.
- Automated tests for workspace-boundary enforcement and path-validation behavior.
- A TypeScript build or equivalent compile validation for the runtime integration.