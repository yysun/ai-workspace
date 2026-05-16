# multi-user-chat

## Summary

Added per-user workspace isolation and Bearer token auth to the `/chat/completions` endpoint.

- `src/auth/resolveUserId.ts` (new): calls `AUTH_USER_URL` with a Bearer token and returns a `{ id }` JSON user ID; throws `UserIdResolutionError` on any failure.
- `src/routes/chatCompletions.ts`: extracts Bearer token from `Authorization` header, resolves user ID, sets `workspaceRoot` to `<WORKSPACE_ROOT>/<sanitized-user-id>`, passes token to runtime.
- `src/runtime/runChatCompletion.ts`: injects `API_ACCESS_TOKEN` from `input.accessToken` into `requestEnv` so the `api_request` tool forwards it on outbound calls.
- `src/runtime/runtimeTypes.ts`: added `accessToken?: string` to `RunChatCompletionInput`.
- `src/config/env.ts`: added `authUserUrl?: string` parsed from `AUTH_USER_URL`.
- Path traversal fix: `userId` is sanitized (`/`, `\`, `.`, `\0` replaced with `_`) before being appended to the workspace root.

## Verification

- `npm run build` — clean, no type errors.
- `npm run test:targeted` — 7 new `resolveUserId` tests pass (success, auth forwarding, non-2xx, non-JSON, missing id, empty id, network error).
- `npm run test:e2e` — all 4 e2e tests pass after updating them to supply a Bearer token and mock identity server.
- `npm run test:unit` — all 60 unit tests pass (no regressions).
- CR ran: path traversal finding fixed; import style cleaned up.

## Notes

- `load_skill` targeted test is a pre-existing failure unrelated to this story.
- `AUTH_USER_URL` not set → immediate 401; server still starts.
- Bearer token redaction is handled automatically by the existing `isSensitiveEnvName` regex (`TOKEN` suffix matches).
- The user identity API contract is JSON `{ "id": string }`; other response shapes are rejected with 401.
