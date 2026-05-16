# Requirement: llm-api-tool

## Story

Add a runtime-registered API tool that lets the LLM call external HTTP APIs using workspace-scoped configuration for security context, base URL, and access token.

Story slug: `llm-api-tool`

## Problem Statement

The runtime currently loads workspace-local environment variables before each chat request, but it does not expose a dedicated API-calling tool to the LLM. That prevents workspace agents from invoking external services through a controlled host surface and forces API access logic to be improvised through less-specific tools. The server needs a first-class API tool that is available whenever the runtime is created and that uses the workspace's security and endpoint configuration consistently.

## Scope

The delivered change must provide:

- A tool that is registered during per-request LLM runtime creation.
- Access to workspace-root environment configuration for API base URL, access token, and related security context.
- A constrained API invocation surface that the LLM can use to perform outbound HTTP requests.
- Clear tool inputs and outputs so the LLM can inspect response status and body content.
- Focused documentation and automated coverage for configuration loading and request behavior.

## Non-Goals

The change must not introduce:

- Arbitrary unrestricted network access beyond the configured API surface.
- Hard-coded service credentials in source control.
- Persistent credential storage outside the existing workspace environment model.
- A replacement for existing built-in tools unrelated to API access.
- Provider-specific prompt logic that assumes one particular downstream API.

## Functional Requirements

The runtime integration must:

1. Register the API tool as part of runtime creation for each chat request.
2. Load the tool's configuration from the active workspace root environment before tool execution.
3. Allow the LLM to target API routes relative to a configured base URL instead of requiring full arbitrary URLs.
4. Attach the configured access token and other required security context to outbound requests without requiring the model to supply raw secrets.
5. Support the HTTP method, path, headers, query parameters, and request body fields required by the configured API surface.
6. Return a structured result that includes at least response status, response headers when safe, and parsed or raw response body content.
7. Surface configuration or request failures as clear tool errors that the runtime can relay back to the model.
8. Prevent accidental disclosure of configured secrets in emitted tool-call or tool-result events.

## Security Requirements

The API tool must:

- Keep bearer tokens, API keys, and similar credentials outside model-authored arguments.
- Redact configured secret values from observable runtime events and logs.
- Fail closed when required API configuration is missing or incomplete.
- Restrict requests to the configured base URL and reject attempts to escape that boundary.

## Usability Requirements

The tool should:

- Use a schema the LLM can call predictably.
- Provide error messages that help the model recover from bad paths, bad methods, or missing configuration.
- Keep configuration naming consistent with the existing workspace environment model.

## Verification Requirements

The implementation must be covered by:

- Automated tests for loading API tool configuration from the workspace environment.
- Automated tests for request construction, auth attachment, and base-URL restriction behavior.
- Automated tests for secret redaction in observable tool events.
- A TypeScript build or equivalent compile validation for the runtime integration.