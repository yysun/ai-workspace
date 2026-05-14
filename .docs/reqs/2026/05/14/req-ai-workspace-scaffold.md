# Requirement: ai-workspace-scaffold

## Story

Create a new project named `ai-workspace` that serves one stateless LLM chat-completion turn over HTTP/SSE against a mounted workspace.

Story slug: `ai-workspace-scaffold`

## Problem Statement

The project needs a lightweight server that exposes an OpenAI-style chat completions interface, loads workspace instructions from a mounted workspace, initializes the real `llm-runtime` package correctly, and streams results back to the client. The server must own only HTTP request handling, SSE streaming, workspace-root selection, and prompt augmentation via `AGENTS.md`. Conversation history, session state, relay behavior, multi-agent orchestration, and server-local tool recreation are out of scope.

## Scope

The delivered project must provide:

- A Node.js + TypeScript application named `ai-workspace`.
- A health endpoint for runtime checks.
- A chat completions endpoint with required SSE streaming support.
- Stateless per-request loading of workspace instructions from `AGENTS.md`.
- Direct initialization of the real `llm-runtime` package for chat completion execution.
- Delegation of tool and skill support to `llm-runtime` rather than server-local reimplementation.
- Local development support, production Docker packaging, and concise project documentation.

## Non-Goals

The project must not introduce:

- Multi-agent orchestration.
- Durable chat, session, or user storage.
- Relay server behavior.
- Shelling out to `agent-cli`.
- Automatic skill script execution.
- Recreating file, shell, or skill-loading tools in this server when `llm-runtime` already provides them.
- Authentication beyond a placeholder request-verification layer.
- A database or unrelated platform services.

## Core Product Model

The product must preserve the following ownership boundaries:

- The client owns conversation history.
- The server owns a single stateless LLM run.
- The workspace owns instructions, skills, files, and artifacts.
- `llm-runtime` owns the model and tool loop behind the server runtime boundary.

The dependency direction must be from `ai-workspace` to `llm-runtime`, not from `ai-workspace` to `agent-cli`.

## Workspace Requirements

The server must assume a mounted workspace root that defaults to `/workspace` and can be overridden by `WORKSPACE_ROOT`.

The workspace may contain:

- `AGENTS.md`
- `skills/<skill>/SKILL.md`
- `skills/<skill>/scripts/`
- `skills/<skill>/resources/`
- `data/`
- `process/`
- `presentations/`

The server must tolerate missing optional workspace files and directories, including:

- Missing `AGENTS.md`
- Missing `skills/`

These cases must not crash the server.

## API Requirements

The server must expose:

- `GET /health`
- `POST /chat/completions`
- `POST /chat` as an alias of the chat completions handler

The chat request body must accept an OpenAI-like shape with:

- Optional `model`
- Required `messages`
- Optional `stream`
- Optional `temperature`
- Optional `max_tokens`
- Optional `tools`
- Optional `tool_choice`
- Optional `metadata`

Each message must support roles `system`, `user`, `assistant`, and `tool`, plus optional `name` and `tool_call_id` fields.

For v1:

- Streaming must be supported.
- If `stream === true`, the response must be sent as SSE.
- If `stream !== true`, the server must collect the streamed runtime output and return a JSON response.

## Workspace Context Loading Requirements

For each chat request, the server must:

1. Read `AGENTS.md` from the workspace root when present.
2. Append the `AGENTS.md` content to the default system prompt used by `llm-runtime` rather than replacing the runtime's default prompt outright.
3. Initialize `llm-runtime` with the workspace root so its built-in workspace skill and tool support can operate against the mounted workspace.
4. Forward the request messages to `llm-runtime` for the actual model and tool loop.

## Skill Discovery Requirements

Workspace skill support must come from `llm-runtime`.

The server must not implement its own skill registry, frontmatter parser, or `load_skill` tool when `llm-runtime` already supports those capabilities.

The server's responsibility is limited to passing the correct workspace root and runtime configuration into `llm-runtime` so workspace skills under `${WORKSPACE_ROOT}/skills` can be discovered and used by the runtime itself.

## Tooling Requirements

Tool support must come from `llm-runtime`.

The server must not recreate built-in file, shell, or skill tools locally. If tool-related configuration is required, it must be passed into `llm-runtime` using the runtime's supported initialization or request options rather than through server-owned tool implementations.

Tool behavior requirements:

- The runtime must operate against the configured workspace root.
- The server must not expose an additional parallel tool system beside `llm-runtime`.
- Any tool enablement or restriction that remains part of the product contract must be expressed through `llm-runtime` configuration or request-time runtime options, not custom server code.

Configuration requirements:

- Tool-related environment flags must not be used to justify re-implementing tool wrappers inside `ai-workspace`.
- The environment contract should avoid bespoke per-tool toggles unless `llm-runtime` explicitly requires them.

## Runtime Integration Requirements

The server must use the real `llm-runtime` package directly rather than shelling out to a CLI or substituting a mock runtime for normal operation.

The project must define an internal async streaming interface for chat completion execution that can emit:

- Message deltas
- Message completion
- Tool calls
- Tool results
- Runtime errors

The server must initialize `llm-runtime` correctly for each request or server lifecycle boundary required by its API, including:

- Passing the effective workspace root
- Supplying the request messages
- Appending workspace `AGENTS.md` instructions to the runtime's default system prompt
- Relying on `llm-runtime` for built-in tool and skill support
- Applying default runtime behavior from generic `LLM_*` environment settings when request-level values are absent

