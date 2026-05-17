/*
 * Feature: targeted integration coverage for the workspace API request tool.
 * Notes: exercises the real fetch path against a local HTTP server rather than a stubbed fetch implementation.
 * Recent changes: added local-server coverage for host-owned auth headers, base-path resolution, and JSON response parsing.
 */

import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createApiRequestTool } from "../../src/tools/apiRequestTool.js";

type CapturedRequest = {
  method: string;
  url: string;
  authorization: string | undefined;
  securityContext: string | undefined;
  clientHeader: string | undefined;
  body: string;
};

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

test("api_request reaches a local HTTP server with host-owned auth and base-path scoping", async () => {
  let capturedRequest: CapturedRequest | null = null;

  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    capturedRequest = {
      method: request.method ?? "",
      url: request.url ?? "",
      authorization: request.headers.authorization,
      securityContext: typeof request.headers["x-security-context"] === "string"
        ? request.headers["x-security-context"]
        : undefined,
      clientHeader: typeof request.headers["x-client"] === "string"
        ? request.headers["x-client"]
        : undefined,
      body: await readBody(request)
    };

    response.statusCode = 200;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({
      ok: true,
      echoedPath: request.url,
      clientHeader: request.headers["x-client"]
    }));
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = (address as AddressInfo).port;

  try {
    const tool = createApiRequestTool({
      envSource: {
        API_BASE_URL: `http://127.0.0.1:${port}/v1`,
        API_ACCESS_TOKEN: "workspace-token",
        API_SECURITY_CONTEXT: "tenant-42"
      },
      userId: "user-7"
    });

    assert.ok(tool?.execute);

    const result = await tool.execute?.({
      method: "POST",
      path: "/records",
      query: {
        page: 2,
        includeDrafts: false
      },
      headers: {
        Authorization: "Bearer model-token",
        "Content-Type": "application/json",
        "X-Client": "targeted-test"
      },
      body: {
        name: "Ada"
      }
    }, {});

    assert.deepEqual(capturedRequest, {
      method: "POST",
      url: "/v1/records?page=2&includeDrafts=false",
      authorization: "Bearer workspace-token",
      securityContext: "tenant-42",
      clientHeader: "targeted-test",
      body: JSON.stringify({ name: "Ada" })
    });

    const typedResult = result as {
      ok: boolean;
      status: number;
      statusText: string;
      url: string;
      headers: Record<string, string>;
      body: unknown;
    };

    assert.equal(typedResult.ok, true);
    assert.equal(typedResult.status, 200);
    assert.equal(typedResult.statusText, "OK");
    assert.equal(typedResult.url, `http://127.0.0.1:${port}/v1/records?page=2&includeDrafts=false`);
    assert.deepEqual(typedResult.body, {
      ok: true,
      echoedPath: "/v1/records?page=2&includeDrafts=false",
      clientHeader: "targeted-test"
    });

    const responseHeaders = typedResult.headers;
    assert.equal(responseHeaders["content-type"], "application/json");
    assert.match(responseHeaders.date ?? "", /.+/);
  } finally {
    await closeServer(server);
  }
});
