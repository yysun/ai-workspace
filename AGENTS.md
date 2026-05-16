# ai-workspace

Stateless HTTP/SSE server that runs one LLM chat completion turn against a mounted workspace.

## Stack
- Node.js ≥22, TypeScript, Express 5, `llm-runtime`
- Build: `npm run build` | Dev: `npm run dev` | Tests: `npm test`
- Entry: `src/index.ts` → `src/server.ts`

## Key paths
- `src/routes/chatCompletions.ts` — main chat endpoint
- `src/runtime/` — llm-runtime wiring
- `src/workspace/` — loads `AGENTS.md` and `.env` from the mounted workspace
- `src/tools/` — workspace tool definitions
- `tests/` — unit, targeted, e2e

## Behaviour
- Loads `AGENTS.md` from `WORKSPACE_ROOT` and prepends it to the system prompt each request.
- Loads `${WORKSPACE_ROOT}/.env` into `process.env` before each request.
- Does **not** own: chat history, sessions, users, multi-agent orchestration, or shell/file tools (those come from `llm-runtime`).

## Finding information
Use `.wiki` as reference, when you need details about this project.
