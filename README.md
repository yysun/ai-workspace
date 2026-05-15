# ai-workspace

`ai-workspace` is a stateless HTTP/SSE server for running one LLM chat completion turn against a mounted workspace.

It does not own chat history, users, agents, sessions, relay connections, or multi-agent orchestration.

## What it is

`ai-workspace` exposes a small OpenAI-style chat completions API over HTTP. For each request it loads workspace instructions from `AGENTS.md`, appends them to the server's default system prompt, initializes `llm-runtime`, and streams runtime events back over SSE.

The server does not recreate its own file, shell, or skill tools. Workspace tool and skill support come from `llm-runtime`.

## Run locally

Create a local env file first:

```bash
cp .env.example .env
```

```bash
npm install
npm test
npm run build
npm run dev
```

The server optionally loads its local `.env` via `dotenv` for local development. Before each chat request it also loads `${WORKSPACE_ROOT}/.env` into `process.env` so workspace-scoped variables are available during runtime execution.

Health check:

```bash
curl http://localhost:3000/health
```

Streaming chat:

```bash
curl -N http://localhost:3000/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "default",
    "stream": true,
    "messages": [
      { "role": "user", "content": "Hello. What workspace instructions are loaded?" }
    ]
  }'
```

Non-stream chat:

```bash
curl http://localhost:3000/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "default",
    "stream": false,
    "messages": [
      { "role": "user", "content": "Summarize the loaded workspace context." }
    ]
  }'
```

With a valid request body, the server will either return a normal completion response or a clear `5xx` runtime error when no provider is configured. Invalid JSON or invalid request shapes return `400`.

## Testing

Run the full automated test suite:

```bash
npm test
```

Run only unit tests:

```bash
npm run test:unit
```

Run targeted integration-style tests:

```bash
npm run test:targeted
```

Run only end-to-end HTTP tests:

```bash
npm run test:e2e
```

The repository also includes manual HTTP request examples under `tests/http/` for quick local checks.

## Interactive test CLI

For repeated streaming checks, run the local interactive CLI in a separate terminal while the server is running:

```bash
npm run chat:cli
```

Optional overrides:

```bash
npm run chat:cli -- --url http://localhost:3000 --model default
```

Auto-continue one or more follow-up turns with a synthetic user message such as `go ahead`:

```bash
npm run chat:cli -- --auto-continue --auto-continue-message "go ahead" --auto-continue-turns 1
```

Switch the tool trace renderer when you need more or less detail:

```bash
npm run chat:cli -- --verbose
npm run chat:cli -- --debug
```

The CLI sends `stream: true` requests to `/chat/completions`, prints assistant output as SSE deltas arrive, and keeps the full conversation in memory for the life of the process. Tool-call, tool-result, and warning lines are shown in gray in TTY terminals. Use `/clear` to reset history and `/exit` to quit.

By default, tool activity is rendered as a compact indented trace so assistant text remains easy to follow. `--verbose` expands the trace with bounded args and raw payload previews, while `--debug` restores raw-style tool event dumps for runtime troubleshooting.

When the runtime asks for structured human input through `ask_user_input`, `human_intervention_request`, or the local compatibility alias `ask_user_question`, the CLI renders the available choices in the terminal. Prompts are shown as numbered choices so the user can usually reply with a single number; for multiple-select prompts, enter numbers separated by commas. Skippable prompts allow an empty answer. Option ids are still accepted for compatibility, and displayed human-input text is sanitized to avoid emoji-heavy prompts in the terminal. The CLI sends the selected ids and labels back as the next user turn so the local test conversation can continue.

When `--auto-continue` is enabled, the CLI can automatically submit a bounded follow-up message after a planning-style assistant reply that says things like `I will ...` or asks to proceed. This is useful for quick experiments, but it stays opt-in because it can otherwise mask places where the model should have called a tool directly. Warning lines are still shown when the runtime detects narrated progress without tool activity, and the CLI allows a small bounded grace window for those warning-only stalls before it stops auto-continuing.

## Mount a workspace

Default workspace root:

```txt
/workspace
```

Override it with `WORKSPACE_ROOT` when running locally.

Provider selection:

