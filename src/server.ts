/*
 * Feature: Express server assembly for ai-workspace routes and middleware.
 * Notes: wires JSON parsing, placeholder auth, health, chat, and terminal error handling.
 * Recent changes: initial scaffold implementation.
 */

import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { createHealthHandler } from "./routes/health.js";
import { createChatCompletionsHandler } from "./routes/chatCompletions.js";
import { verifyRequest } from "./auth/verifyRequest.js";
import type { EnvConfig } from "./config/env.js";

export function createServer(env: EnvConfig): Express {
  const app = express();
  const chatHandler = createChatCompletionsHandler(env);

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(verifyRequest(env));

  app.get("/health", createHealthHandler(env));
  app.post("/chat/completions", chatHandler);
  app.post("/chat", chatHandler);

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : "Internal server error";
    const statusCode = typeof error === "object" && error !== null && "statusCode" in error
      ? Number((error as { statusCode?: number }).statusCode) || 500
      : 500;

    res.status(statusCode).json({ error: message });
  });

  return app;
}