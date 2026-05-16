/*
 * Feature: workspace-configured outbound API tool for llm-runtime requests.
 * Notes: constrains calls to a configured base URL and applies host-owned auth headers from workspace env.
 * Recent changes: initial api_request tool implementation with base-path guards, auth attachment, and structured responses.
 */

import type { LLMToolDefinition, LLMToolExecutionContext } from "llm-runtime";

const API_TOOL_NAME = "api_request";
const DEFAULT_SECURITY_CONTEXT_HEADER = "X-Security-Context";
const SUPPORTED_API_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const REDACTED_RESPONSE_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "set-cookie",
  "set-cookie2"
]);

type ApiToolConfig = {
  baseUrl: URL;
  accessToken?: string;
  authScheme: string;
  securityContext?: string;
  securityContextHeader: string;
};

type QueryValue = string | number | boolean | null | Array<string | number | boolean | null>;

function trimOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeBaseUrl(rawBaseUrl: string): URL {
  let baseUrl: URL;

  try {
    baseUrl = new URL(rawBaseUrl);
  } catch {
    throw new Error("API_BASE_URL must be a valid absolute URL");
  }

  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
    throw new Error("API_BASE_URL must use http or https");
  }

  if (!baseUrl.pathname.endsWith("/")) {
    baseUrl.pathname = `${baseUrl.pathname}/`;
  }

  return baseUrl;
}

export function resolveApiToolConfig(envSource: NodeJS.ProcessEnv): ApiToolConfig | null {
  const baseUrl = trimOptionalString(envSource.API_BASE_URL);
  if (!baseUrl) {
    return null;
  }

  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    accessToken: trimOptionalString(envSource.API_ACCESS_TOKEN),
    authScheme: trimOptionalString(envSource.API_AUTH_SCHEME) ?? "Bearer",
    securityContext: trimOptionalString(envSource.API_SECURITY_CONTEXT),
    securityContextHeader: trimOptionalString(envSource.API_SECURITY_CONTEXT_HEADER) ?? DEFAULT_SECURITY_CONTEXT_HEADER
  };
}

function parseMethod(value: unknown): string {
  const method = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!SUPPORTED_API_METHODS.has(method)) {
    throw new Error(`api_request requires one of: ${Array.from(SUPPORTED_API_METHODS).join(", ")}`);
  }

  return method;
}

function parsePath(value: unknown): string {
  const path = typeof value === "string" ? value.trim() : "";
  if (!path) {
    throw new Error("api_request requires a non-empty path");
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
    throw new Error("api_request path must be relative to API_BASE_URL");
  }

  return path;
}

function asQueryValues(value: unknown): QueryValue | undefined {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value) && value.every((entry) => entry === null || typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean")) {
    return value as QueryValue;
  }

  return undefined;
}

function appendQueryParams(url: URL, query: unknown): void {
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    return;
  }

  for (const [key, rawValue] of Object.entries(query as Record<string, unknown>)) {
    const value = asQueryValues(rawValue);
    if (value === undefined) {
      continue;
    }

    const values = Array.isArray(value) ? value : [value];
    for (const entry of values) {
      if (entry === null) {
        continue;
      }

      url.searchParams.append(key, String(entry));
    }
  }
}

export function resolveApiRequestUrl(baseUrl: URL, relativePath: string, query: unknown): URL {
  const sanitizedPath = relativePath.replace(/^\/+/, "");
  const resolvedUrl = new URL(sanitizedPath, baseUrl);
  appendQueryParams(resolvedUrl, query);

  if (resolvedUrl.origin !== baseUrl.origin) {
    throw new Error("api_request path must stay within the configured API origin");
  }

  if (!resolvedUrl.pathname.startsWith(baseUrl.pathname)) {
    throw new Error("api_request path must stay within the configured API base path");
  }

  return resolvedUrl;
}

