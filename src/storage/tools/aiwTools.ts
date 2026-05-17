import type { LLMToolDefinition } from "llm-runtime";
import { ZodError, type ZodType } from "zod";
import { AiwError, type WorkspaceProvider } from "../types.js";
import { createContentSchema, deleteContentSchema, listContentSchema, readContentSchema, resolveObjectSchema, searchContentSchema, writeContentSchema } from "./schemas.js";

export interface AiwToolDefinition<TResult = unknown> extends LLMToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(input: Record<string, unknown>): Promise<AiwToolResult<TResult>>;
}

export interface AiwToolResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export function createAiwTools(provider: WorkspaceProvider): AiwToolDefinition[] {
  return [
    {
      name: "resolve_object",
      description: "Resolve a business object by name, alias, or ID. Returns canonical path and layer paths by default.",
      evidenceKind: "read",
      parameters: jsonSchema({ query: "string", objectType: "string?", limit: "number?" }),
      execute: wrap(resolveObjectSchema, (input) => provider.resolveObject(input))
    },
    {
      name: "search_content",
      description: "Search AIW path-addressable content by keyword, object, layer, prefix, or topic.",
      evidenceKind: "read",
      parameters: jsonSchema({ query: "string", pathPrefix: "string?", objectType: "string?", objectId: "string?", layer: "string?", limit: "number?" }),
      execute: wrap(searchContentSchema, (input) => provider.searchContent(input))
    },
    {
      name: "list_content",
      description: "List content paths under a workspace path prefix.",
      evidenceKind: "read",
      parameters: jsonSchema({ path: "string", limit: "number?" }),
      execute: wrap(listContentSchema, (input) => provider.listContent(input))
    },
    {
      name: "read_content",
      description: "Read full content at an exact AIW path. Binary payloads are returned as base64 with their MIME type and contentEncoding.",
      evidenceKind: "read",
      parameters: jsonSchema({ path: "string" }),
      execute: wrap(readContentSchema, (input) => provider.readContent(input))
    },
    {
      name: "write_content",
      description: "Create or replace content at an exact AIW path. When contentEncoding is omitted, common binary and text file types are inferred from the path extension or MIME type.",
      evidenceKind: "write",
      parameters: jsonSchema({ path: "string", content: "string", contentType: "string?", contentEncoding: "string?", metadata: "object?" }),
      execute: wrap(writeContentSchema, (input) => provider.writeContent(input))
    },
    {
      name: "create_content",
      description: "Create new content only if the path does not already exist. When contentEncoding is omitted, common binary and text file types are inferred from the path extension or MIME type.",
      evidenceKind: "write",
      parameters: jsonSchema({ path: "string", content: "string", contentType: "string?", contentEncoding: "string?", metadata: "object?" }),
      execute: wrap(createContentSchema, (input) => provider.createContent(input))
    },
    {
      name: "delete_content",
      description: "Delete or soft-delete content at an exact AIW path.",
      evidenceKind: "write",
      parameters: jsonSchema({ path: "string", reason: "string?" }),
      execute: wrap(deleteContentSchema, (input) => provider.deleteContent(input))
    }
  ];
}

export function getToolMap(provider: WorkspaceProvider): Record<string, (input: unknown) => Promise<AiwToolResult>> {
  return Object.fromEntries(
    createAiwTools(provider).map((tool) => [
      tool.name,
      async (input: unknown) => await tool.execute(asToolArgs(input))
    ])
  );
}

function wrap<TInput, TResult>(schema: ZodType<TInput>, fn: (input: TInput) => Promise<TResult>) {
  return async (raw: Record<string, unknown>): Promise<AiwToolResult<TResult>> => {
    try {
      const input = schema.parse(raw);
      const data = await fn(input);
      return { ok: true, data };
    } catch (error) {
      if (error instanceof ZodError) {
        return { ok: false, error: { code: "INVALID_INPUT", message: error.message } };
      }
      if (error instanceof AiwError) {
        return { ok: false, error: { code: error.code, message: error.message, details: error.details } };
      }
      return {
        ok: false,
        error: {
          code: "BACKEND_ERROR",
          message: error instanceof Error ? error.message : String(error)
        }
      };
    }
  };
}

function asToolArgs(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
}

function jsonSchema(shape: Record<string, string>): Record<string, unknown> {
  // Lightweight schema metadata for custom tool registries. If your LLM runtime
  // expects OpenAI-compatible JSON Schema, adapt this object in your host.
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, type] of Object.entries(shape)) {
    const optional = type.endsWith("?");
    const clean = optional ? type.slice(0, -1) : type;
    properties[key] = { type: clean === "number" ? "number" : clean === "object" ? "object" : "string" };
    if (!optional) required.push(key);
  }
  return { type: "object", properties, required, additionalProperties: false };
}
