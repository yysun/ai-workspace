# Plan: streaming-test-cli

## Goal

Add a minimal interactive terminal client for ai-workspace that posts streaming chat-completion requests, renders assistant output as it streams, and maintains conversation history in memory until the user clears it or exits.

## Constraints

- Keep the CLI dependency-free beyond the current Node.js runtime and project dependencies.
- Reuse the existing `/chat/completions` streaming contract rather than adding a CLI-specific server route.
- Keep history in process memory only.
- Preserve the repository's current TypeScript and comment-block conventions.

## Architecture Outline

```mermaid
flowchart LR
  User --> CLI
  CLI --> History[In-memory messages]
  CLI -->|POST stream=true| Server[/chat/completions]
  Server -->|SSE| CLI
  CLI --> Terminal
```

## Design Decisions

- Implement the CLI in TypeScript under `src/cli/` so the normal build produces a runnable compiled entrypoint.
- Use Node's `readline/promises` for interactive input instead of adding an external prompt library.
- Parse SSE frames in a small local helper tailored to the server's current `event:` and `data:` format.
- Track only chat messages needed for follow-up turns: user prompts and the final assistant response.
- Support a small command set such as clear and exit instead of building a richer shell.

## E2E Coverage Decision

Dedicated E2E coverage is not required. This story adds a local developer utility on top of the already tested HTTP/SSE endpoint, so focused unit coverage for CLI state and stream parsing plus the existing server-level tests are sufficient.

## Phased Tasks

- [x] Inspect relevant files
- [x] Make focused changes
- [x] Run validation
- [x] Update docs/status

## Implementation Steps

### Phase 1: CLI entrypoint

- Add a CLI module that opens an interactive prompt.
- Accept an optional base URL argument or environment override.
- Add a package script for launching the CLI in development.

### Phase 2: Streaming client behavior

- Build the request body from in-memory messages plus the new user turn.
- Send the request with `stream: true`.
- Parse SSE event frames from the response body.
- Render assistant deltas incrementally and finalize the turn on completion.

### Phase 3: History and commands

- Persist user and assistant messages in memory across turns.
- Add a command to clear history.
- Add a command to exit the CLI.
- Report request or stream errors without corrupting retained history.

### Phase 4: Validation and docs

- Add focused unit tests for stream parsing and history updates.
- Document CLI usage in the README.
- Run tests and build.

## Risks And Mitigations

- SSE parsing bugs could drop or duplicate text: mitigate with focused parser tests using multi-event streams.
- Partial assistant output on runtime error could produce confusing history: mitigate by storing assistant history only after a completed turn.
- Interactive CLI code can be awkward to test directly: mitigate by isolating pure helpers for request/history and stream handling.

## Status

- Initial plan created for RPD execution.
- Added `src/cli/testChatCli.ts` and `src/cli/streamingTestCli.ts` for an interactive streaming client.
- Added unit coverage for CLI option resolution, SSE parsing, stream assembly, and committed turn history.
- Added `npm run chat:cli` plus README instructions for local usage.
- Verified automated tests, TypeScript build, and a non-interactive CLI smoke test for `/clear` and `/exit`.