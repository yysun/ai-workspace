/*
 * Feature: shared runtime and API types for ai-workspace chat execution.
 * Notes: defines request and event contracts for the server-owned HTTP layer around llm-runtime.
 * Recent changes: replaced the mock runtime/tool abstractions with llm-runtime-backed execution types.
 */

import type { LLMProviderName } from "llm-runtime";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ChatMessage = {
  role: ChatRole;
  content: string;
  name?: string;
  tool_call_id?: string;
};

export type ChatCompletionRequest = {
  model?: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  tools?: unknown[];
  tool_choice?: unknown;
  metadata?: Record<string, unknown>;
};

export type RunChatCompletionInput = {
  model?: string;
  messages: ChatMessage[];
  stream: boolean;
  temperature?: number;
  maxTokens?: number;
  metadata?: Record<string, unknown>;
  workspaceRoot: string;
  signal?: AbortSignal;
};

export type RuntimeEvent =
  | { type: "message.delta"; text: string }
  | { type: "message.done"; message: { role: "assistant"; content: string } }
  | { type: "tool.call"; name: string; args: unknown }
  | { type: "tool.result"; name: string; result: unknown }
  | { type: "warning"; warning: string; code: "assistant_claimed_progress_without_tool_activity" }
  | { type: "error"; error: string };

export type ResolvedRuntimeTarget = {
  provider: LLMProviderName;
  model: string;
};