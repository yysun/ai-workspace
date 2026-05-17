import type { LLMToolDefinition } from "llm-runtime";
import { ZodError, type ZodType } from "zod";
import { AiwError, type WorkspaceProvider } from "../types.js";
import { createContentSchema, deleteContentSchema, listContentSchema, readContentSchema, resolveObjectSchema, searchContentSchema, writeContentSchema } from "./schemas.js";

const READ_CACHE_CONTROL_KEYS = new Set(["cacheTtlMs", "bypassCache"]);
const aiwReadToolCache = new Map<string, Map<string, CachedReadToolEntry>>();

type CachedReadToolEntry = {
  value: AiwToolResult;
  expiresAt: number;
};

type ReadCacheControlInput = {
  cacheTtlMs?: number;
  bypassCache?: boolean;
};

type AiwToolOptions = {
  cacheNamespace?: string;
  now?: () => number;
};

type ReadCacheContext = {
  namespace: string;
  now: () => number;
};

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

export function createAiwTools(provider: WorkspaceProvider, options: AiwToolOptions = {}): AiwToolDefinition[] {
  const cacheContext = createReadCacheContext(options);

  return [
    {
      name: "resolve_object",
      description: "Resolve a business object by name, alias, or ID. Returns canonical path and layer paths by default. Optional cacheTtlMs enables in-memory caching for repeat lookups.",
      evidenceKind: "read",
      parameters: jsonSchema({ query: "string", objectType: "string?", limit: "number?", cacheTtlMs: "number?", bypassCache: "boolean?" }),
      execute: wrapRead(resolveObjectSchema, (input) => provider.resolveObject(input), cacheContext, "resolve_object")
    },
    {
      name: "search_content",
      description: "Search AIW path-addressable content by keyword, object, layer, prefix, or topic. Optional cacheTtlMs enables in-memory caching for repeat searches.",
      evidenceKind: "read",
      parameters: jsonSchema({ query: "string", pathPrefix: "string?", objectType: "string?", objectId: "string?", layer: "string?", limit: "number?", cacheTtlMs: "number?", bypassCache: "boolean?" }),
      execute: wrapRead(searchContentSchema, (input) => provider.searchContent(input), cacheContext, "search_content")
    },
    {
      name: "list_content",
      description: "List content paths under a workspace path prefix. Optional cacheTtlMs enables in-memory caching for repeat listings.",
      evidenceKind: "read",
      parameters: jsonSchema({ path: "string", limit: "number?", cacheTtlMs: "number?", bypassCache: "boolean?" }),
      execute: wrapRead(listContentSchema, (input) => provider.listContent(input), cacheContext, "list_content")
    },
    {
      name: "read_content",
      description: "Read full content at an exact AIW path. Binary payloads are returned as base64 with their MIME type and contentEncoding. Optional cacheTtlMs enables in-memory caching for repeat reads.",
      evidenceKind: "read",
      parameters: jsonSchema({ path: "string", cacheTtlMs: "number?", bypassCache: "boolean?" }),
      execute: wrapRead(readContentSchema, (input) => provider.readContent(input), cacheContext, "read_content")
    },
    {
      name: "write_content",
      description: "Create or replace content at an exact AIW path. When contentEncoding is omitted, common binary and text file types are inferred from the path extension or MIME type.",
      evidenceKind: "write",
      parameters: jsonSchema({ path: "string", content: "string", contentType: "string?", contentEncoding: "string?", metadata: "object?" }),
      execute: wrapWrite(writeContentSchema, (input) => provider.writeContent(input), cacheContext)
    },
    {
      name: "create_content",
      description: "Create new content only if the path does not already exist. When contentEncoding is omitted, common binary and text file types are inferred from the path extension or MIME type.",
      evidenceKind: "write",
      parameters: jsonSchema({ path: "string", content: "string", contentType: "string?", contentEncoding: "string?", metadata: "object?" }),
      execute: wrapWrite(createContentSchema, (input) => provider.createContent(input), cacheContext)
    },
    {
      name: "delete_content",
      description: "Delete or soft-delete content at an exact AIW path.",
      evidenceKind: "write",
      parameters: jsonSchema({ path: "string", reason: "string?" }),
      execute: wrapWrite(deleteContentSchema, (input) => provider.deleteContent(input), cacheContext)
    }
  ];
}

