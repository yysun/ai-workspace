/*
 * Feature: OpenAI-style chat completion HTTP handlers with SSE and JSON modes.
 * Notes: validates request bodies, runs the shared runtime event stream, and maps outputs per response mode.
 * Recent changes: added multi-user support — extracts Bearer token, resolves user ID via AUTH_USER_URL, sets per-user workspace root, and injects access token into runtime env.
 */

import type { RequestHandler, Request } from "express";
import type { EnvConfig } from "../config/env.js";
import { resolveUserId, UserIdResolutionError } from "../auth/resolveUserId.js";
import { runChatCompletion } from "../runtime/runChatCompletion.js";
import type { ChatCompletionRequest, ChatMessage, RuntimeEvent } from "../runtime/runtimeTypes.js";
import { mapRuntimeEvent } from "../sse/mapRuntimeEvent.js";
import { writeSseHeaders, writeSseEvent, writeSseDone } from "../sse/writeSse.js";
import { resolveWorkspaceRoot } from "../workspace/resolveWorkspace.js";

type HttpError = Error & { statusCode?: number };

function createHttpError(message: string, statusCode: number): HttpError {
  const error = new Error(message) as HttpError;
  error.statusCode = statusCode;
  return error;
}

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer" || !parts[1]) {
    return null;
  }

  return parts[1];
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.role === "string" && typeof candidate.content === "string";
}

function parseRequestBody(body: unknown): ChatCompletionRequest {
  if (typeof body !== "object" || body === null) {
    throw createHttpError("Request body must be a JSON object", 400);
  }

  const candidate = body as Record<string, unknown>;
  if (!Array.isArray(candidate.messages) || candidate.messages.length === 0) {
    throw createHttpError("messages must be a non-empty array", 400);
  }

  if (!candidate.messages.every(isChatMessage)) {
    throw createHttpError("messages must contain role and content strings", 400);
  }

  return {
    model: typeof candidate.model === "string" ? candidate.model : undefined,
    messages: candidate.messages,
    stream: typeof candidate.stream === "boolean" ? candidate.stream : undefined,
    temperature: typeof candidate.temperature === "number" ? candidate.temperature : undefined,
    max_tokens: typeof candidate.max_tokens === "number" ? candidate.max_tokens : undefined,
    tools: Array.isArray(candidate.tools) ? candidate.tools : undefined,
    tool_choice: candidate.tool_choice,
    metadata: typeof candidate.metadata === "object" && candidate.metadata !== null
      ? (candidate.metadata as Record<string, unknown>)
      : undefined
  };
}

function aggregateResponse(model: string, events: RuntimeEvent[]) {
  let assistantContent = "";
  let finalContent: string | undefined;
  let errorMessage: string | undefined;
  const warnings: string[] = [];

  for (const event of events) {
    if (event.type === "message.delta") {
      assistantContent += event.text;
    }

    if (event.type === "message.done") {
      finalContent = event.message.content;
    }

    if (event.type === "error") {
      errorMessage = event.error;
    }

    if (event.type === "warning") {
      warnings.push(event.warning);
    }
  }

  const content = finalContent ?? (!errorMessage ? assistantContent : "");
  if (!content && errorMessage) {
    return {
      statusCode: 500,
      body: { error: errorMessage }
    };
  }

  return {
    statusCode: errorMessage ? 502 : 200,
    body: {
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      ...(warnings.length > 0 ? { warnings } : {}),
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content
          },
          finish_reason: errorMessage ? "error" : "stop"
        }
      ],
      runtime_events: events
    }
  };
}

export function createChatCompletionsHandler(env: EnvConfig): RequestHandler {
  return async (req, res, next) => {
    try {
      const token = extractBearerToken(req);
      if (!token) {
        res.status(401).json({ error: "Authorization: Bearer <token> header is required" });
        return;
      }

      if (!env.authUserUrl) {
        res.status(401).json({ error: "User identity service is not configured" });
        return;
      }

      let userId: string;
      try {
        userId = await resolveUserId(token, env.authUserUrl);
      } catch (error) {
        if (error instanceof UserIdResolutionError) {
          res.status(401).json({ error: "Unauthorized" });
          return;
        }
        throw error;
      }

      const chatRequest = parseRequestBody(req.body);
      const abortController = new AbortController();
      const sanitizedUserId = userId.replace(/[/\\.\0]/g, "_");
      const workspaceRoot = `${resolveWorkspaceRoot(env.workspaceRoot)}/${sanitizedUserId}`;

      req.on("aborted", () => {
        abortController.abort();
      });

      res.on("close", () => {
        if (!res.writableEnded) {
          abortController.abort();
        }
      });

      const runtimeInput = {
        model: chatRequest.model,
        messages: chatRequest.messages,
        stream: chatRequest.stream === true,
        temperature: chatRequest.temperature,
        maxTokens: chatRequest.max_tokens,
        metadata: chatRequest.metadata,
        workspaceRoot,
        accessToken: token,
        signal: abortController.signal
      };

      if (chatRequest.stream === true) {
        writeSseHeaders(res);

        for await (const event of runChatCompletion(runtimeInput, env)) {
          writeSseEvent(res, mapRuntimeEvent(event));
        }

        writeSseDone(res);
        return;
      }

      const events: RuntimeEvent[] = [];
      for await (const event of runChatCompletion(runtimeInput, env)) {
        events.push(event);
      }

      const response = aggregateResponse(chatRequest.model ?? "default", events);
      res.status(response.statusCode).json(response.body);
    } catch (error) {
      next(error);
    }
  };
}