function buildRequestHeaders(config: ApiToolConfig, rawHeaders: unknown): Headers {
  const headers = new Headers();

  if (rawHeaders && typeof rawHeaders === "object" && !Array.isArray(rawHeaders)) {
    for (const [key, value] of Object.entries(rawHeaders as Record<string, unknown>)) {
      if (typeof value === "string") {
        headers.set(key, value);
      }
    }
  }

  if (config.accessToken) {
    headers.set("Authorization", `${config.authScheme} ${config.accessToken}`);
  }

  if (config.securityContext) {
    headers.set(config.securityContextHeader, config.securityContext);
  }

  headers.set("Accept", headers.get("Accept") ?? "application/json, text/plain;q=0.9, */*;q=0.8");

  return headers;
}

function serializeRequestBody(method: string, body: unknown, headers: Headers): string | undefined {
  if (body === undefined) {
    return undefined;
  }

  if (method === "GET") {
    throw new Error("api_request GET calls cannot include a body");
  }

  if (typeof body === "string") {
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "text/plain; charset=utf-8");
    }

    return body;
  }

  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  try {
    return JSON.stringify(body);
  } catch {
    throw new Error("api_request body must be JSON serializable");
  }
}

function sanitizeResponseHeaders(headers: Headers): Record<string, string> {
  const sanitizedHeaders: Record<string, string> = {};

  for (const [key, value] of headers.entries()) {
    if (REDACTED_RESPONSE_HEADER_NAMES.has(key.toLowerCase())) {
      continue;
    }

    sanitizedHeaders[key] = value;
  }

  return sanitizedHeaders;
}

function parseResponseBody(rawBody: string, contentType: string | null): unknown {
  if (!rawBody) {
    return "";
  }

  if (contentType?.toLowerCase().includes("application/json")) {
    try {
      return JSON.parse(rawBody);
    } catch {
      return rawBody;
    }
  }

  return rawBody;
}

async function executeApiRequest(
  config: ApiToolConfig,
  args: Record<string, unknown>,
  context: LLMToolExecutionContext | undefined,
  fetchImpl: typeof fetch
): Promise<unknown> {
  const method = parseMethod(args.method);
  const path = parsePath(args.path);
  const url = resolveApiRequestUrl(config.baseUrl, path, args.query);
  const headers = buildRequestHeaders(config, args.headers);
  const body = serializeRequestBody(method, args.body, headers);

  const response = await fetchImpl(url, {
    method,
    headers,
    ...(body !== undefined ? { body } : {}),
    signal: context?.abortSignal
  });

  const rawBody = await response.text();

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    url: url.toString(),
    headers: sanitizeResponseHeaders(response.headers),
    body: parseResponseBody(rawBody, response.headers.get("content-type"))
  };
}

export function createApiRequestTool(options: {
  envSource?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
} = {}): LLMToolDefinition | null {
  const envSource = options.envSource ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const config = resolveApiToolConfig(envSource);

  if (!config) {
    return null;
  }

  return {
    name: API_TOOL_NAME,
    description: "Call the workspace-configured API using a path relative to API_BASE_URL. Host-owned auth and security headers are applied automatically.",
    evidenceKind: "external_action",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        method: {
          type: "string",
          description: "HTTP method to use.",
          enum: Array.from(SUPPORTED_API_METHODS)
        },
        path: {
          type: "string",
          description: "Relative API path under the configured API_BASE_URL."
        },
        query: {
          type: "object",
          description: "Optional query string values. String, number, boolean, null, or arrays of those are accepted.",
          additionalProperties: true
        },
        headers: {
          type: "object",
          description: "Optional additional request headers. Host-owned auth headers override conflicting values.",
          additionalProperties: {
            type: "string"
          }
        },
        body: {
          description: "Optional JSON-serializable body value or raw string payload."
        }
      },
      required: ["method", "path"]
    },
    execute: async (args, context) => await executeApiRequest(config, args, context, fetchImpl)
  };
}