- If `metadata.provider` is set, that provider is used.
- If `model` is prefixed like `openai:gpt-4.1-mini`, `anthropic/claude-sonnet-4-20250514`, or `azure:gpt-4.1-mini`, the prefix selects the provider.
- Otherwise the server uses `LLM_PROVIDER` when it is set, then falls back to the first configured provider.
- If `model` is omitted or set to `default`, the server uses `LLM_MODEL` when it is set and otherwise falls back to an internal provider-specific default.

Expected layout:

```txt
/workspace
  AGENTS.md
  skills/
    some-skill/
      SKILL.md
      scripts/
      resources/
  .agents/
    skills/
      some-skill/
        SKILL.md
        scripts/
        resources/
  data/
  process/
  presentations/
```

## Chat API

Required endpoints:

- `GET /health`
- `POST /chat/completions`
- `POST /chat` as an alias

When `stream` is `true`, chat responses are returned as SSE with events such as `message.delta`, `message.done`, `warning`, and `done`.

When `stream` is not `true`, the server still uses the same runtime event stream internally and returns an aggregated JSON response.

When a request is rejected with `400`, the server logs request diagnostics including a truncated body preview to help debug malformed JSON or invalid payloads. Runtime `5xx` errors do not log chat message bodies.

## Skill loading behavior

Per request, the server:

1. Reads `AGENTS.md` if present.
2. Prepends one server-owned system message that contains the default system prompt plus appended `AGENTS.md` content.
3. Initializes `llm-runtime` with both workspace skill roots: `skills/` and `.agents/skills/`.

`llm-runtime` then provides built-in skill loading through `load_skill`. The server does not maintain its own skill registry or frontmatter parser.

## Tool security model

- Workspace built-ins are provided by `llm-runtime`.
- The server passes `WORKSPACE_ROOT` as the `workingDirectory` used for runtime tool execution.
- The server also loads `${WORKSPACE_ROOT}/.env` before each runtime call so workspace-local variables are visible to runtime code.
- All `llm-runtime` built-ins are enabled by default through the runtime's built-in selection contract.
- `LLM_PERMISSION` is passed to `llm-runtime`; the server does not hide or narrow built-ins based on permission.

For external API tasks, prefer `shell_cmd` when the workspace instructions or API guide require authenticated `curl` calls, and prefer `web_fetch` only for simple unauthenticated fetches.

## Environment

Supported variables:

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
- `OPENAI_COMPATIBLE_API_KEY`
- `OPENAI_COMPATIBLE_BASE_URL`

Runtime defaults:

- `LLM_PROVIDER` sets the default provider when the request does not override it.
- `LLM_MODEL` sets the default model when the request does not override it.
- `LLM_MAXTOKEN` sets the default max-token limit when the request does not override it.
- `LLM_TEMPERATURE` sets the default temperature when the request does not override it.
- `LLM_PERMISSION` sets the default tool permission passed to `llm-runtime`.
- `LLM_REASONING` sets the default reasoning effort passed to `llm-runtime`.
- Set `LLM_PROVIDER=azure` together with `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_RESOURCE_NAME`, and `AZURE_OPENAI_DEPLOYMENT_NAME` to use Azure OpenAI.
- Set `LLM_PROVIDER=openai-compatible` together with `OPENAI_COMPATIBLE_API_KEY` and `OPENAI_COMPATIBLE_BASE_URL` to use an OpenAI-compatible endpoint.

Workspace runtime variables:

- If `${WORKSPACE_ROOT}/.env` exists, it is loaded before each chat request.
- This is intended for workspace-local variables such as `API_BASE_URL` and `API_ACCESS_TOKEN`.

## Docker

Docker should continue to inject environment variables at runtime. The container does not depend on a bundled `.env` file.

Build the image:

```bash
docker build -t ai-workspace .
```

Run the container with a mounted workspace:

```bash
docker run --rm -p 3000:3000 \
  --env-file .env \
  -v "$PWD/workspace:/workspace" \
  ai-workspace
```

You can still use individual `-e` flags instead of `--env-file` when that is a better fit for your deployment environment.

The runtime image expects:

```txt
/app
  dist/
  node_modules/
  package.json

/workspace
  AGENTS.md
  skills/
  data/
  process/
  presentations/
```