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
npm run build
npm run dev
```

The server optionally loads `.env` via `dotenv` for local development. Runtime code still reads only from `process.env`.

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
  data/
  process/
  presentations/
```

## Chat API

Required endpoints:

- `GET /health`
- `POST /chat/completions`
- `POST /chat` as an alias

When `stream` is `true`, chat responses are returned as SSE with events such as `message.delta`, `message.done`, and `done`.

When `stream` is not `true`, the server still uses the same runtime event stream internally and returns an aggregated JSON response.

## Skill loading behavior

Per request, the server:

1. Reads `AGENTS.md` if present.
2. Prepends one server-owned system message that contains the default system prompt plus appended `AGENTS.md` content.
3. Initializes `llm-runtime` with the workspace `skills/` root.

`llm-runtime` then provides built-in skill loading through `load_skill`. The server does not maintain its own skill registry or frontmatter parser.

## Tool security model

- Workspace built-ins are provided by `llm-runtime`.
- The server passes `WORKSPACE_ROOT` as the `workingDirectory` used for runtime tool execution.
- `read_file`, `list_files`, `grep`, and `load_skill` are enabled by default.
- `write_file` is available when `LLM_PERMISSION` is not `read`.
- `shell_cmd` stays disabled by server policy in v1.

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

Runtime defaults:

- `LLM_PROVIDER` sets the default provider when the request does not override it.
- `LLM_MODEL` sets the default model when the request does not override it.
- `LLM_MAXTOKEN` sets the default max-token limit when the request does not override it.
- `LLM_TEMPERATURE` sets the default temperature when the request does not override it.
- `LLM_PERMISSION` sets the default tool permission passed to `llm-runtime`.
- `LLM_REASONING` sets the default reasoning effort passed to `llm-runtime`.
- Set `LLM_PROVIDER=azure` together with `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_RESOURCE_NAME`, and `AZURE_OPENAI_DEPLOYMENT_NAME` to use Azure OpenAI.

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