export function getToolMap(provider: WorkspaceProvider, options: AiwToolOptions = {}): Record<string, (input: unknown) => Promise<AiwToolResult>> {
  return Object.fromEntries(
    createAiwTools(provider, options).map((tool) => [
      tool.name,
      async (input: unknown) => await tool.execute(asToolArgs(input))
    ])
  );
}

function createReadCacheContext(options: AiwToolOptions): ReadCacheContext {
  return {
    namespace: options.cacheNamespace?.trim() || "default",
    now: options.now ?? Date.now
  };
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

function wrapRead<TInput extends ReadCacheControlInput, TResult>(
  schema: ZodType<TInput>,
  fn: (input: Omit<TInput, keyof ReadCacheControlInput>) => Promise<TResult>,
  cacheContext: ReadCacheContext,
  toolName: string
) {
  return async (raw: Record<string, unknown>): Promise<AiwToolResult<TResult>> => {
    try {
      const parsed = schema.parse(raw);
      const { toolInput, cacheTtlMs, bypassCache } = splitReadCacheControl(parsed);
      const namespaceCache = getNamespaceCache(cacheContext.namespace);
      const cacheKey = cacheTtlMs !== undefined
        ? `${toolName}:${stableSerialize(toolInput)}`
        : null;

      if (cacheKey && !bypassCache) {
        const cached = namespaceCache.get(cacheKey);
        if (cached) {
          if (cached.expiresAt > cacheContext.now()) {
            return cached.value as AiwToolResult<TResult>;
          }
          namespaceCache.delete(cacheKey);
        }
      }

      const result: AiwToolResult<TResult> = { ok: true, data: await fn(toolInput) };
      if (cacheKey && result.ok && cacheTtlMs !== undefined) {
        namespaceCache.set(cacheKey, {
          value: result,
          expiresAt: cacheContext.now() + cacheTtlMs
        });
      }

      return result;
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

function wrapWrite<TInput, TResult>(
  schema: ZodType<TInput>,
  fn: (input: TInput) => Promise<TResult>,
  cacheContext: ReadCacheContext
) {
  const base = wrap(schema, fn);
  return async (raw: Record<string, unknown>): Promise<AiwToolResult<TResult>> => {
    const result = await base(raw);
    if (result.ok) {
      clearNamespaceCache(cacheContext.namespace);
    }
    return result;
  };
}

function splitReadCacheControl<TInput extends ReadCacheControlInput>(input: TInput): {
  toolInput: Omit<TInput, keyof ReadCacheControlInput>;
  cacheTtlMs: number | undefined;
  bypassCache: boolean;
} {
  const cacheTtlMs = typeof input.cacheTtlMs === "number"
    ? Math.floor(input.cacheTtlMs)
    : undefined;
  const bypassCache = input.bypassCache === true;
  const toolInput = Object.fromEntries(
    Object.entries(input).filter(([key]) => !READ_CACHE_CONTROL_KEYS.has(key))
  ) as Omit<TInput, keyof ReadCacheControlInput>;

  return { toolInput, cacheTtlMs, bypassCache };
}

function getNamespaceCache(namespace: string): Map<string, CachedReadToolEntry> {
  const existing = aiwReadToolCache.get(namespace);
  if (existing) {
    return existing;
  }

  const cache = new Map<string, CachedReadToolEntry>();
  aiwReadToolCache.set(namespace, cache);
  return cache;
}

function clearNamespaceCache(namespace: string): void {
  aiwReadToolCache.delete(namespace);
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, sortJsonValue(nestedValue)])
    );
  }

  return value;
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
    properties[key] = {
      type: clean === "number"
        ? "number"
        : clean === "object"
          ? "object"
          : clean === "boolean"
            ? "boolean"
            : "string"
    };
    if (!optional) required.push(key);
  }
  return { type: "object", properties, required, additionalProperties: false };
}