Missing provider API keys must not crash the server. Runtime behavior in that case must fail clearly according to `llm-runtime` behavior.

## Streaming Requirements

SSE responses must emit events for:

- `message.delta`
- `tool.call`
- `tool.result`
- `message.done`
- `done`

Each event must carry JSON data matching the internal runtime event payload.

The implementation may support OpenAI-style chunk compatibility where practical, but the internal event model must remain simple and primary.

## Project Structure Requirements

The scaffold must include:

- Node/TypeScript project metadata
- Environment example file
- README
- Dockerfile and `.dockerignore`
- Source modules for server bootstrap, routing, config, runtime, workspace loading, SSE handling, and placeholder auth verification

The source tree must clearly separate:

- HTTP server setup
- Route handlers
- Runtime initialization code
- Workspace loading logic
- SSE mapping and writing
- Request verification placeholder

## Environment Requirements

The project must support these environment variables:

- `PORT`
- `WORKSPACE_ROOT`
- `LLM_PROVIDER`
- `LLM_MODEL`
- `LLM_MAXTOKEN`
- `LLM_TEMPERATURE`
- `LLM_PERMISSION`
- `LLM_REASONING`
- `OPENAI_API_KEY`
- `AZURE_OPENAI_API_KEY`
- `AZURE_OPENAI_RESOURCE_NAME`
- `AZURE_OPENAI_DEPLOYMENT_NAME`
- `AZURE_OPENAI_API_VERSION`
- `GOOGLE_API_KEY`
- `ANTHROPIC_API_KEY`

Environment behavior requirements:

- `LLM_PROVIDER` defines the default runtime provider when the request does not override it.
- `LLM_MODEL` defines the default runtime model when the request does not override it.
- `LLM_MAXTOKEN` defines the default max-token ceiling when the request does not override it.
- `LLM_TEMPERATURE` defines the default temperature when the request does not override it.
- `LLM_PERMISSION` maps to the default `llm-runtime` tool-permission behavior.
- `LLM_REASONING` maps to the default `llm-runtime` reasoning setting.
- Provider secret variables remain provider-specific because credential formats are provider-specific.
- Azure OpenAI must be supported as an allowed runtime provider when `LLM_PROVIDER=azure` and the Azure-specific environment variables are configured.

The project must not require all provider keys to exist at startup.

## Docker Requirements

The project must include a production-ready multi-stage Docker build that:

- Uses an official Node LTS image.
- Installs dependencies.
- Builds TypeScript output.
- Copies only the built application and runtime dependencies into the final image.
- Exposes port `3000`.
- Runs `node dist/index.js` by default.
- Assumes the mounted workspace lives at `/workspace`.
- Runs as a non-root user if practical.

The project must also include a `.dockerignore` that excludes common local-only artifacts including `node_modules`, `dist`, `.git`, `.env`, logs, and coverage output.

## Documentation Requirements

The README must explain:

- What `ai-workspace` is.
- What it is not.
- How to run locally.
- How to mount a workspace.
- A `/chat/completions` curl example.
- Expected workspace layout.
- That workspace tools and skills are provided by `llm-runtime`.
- How `AGENTS.md` is appended to the default system prompt.
- How generic `LLM_*` environment variables control runtime defaults.
- How Azure OpenAI can be selected through `LLM_PROVIDER=azure` with Azure-specific credentials.
- Docker build and run commands.

The README must include this scope statement verbatim:

`ai-workspace` is a stateless HTTP/SSE server for running one LLM chat completion turn against a mounted workspace.

It does not own chat history, users, agents, sessions, relay connections, or multi-agent orchestration.

## Operational Requirements

After scaffolding, the project must support these workflows successfully:

- `npm install`
- `npm run build`
- `npm run dev`
- `curl http://localhost:3000/health`
- A streaming `curl` request to `/chat/completions`
- `docker build -t ai-workspace .`
- `docker run` with a mounted workspace and optional provider key environment variables

The server must stay stable when optional instruction sources or provider keys are absent.

## Acceptance Criteria

The requirement is complete when all of the following are true:

1. A new `ai-workspace` Node.js + TypeScript project exists with the requested source layout.
2. The project exposes `GET /health`, `POST /chat/completions`, and `POST /chat` using the same chat handler.
3. Chat requests accept the documented OpenAI-style shape and support SSE streaming in v1.
4. Each request loads workspace `AGENTS.md` instructions from the configured workspace root when present, appends them to the default system prompt used by `llm-runtime`, and does not crash when optional workspace files are missing.
5. The runtime integration uses the real `llm-runtime` package directly, not a CLI shell-out and not a parallel mock-based product path.
6. Workspace tool and skill support are delegated to `llm-runtime`; the server does not recreate a separate tool or skill subsystem.
7. SSE responses emit the required runtime event types and terminate cleanly with a `done` event.
8. The project includes a multi-stage Dockerfile, `.dockerignore`, `.env.example`, `.gitignore`, and a concise README covering runtime scope and usage.
9. Local build, local dev run, health check, streaming chat request, and Docker build/run are all supported by the scaffold.
10. The delivered scaffold does not add multi-agent orchestration, durable state, relay behavior, `agent-cli` shell-outs, duplicated tool/runtime layers, or other out-of-scope platform features.
11. Default runtime behavior is driven by generic `LLM_*` environment settings rather than bespoke per-tool toggles or provider-specific default-model variables.

## Open Questions

- The exact `llm-runtime` initialization API must be confirmed during implementation so the server appends `AGENTS.md` to the runtime's default system prompt without disabling runtime-provided tools or skills.