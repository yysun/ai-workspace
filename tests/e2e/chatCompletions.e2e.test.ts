/*
 * Feature: end-to-end coverage for the chat completions HTTP route.
 * Notes: verifies valid non-stream requests reach runtime execution and return a 5xx runtime error when no provider credentials are configured.
 * Recent changes: added regression coverage for a request that previously surfaced as 400.
 */

import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createServer } from "../../src/server.js";
import type { EnvConfig } from "../../src/config/env.js";

const envWithoutProviderCredentials: EnvConfig = {
  port: 0,
  workspaceRoot: new URL("../../workspace", import.meta.url).pathname,
  llmPermission: "auto",
  llmReasoning: "medium"
};

type LoggedError = [message: string, details: Record<string, unknown>];

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

async function startServer(): Promise<{ server: Server; baseUrl: string }> {
  const app = createServer(envWithoutProviderCredentials);
  const server = app.listen(0, "127.0.0.1");

  await once(server, "listening");

  const address = server.address();
  assert.ok(address && typeof address !== "string", "server should listen on an ephemeral TCP port");

  return {
    server,
    baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}`
  };
}

async function withCapturedConsoleError<T>(run: (loggedErrors: LoggedError[]) => Promise<T>): Promise<T> {
  const loggedErrors: LoggedError[] = [];
  const originalConsoleError = console.error;

  console.error = ((message: string, details: Record<string, unknown>) => {
    loggedErrors.push([message, details]);
  }) as typeof console.error;

  try {
    return await run(loggedErrors);
  } finally {
    console.error = originalConsoleError;
  }
}

test("POST /chat/completions returns a runtime 5xx instead of 400 for a valid non-stream request", async () => {
  const { server, baseUrl } = await startServer();

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "default",
        stream: false,
        messages: [
          {
            role: "user",
            content: "Summarize the loaded workspace context."
          }
        ]
      })
    });

    const payload = await response.json() as { error?: unknown };

    assert.equal(response.status, 500);
    assert.equal(typeof payload.error, "string");
    assert.match(String(payload.error), /No configuration found for openai provider/i);
  } finally {
    await closeServer(server);
  }
});

test("POST /chat/completions returns 400 and logs a body preview for malformed JSON", { concurrency: false }, async () => {
  await withCapturedConsoleError(async (loggedErrors) => {
    const { server, baseUrl } = await startServer();

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: "{\"model\":\"default\",\"stream\":false,\"messages\":["
      });

      const payload = await response.json() as { error?: unknown };

      assert.equal(response.status, 400);
      assert.equal(payload.error, "Unexpected end of JSON input");
      assert.equal(loggedErrors.length, 1);
      assert.equal(loggedErrors[0]?.[0], "request failed");
      assert.deepEqual(loggedErrors[0]?.[1], {
        statusCode: 400,
        method: "POST",
        path: "/chat/completions",
        contentType: "application/json",
        errorType: "entity.parse.failed",
        message: "Unexpected end of JSON input",
        bodyPreview: "{\"model\":\"default\",\"stream\":false,\"messages\":["
      });
    } finally {
      await closeServer(server);
    }
  });
});

test("POST /chat/completions streams runtime errors over SSE when provider configuration is missing", async () => {
  const { server, baseUrl } = await startServer();

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "default",
        stream: true,
        messages: [
          {
            role: "user",
            content: "hello"
          }
        ]
      })
    });

    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/event-stream/i);
    assert.match(body, /event: error/);
    assert.match(body, /No configuration found for openai provider/i);
    assert.match(body, /event: done/);
  } finally {
    await closeServer(server);
  }
});