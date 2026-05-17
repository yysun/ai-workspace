/*
 * Feature: Express server assembly for ai-workspace routes and middleware.
 * Notes: wires JSON parsing, placeholder auth, health, chat, and terminal error handling.
 * Recent changes: initial scaffold implementation.
 */

import { inspect } from "node:util";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { createHealthHandler } from "./routes/health.js";
import { createChatCompletionsHandler } from "./routes/chatCompletions.js";
import { verifyRequest } from "./auth/verifyRequest.js";
import type { EnvConfig } from "./config/env.js";
import { loadAgentsMdCache } from "./workspace/loadAgentsMd.js";
import { resolveWorkspaceRoot } from "./workspace/resolveWorkspace.js";

const BODY_PREVIEW_LIMIT = 800;

function truncate(value: string, limit = BODY_PREVIEW_LIMIT): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}...`;
}

function formatBodyPreview(body: unknown): string | undefined {
  if (body === undefined) {
    return undefined;
  }

  if (typeof body === "string") {
    return truncate(body);
  }

  if (Buffer.isBuffer(body)) {
    return truncate(body.toString("utf8"));
  }

  try {
    return truncate(JSON.stringify(body));
  } catch {
    return truncate(inspect(body, { depth: 3, breakLength: 120 }));
  }
}

function resolveErrorStatusCode(error: unknown): number {
  if (typeof error !== "object" || error === null) {
    return 500;
  }

  const candidate = error as { statusCode?: number; status?: number };
  return Number(candidate.statusCode ?? candidate.status) || 500;
}

function logRequestError(req: Request, error: unknown, statusCode: number): void {
  const errorType = typeof error === "object" && error !== null && "type" in error
    ? String((error as { type?: unknown }).type)
    : undefined;
  const parserBody = typeof error === "object" && error !== null && "body" in error
    ? formatBodyPreview((error as { body?: unknown }).body)
    : undefined;
  const requestBody = parserBody === undefined ? formatBodyPreview(req.body) : undefined;
  const message = error instanceof Error ? error.message : "Internal server error";
  const bodyPreview = statusCode === 400 ? (parserBody ?? requestBody) : undefined;

  console.error("request failed", {
    statusCode,
    method: req.method,
    path: req.originalUrl,
    contentType: req.get("content-type"),
    errorType,
    message,
    ...(bodyPreview === undefined ? {} : { bodyPreview })
  });
}

export function createServer(env: EnvConfig): Express {
  const app = express();
  const workspaceRoot = resolveWorkspaceRoot(env.workspaceRoot);
  const agentsMdCachePromise = loadAgentsMdCache(workspaceRoot).then((loaded) => {
    console.log(`[workspace] AGENTS.md path: ${loaded.path}${loaded.content === null ? " (missing)" : ""}`);
    return loaded;
  });
  const chatHandler = createChatCompletionsHandler(env, agentsMdCachePromise);

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(verifyRequest(env));

  app.get("/health", createHealthHandler(env));
  app.post("/chat/completions", chatHandler);
  app.post("/chat", chatHandler);

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : "Internal server error";
    const statusCode = resolveErrorStatusCode(error);

    logRequestError(_req, error, statusCode);

    res.status(statusCode).json({ error: message });
  });

  return app;
}