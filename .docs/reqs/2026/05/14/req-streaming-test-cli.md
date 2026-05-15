# Requirement: streaming-test-cli

## Story

Create a local test CLI that sends chat messages to the ai-workspace server, prints streamed results live, and keeps conversation history in memory across turns.

Story slug: `streaming-test-cli`

## Problem Statement

The repository currently exposes HTTP and SSE endpoints plus manual `.http` request files, but it does not provide a lightweight interactive client for exercising the streaming chat path repeatedly from a terminal. That makes it slower to test prompt behavior, workspace instructions, and end-to-end streaming output because each turn must be reconstructed manually. A local CLI should provide a tighter feedback loop while remaining a thin test client rather than a production chat shell.

## Scope

The delivered change must provide:

- A terminal CLI entrypoint for sending chat messages to the local ai-workspace server.
- Streaming output display while the server emits SSE events.
- In-memory conversation history that persists for the lifetime of the CLI process.
- A simple way to start a new conversation without restarting the process.
- Clear local usage documentation.

## Non-Goals

The change must not introduce:

- Persistent chat history on disk.
- Authentication, account, or session management.
- A TUI framework or complex terminal rendering layer.
- Server-side changes to make the CLI work unless a small compatibility fix is truly required.
- A replacement for the existing HTTP tests.

## Functional Requirements

The CLI must:

1. Accept a server base URL, defaulting to the local ai-workspace server address when omitted.
2. Send requests to `POST /chat/completions` with `stream: true`.
3. Preserve prior user and assistant messages in memory and include them in subsequent requests.
4. Print streamed assistant text incrementally as SSE `message.delta` events arrive.
5. Complete the assistant turn when the runtime emits the final completion event or stream terminator.
6. Add the completed assistant message into in-memory history so the next turn has full context.
7. Allow the user to exit the CLI cleanly.
8. Allow the user to clear the in-memory message history without restarting the process.

## Usability Requirements

The CLI should:

- Use plain Node.js terminal input and output without extra dependencies unless clearly justified.
- Keep the command surface small and easy to remember.
- Surface runtime or transport errors clearly when the server returns an error event or non-success HTTP response.
- Avoid printing raw SSE framing lines to the user.

## Verification Requirements

The implementation must be covered by:

- Automated tests for the CLI message-history and stream-assembly logic where feasible.
- A build that compiles the new CLI entrypoint.
- Documentation that shows how to run the CLI against a local server.