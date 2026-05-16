# REQ: Multi-User Support in Chat Endpoint

**Story**: `multi-user-chat`  
**Date**: 2026/05/16

## Overview

The chat completion endpoint must support multiple users by resolving per-user workspace paths at request time.

## Requirements

### R1 – Access Token Extraction
The chat endpoint must extract a Bearer access token from the `Authorization` request header.  
If the header is absent or malformed (not `Bearer <token>`), the request must be rejected with HTTP 401.

### R2 – User ID Resolution
The server must call a configurable user-identity API to exchange the access token for a user ID.  
The API URL is configured via the `AUTH_USER_URL` environment variable in the server's `.env`.  
The endpoint is called with the access token as a `Bearer` token in the `Authorization` header.  
The resolved user ID must be a non-empty string; any error or empty result must return HTTP 401.

### R3 – Per-User Workspace Root
The runtime workspace root for each request must be set to `{WORKSPACE_ROOT}/{user-id}`.  
`WORKSPACE_ROOT` is the server-level configuration value (already present); `user-id` is the value from R2.

### R4 – Access Token in Runtime Environment
The access token must be injected into the per-request runtime environment as `API_ACCESS_TOKEN`  
so that the `api_request` tool can forward it in outbound API calls on behalf of the user.

## Acceptance Criteria

- Requests without an `Authorization: Bearer <token>` header receive HTTP 401.
- Requests with an invalid or unresolvable token receive HTTP 401.
- A resolved user ID causes `workspaceRoot` to be `<WORKSPACE_ROOT>/<user-id>`.
- The access token is available as `API_ACCESS_TOKEN` in the runtime env during request execution.
- `AUTH_USER_URL` not set: the server still starts; the user-ID resolution step is skipped and requests are rejected with 401 when a token is provided but no URL is configured.

## Out of Scope

- Token validation / signature verification (delegated to the user-identity API).
- Session management and token refresh.
- Multi-agent orchestration and cross-user data sharing.
