/*
 * Feature: unit coverage for workspace-configured API tool execution.
 * Notes: verifies config detection, request guards, auth attachment, and response shaping without live network calls.
 * Recent changes: added coverage for file-backed response persistence, relative output-path validation, and symlink escape rejection.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApiRequestTool, resolveApiRequestUrl, resolveApiToolConfig } from "../../src/tools/apiRequestTool.js";

async function withTempDir(run: (tempDir: string) => Promise<void>): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ai-workspace-api-tool-"));
  try {
    await run(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

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

test("api_request requires host-provided userId when configured", () => {
  assert.throws(
    () => createApiRequestTool({
      envSource: {
        API_BASE_URL: "https://api.example.test/v1"
      }
    }),
    /api_request requires userId/
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
    userId: "user-7",
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

test("api_request saves the raw response body to outputFilePath when requested", async () => {
  await withTempDir(async (tempDir) => {
    const tool = createApiRequestTool({
      envSource: {
        API_BASE_URL: "https://api.example.test/v1"
      },
      workspaceRoot: tempDir,
      userId: "user-7",
      fetchImpl: async () => new Response(JSON.stringify({ huge: true, note: "saved" }), {
        status: 200,
        statusText: "OK",
        headers: {
          "content-type": "application/json"
        }
      })
    });

    const result = await tool?.execute?.({
      method: "GET",
      path: "/notes",
      outputFilePath: "users/user-7/data/api-responses/notes.json"
    }, {});

    assert.deepEqual(result, {
      ok: true,
      status: 200,
      statusText: "OK",
      url: "https://api.example.test/v1/notes",
      headers: {
        "content-type": "application/json"
      },
      bodySaved: true,
      bodyFilePath: "users/user-7/data/api-responses/notes.json",
      bodyBytes: Buffer.byteLength(JSON.stringify({ huge: true, note: "saved" }), "utf8")
    });

    const savedBody = await readFile(path.join(tempDir, "users/user-7/data/api-responses/notes.json"), "utf8");
    assert.equal(savedBody, JSON.stringify({ huge: true, note: "saved" }));
  });
});

test("api_request rejects absolute outputFilePath values", async () => {
  await withTempDir(async (tempDir) => {
    const tool = createApiRequestTool({
      envSource: {
        API_BASE_URL: "https://api.example.test/v1"
      },
      workspaceRoot: tempDir,
      userId: "user-7",
      fetchImpl: async () => new Response(JSON.stringify({ huge: true, note: "saved" }), {
        status: 200,
        statusText: "OK",
        headers: {
          "content-type": "application/json"
        }
      })
    });

    await assert.rejects(
      async () => await tool?.execute?.({
        method: "GET",
        path: "/notes",
        outputFilePath: path.join(tempDir, "users/user-7/data/api-responses/notes.json")
      }, {}),
      /api_request outputFilePath must be relative to the workspace root/
    );
  });
});

test("api_request rejects symlinked directory escapes for outputFilePath", async () => {
  await withTempDir(async (tempDir) => {
    const outsideDir = await mkdtemp(path.join(os.tmpdir(), "ai-workspace-api-tool-outside-"));

    try {
      const symlinkPath = path.join(tempDir, "linked-output");
      await mkdir(outsideDir, { recursive: true });
      await symlink(outsideDir, symlinkPath, "dir");

      const tool = createApiRequestTool({
        envSource: {
          API_BASE_URL: "https://api.example.test/v1"
        },
        workspaceRoot: tempDir,
        userId: "user-7",
        fetchImpl: async () => new Response(JSON.stringify({ huge: true, note: "saved" }), {
          status: 200,
          statusText: "OK",
          headers: {
            "content-type": "application/json"
          }
        })
      });

      await assert.rejects(
        async () => await tool?.execute?.({
          method: "GET",
          path: "/notes",
          outputFilePath: "linked-output/notes.json"
        }, {}),
        /api_request outputFilePath must stay within users\/user-7\/data\/api-responses/
      );
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });
});

test("api_request rejects outputFilePath outside the tool-owned api-responses directory", async () => {
  await withTempDir(async (tempDir) => {
    const tool = createApiRequestTool({
      envSource: {
        API_BASE_URL: "https://api.example.test/v1"
      },
      workspaceRoot: tempDir,
      userId: "user-7",
      fetchImpl: async () => new Response(JSON.stringify({ huge: true, note: "saved" }), {
        status: 200,
        statusText: "OK",
        headers: {
          "content-type": "application/json"
        }
      })
    });

    await assert.rejects(
      async () => await tool?.execute?.({
        method: "GET",
        path: "/notes",
        outputFilePath: "AGENTS.md"
      }, {}),
      /api_request outputFilePath must stay within users\/user-7\/data\/api-responses/
    );
  });
});

test("api_request automatically spills oversized responses to a user-scoped file", async () => {
  await withTempDir(async (tempDir) => {
    const largeBody = JSON.stringify({ payload: "x".repeat(128) });
    const tool = createApiRequestTool({
      envSource: {
        API_BASE_URL: "https://api.example.test/v1"
      },
      workspaceRoot: tempDir,
      userId: "tenant/user.9",
      inlineBodyByteLimit: 32,
      fetchImpl: async () => new Response(largeBody, {
        status: 200,
        statusText: "OK",
        headers: {
          "content-type": "application/json"
        }
      })
    });

    const result = await tool?.execute?.({
      method: "GET",
      path: "/notes"
    }, {});

    assert.equal(typeof result, "object");
    assert.ok(result);

    const typedResult = result as {
      bodySaved: boolean;
      bodyFilePath: string;
      bodyBytes: number;
      body?: unknown;
    };

    assert.equal(typedResult.bodySaved, true);
    assert.equal(typedResult.bodyBytes, Buffer.byteLength(largeBody, "utf8"));
    assert.match(typedResult.bodyFilePath, /^users\/tenant_user_9\/data\/api-responses\/api-response-.+\.json$/);
    assert.equal("body" in typedResult, false);

    const savedBody = await readFile(path.join(tempDir, typedResult.bodyFilePath), "utf8");
    assert.equal(savedBody, largeBody);
  });
});
