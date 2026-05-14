# Test Spec: ai-workspace-scaffold

## Scenario 1: Health endpoint responds

Given the dev server is running
When a client sends `GET /health`
Then the response status is `200`
And the body reports service health

## Scenario 2: Streaming chat completion returns SSE events

Given the dev server is running
And the mounted workspace may or may not contain `AGENTS.md` and `skills/`
When a client sends `POST /chat/completions` with `stream: true`
Then the response uses `text/event-stream`
And it emits one or more `message.delta` events
And it emits a final `message.done` event
And it terminates with a `done` event

## Scenario 3: Non-stream chat completion returns aggregated JSON

Given the dev server is running
When a client sends `POST /chat/completions` with `stream: false`
Then the response status is `200`
And the body contains one assistant message aggregated from runtime output

## Scenario 4: Chat alias uses the same behavior

Given the dev server is running
When a client sends `POST /chat` with the same request body used for `/chat/completions`
Then the response behavior matches the main chat completions handler

## Scenario 5: Missing workspace files do not crash the server

Given the workspace root does not contain `AGENTS.md`
And the workspace root does not contain `skills/`
When a client sends a chat completion request
Then the server stays available
And the request returns a runtime response or a clear runtime error without process failure

## Scenario 6: Workspace AGENTS.md is appended to the default system prompt

Given the workspace root contains an `AGENTS.md` file with a simple observable instruction
When a client sends a chat completion request
Then the response reflects both the runtime's normal behavior and the appended workspace instruction
And the server does not replace the default `llm-runtime` system prompt outright

## Scenario 7: Workspace tools and skills come from llm-runtime

Given the workspace contains a skill or tool resource supported by `llm-runtime`
When a client sends a chat completion request that causes runtime tool or skill usage
Then the runtime uses `llm-runtime`-provided workspace capabilities
And the server does not rely on its own duplicated tool or skill implementation

## Scenario 8: Generic LLM environment defaults are applied

Given `LLM_PROVIDER`, `LLM_MODEL`, `LLM_MAXTOKEN`, `LLM_TEMPERATURE`, `LLM_PERMISSION`, and `LLM_REASONING` are set
When a client sends a chat completion request without overriding those values
Then the server passes those defaults into `llm-runtime`
And the runtime behavior reflects the generic `LLM_*` environment contract rather than bespoke provider-specific default-model vars or per-tool toggle env vars
And `LLM_PROVIDER=azure` is accepted when paired with Azure OpenAI credential variables

## Scenario 9: Missing provider keys do not prevent startup

Given `OPENAI_API_KEY`, `AZURE_OPENAI_API_KEY`, `GOOGLE_API_KEY`, and `ANTHROPIC_API_KEY` are unset
When the server starts and receives a chat completion request
Then the process remains healthy
And the request returns a runtime response or a clear runtime error without process failure