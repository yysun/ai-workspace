# Done: ai-workspace-scaffold

## Summary

- Scaffolded a new Node.js + TypeScript project for `ai-workspace`.
- Implemented `GET /health`, `POST /chat/completions`, and `POST /chat` with shared handler behavior.
- Added SSE streaming and non-stream JSON aggregation from one shared runtime event stream.
- Added workspace loading for `AGENTS.md` and appended it to the server default system prompt passed into `llm-runtime`.
- Integrated the real `llm-runtime` package directly through `createLLMEnvironment`, `resolveToolsAsync`, and `respondWithTools`.
- Delegated built-in workspace tools and skill loading to `llm-runtime` instead of maintaining a server-owned tool or skill layer.
- Added generic `LLM_*` runtime defaults, local `.env` support via `dotenv`, and Azure OpenAI provider configuration.
- Wrote README, environment example, ignore files, and a production multi-stage Dockerfile.
- Added unit tests for runtime target resolution, prompt composition, built-in selection, and health-default reporting.

## Verification

- Ran `npm install`.
- Ran `npm run build`.
- Ran `npm test`.
- Ran `npm run dev` with `WORKSPACE_ROOT=$PWD/workspace`.
- Verified `curl http://localhost:3000/health`.
- Verified streaming `curl -N http://localhost:3000/chat/completions` and observed `message.delta`, `tool.call`, `tool.result`, `message.done`, and `done` event coverage during runtime-backed execution.
- Verified non-stream `POST /chat/completions` JSON aggregation.
- Verified `POST /chat` alias behavior.
- Verified startup and chat behavior with provider keys explicitly unset on port `3001`.
- Re-ran `npm run build && npm test` after the VR fixes for tool-permission propagation and Azure provider support.

## Notes

- `shell_cmd` remains disabled by server policy in v1 even though tool execution is delegated to `llm-runtime`.
- Azure OpenAI requires `LLM_PROVIDER=azure` together with `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_RESOURCE_NAME`, and `AZURE_OPENAI_DEPLOYMENT_NAME`.
- `docker build -t ai-workspace .` could not be completed in this environment because the Docker daemon was not running.