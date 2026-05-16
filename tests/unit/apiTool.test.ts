/*
 * Feature: unit coverage for workspace-configured API tool execution.
 * Notes: verifies config detection, request guards, auth attachment, and response shaping without live network calls.
 * Recent changes: initial coverage for the api_request runtime tool.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createApiRequestTool, resolveApiRequestUrl, resolveApiToolConfig } from "../../src/tools/apiRequestTool.js";

test("resolveApiToolConfig returns null when API_BASE_URL is missing", () => {
  assert.equal(resolveApiToolConfig({}), null);
  assert.equal(createApiRequestTool({ envSource: {} }), null);
});

test("resolveApiRequestUrl rejects base-path escapes", () => {
  assert.throws(
    () => resolveApiRequestUrl(new URL("https://api.example.test/v1/"), "../admin", undefined),
    /configured API base path/
  );
});

test("api_request applies auth headers, query params, and parses JSON responses", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;

  const tool = createApiRequestTool({
    envSource: {
      API_BASE_URL: "https://api.example.test/v1",
      API_ACCESS_TOKEN: "workspace-token",
      API_SECURITY_CONTEXT: "tenant-123"
    },
    fetchImpl: async (input, init) => {
      capturedUrl = input instanceof URL ? input.toString() : String(input);
      capturedInit = init;

      return new Response(JSON.stringify({ recordId: "rec_123", ok: true }), {
        status: 201,
        statusText: "Created",
        headers: {
          "content-type": "application/json",
          "set-cookie": "session=secret",
          "x-trace-id": "trace-1"
        }
      });
    }
  });

  assert.ok(tool?.execute);

  const result = await tool.execute?.({
    method: "post",
    path: "/records",
    query: {
      expand: ["owner", 2],
      enabled: true,
      ignored: null
    },
    headers: {
      Authorization: "Bearer model-token",
      "Content-Type": "application/json",
      "X-Client": "ai-workspace-test"
    },
    body: {
      name: "Ada"
    }
  }, {});

  assert.equal(capturedUrl, "https://api.example.test/v1/records?expand=owner&expand=2&enabled=true");

  const requestHeaders = new Headers(capturedInit?.headers);
  assert.equal(capturedInit?.method, "POST");
  assert.equal(requestHeaders.get("authorization"), "Bearer workspace-token");
  assert.equal(requestHeaders.get("x-security-context"), "tenant-123");
  assert.equal(requestHeaders.get("x-client"), "ai-workspace-test");
  assert.equal(requestHeaders.get("content-type"), "application/json");
  assert.equal(capturedInit?.body, JSON.stringify({ name: "Ada" }));

  assert.deepEqual(result, {
    ok: true,
    status: 201,
    statusText: "Created",
    url: "https://api.example.test/v1/records?expand=owner&expand=2&enabled=true",
    headers: {
      "content-type": "application/json",
      "x-trace-id": "trace-1"
    },
    body: {
      recordId: "rec_123",
      ok: true
    }
  });
});