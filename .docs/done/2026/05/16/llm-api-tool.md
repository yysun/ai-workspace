# Done: llm-api-tool

## Summary

- Added a host-owned `api_request` tool that is registered per chat request through `llm-runtime` `extraTools` after workspace `.env` values are applied.
- Moved the tool implementation under `src/tools/apiRequestTool.ts` so tool code is separate from runtime orchestration.
- Resolved API calls relative to `API_BASE_URL` and rejected origin or base-path escape attempts.
- Applied `API_ACCESS_TOKEN`, optional `API_AUTH_SCHEME`, and optional `API_SECURITY_CONTEXT` headers automatically instead of requiring the model to send secrets.
- Returned structured API results with status, sanitized headers, URL, and parsed JSON or raw body content.
- Extended runtime redaction to cover security-context environment values in observable tool events.
- Updated runtime prompt and README guidance so configured workspace API work prefers `api_request` over ad hoc shell usage.
- Added focused unit tests for API tool behavior and redaction coverage.

## Verification

- Ran `node --import tsx --test tests/unit/apiTool.test.ts tests/unit/runChatCompletion.test.ts tests/unit/runtimeConfig.test.ts`.
- Ran `npm run test:unit`.
- Ran `npm run build`.
- Ran `git --no-pager diff --check`.

## Notes

- Dedicated E2E coverage was not added because this is a deterministic runtime integration without a new user-facing HTTP flow; unit coverage plus the TypeScript build were sufficient for this story.
- Workspace API configuration remains in `${WORKSPACE_ROOT}/.env`, not the server-level `.env.example`, so mounted workspaces can supply their own base URL and credentials.
- `npm run build` initially failed on a local DOM-type assumption (`BodyInit`); the implementation was narrowed to string request bodies and the build now passes.