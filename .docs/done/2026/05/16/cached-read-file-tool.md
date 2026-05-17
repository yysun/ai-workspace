# cached-read-file-tool

## Summary

- Replaced the delegated built-in `read_file` path with a host-owned cached `workspace_read_file` tool registered during per-request runtime creation.
- Added workspace-root boundary enforcement so `read_file` cannot escape the active request workspace, including symlink-aware realpath checks.
- Added exact-read caching keyed by resolved absolute path, requested line range, and file version derived from file size and modification time.
- Preserved the file-read contract around `filePath` / `startLine` / `endLine`, while using the non-reserved `workspace_read_file` name because llm-runtime reserves built-in names.
- Kept other built-in tools unchanged and preserved optional `api_request` registration.
- Added clearer error mapping for missing files, unreadable files, invalid ranges, and non-file targets.

## Verification

- Ran `node --import tsx --test tests/unit/runtimeConfig.test.ts tests/unit/runChatCompletion.test.ts tests/unit/readFileTool.test.ts`.
- Ran `npm run build`.
- Ran `node --import tsx --test tests/unit/readFileTool.test.ts tests/unit/runChatCompletion.test.ts tests/unit/runtimeConfig.test.ts && npm run build` after tightening read-file error handling during CR.
- Ran `npm run test:unit`.

## Notes

- No dedicated E2E spec was added because this story is an internal runtime/tooling change with deterministic unit coverage.
- Cache entries are process-local and bounded; they do not persist across server restarts.
- Cache invalidation currently relies on resolved path plus file size and modification time, which is sufficient for this repo’s targeted requirement.