/*
 * Feature: unit tests for resolveUserId and extractBearerToken for multi-user chat support.
 * Notes: uses a local HTTP server to test resolveUserId without mocking fetch; tests bearer token extraction logic inline.
 * Recent changes: initial implementation for multi-user chat support.
 */

import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { resolveUserId, UserIdResolutionError } from "../../src/auth/resolveUserId.js";

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

function startServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void
): Promise<{ server: Server; url: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
    server.once("error", reject);
  });
}

test("resolveUserId returns id from JSON response", async () => {
  const { server, url } = await startServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "user-42" }));
  });

  try {
    const userId = await resolveUserId("mytoken", url);
    assert.equal(userId, "user-42");
  } finally {
    await closeServer(server);
  }
});

test("resolveUserId forwards Bearer token in Authorization header", async () => {
  let capturedAuth: string | undefined;

  const { server, url } = await startServer((req, res) => {
    capturedAuth = req.headers.authorization;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "user-99" }));
  });

  try {
    await resolveUserId("secret-token", url);
    assert.equal(capturedAuth, "Bearer secret-token");
  } finally {
    await closeServer(server);
  }
});

test("resolveUserId throws UserIdResolutionError on non-2xx response", async () => {
  const { server, url } = await startServer((_req, res) => {
    res.writeHead(401);
    res.end();
  });

  try {
    await assert.rejects(
      () => resolveUserId("bad-token", url),
      (err) => err instanceof UserIdResolutionError
    );
  } finally {
    await closeServer(server);
  }
});

test("resolveUserId throws UserIdResolutionError on non-JSON response", async () => {
  const { server, url } = await startServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("not-json");
  });

  try {
    await assert.rejects(
      () => resolveUserId("token", url),
      (err) => err instanceof UserIdResolutionError
    );
  } finally {
    await closeServer(server);
  }
});

test("resolveUserId throws UserIdResolutionError when id field is missing", async () => {
  const { server, url } = await startServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ user: "someone" }));
  });

  try {
    await assert.rejects(
      () => resolveUserId("token", url),
      (err) => err instanceof UserIdResolutionError
    );
  } finally {
    await closeServer(server);
  }
});

test("resolveUserId throws UserIdResolutionError when id is empty string", async () => {
  const { server, url } = await startServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: "" }));
  });

  try {
    await assert.rejects(
      () => resolveUserId("token", url),
      (err) => err instanceof UserIdResolutionError
    );
  } finally {
    await closeServer(server);
  }
});

test("resolveUserId throws UserIdResolutionError on network error", async () => {
  await assert.rejects(
    () => resolveUserId("token", "http://127.0.0.1:1"),
    (err) => err instanceof UserIdResolutionError
  );
});

test("resolveUserId returns id from { id: number } format", async () => {
  const { server, url } = await startServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: 42 }));
  });

  try {
    const userId = await resolveUserId("mytoken", url);
    assert.equal(userId, "42");
  } finally {
    await closeServer(server);
  }
});

test("resolveUserId returns userId from { userId: number } format", async () => {
  const { server, url } = await startServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ userId: 7 }));
  });

  try {
    const userId = await resolveUserId("mytoken", url);
    assert.equal(userId, "7");
  } finally {
    await closeServer(server);
  }
});

test("resolveUserId returns userId from { userId: string } format", async () => {
  const { server, url } = await startServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ userId: "user-5" }));
  });

  try {
    const userId = await resolveUserId("mytoken", url);
    assert.equal(userId, "user-5");
  } finally {
    await closeServer(server);
  }
});

test("resolveUserId returns userId from array format [{ userId: number }]", async () => {
  const { server, url } = await startServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify([{ userId: 3 }]));
  });

  try {
    const userId = await resolveUserId("mytoken", url);
    assert.equal(userId, "3");
  } finally {
    await closeServer(server);
  }
});

test("resolveUserId returns userId from array format [{ userId: string }]", async () => {
  const { server, url } = await startServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify([{ userId: "user-7" }]));
  });

  try {
    const userId = await resolveUserId("mytoken", url);
    assert.equal(userId, "user-7");
  } finally {
    await closeServer(server);
  }
});

test("resolveUserId throws UserIdResolutionError when array has no userId", async () => {
  const { server, url } = await startServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify([{ name: "someone" }]));
  });

  try {
    await assert.rejects(
      () => resolveUserId("token", url),
      (err) => err instanceof UserIdResolutionError
    );
  } finally {
    await closeServer(server);
  }
});

test("resolveUserId throws UserIdResolutionError when array is empty", async () => {
  const { server, url } = await startServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify([]));
  });

  try {
    await assert.rejects(
      () => resolveUserId("token", url),
      (err) => err instanceof UserIdResolutionError
    );
  } finally {
    await closeServer(server);
  }
});
