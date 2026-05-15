# Done: streaming-test-cli

## Summary

- Added a dependency-free interactive CLI for sending streaming chat requests to `POST /chat/completions`.
- Kept conversation history in process memory and reuse it on subsequent turns.
- Added `/clear` to reset in-memory history and `/exit` or `/quit` to leave the CLI cleanly.
- Implemented SSE parsing and runtime-event assembly helpers so the assistant text renders incrementally as `message.delta` events arrive.
- Avoided storing partial assistant output when a request fails by committing history only after a completed assistant turn.
- Documented the new CLI flow in the README and added a `npm run chat:cli` script.

## Verification

- Ran `npm test`.
- Ran `npm run build`.
- Ran `printf '/clear\n/exit\n' | npm run chat:cli`.
- Reviewed the final uncommitted diff for the CLI, tests, docs, and script changes.

## Notes

- Dedicated E2E coverage was intentionally skipped because the server-side HTTP/SSE path already has coverage and this story adds a thin developer utility on top of that surface.
- The CLI defaults to `http://localhost:3000` and model `default`, with optional overrides through `--url`, `--model`, `AI_WORKSPACE_BASE_URL`, and `AI_WORKSPACE_MODEL`.
- I did not create a git commit because this environment’s higher-priority agent instructions prohibit committing unless you explicitly request it.