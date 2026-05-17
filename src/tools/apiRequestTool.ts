/*
 * Feature: workspace-configured outbound API tool for llm-runtime requests.
 * Notes: constrains calls to a configured base URL and applies host-owned auth headers from workspace env.
 * Recent changes: supports opt-in GET response caching in process memory while keeping file-backed response persistence constrained to the current user's workspace directory.
 */

import type { LLMToolDefinition, LLMToolExecutionContext } from "llm-runtime";
import { createHash } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveUserWorkspaceRoot, sanitizeUserIdForPath } from "../workspace/resolveWorkspace.js";

const API_TOOL_NAME = "api_request";
const DEFAULT_SECURITY_CONTEXT_HEADER = "X-Security-Context";
const DEFAULT_INLINE_BODY_BYTE_LIMIT = 32 * 1024;
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

type ApiResponseStorage = {
  workspaceRoot?: string;
  userId: string;
  inlineBodyByteLimit: number;
  workspaceRootRealPathPromise?: Promise<string>;
};

type ApiResponseSummary = {
  ok: boolean;
  status: number;
  statusText: string;
  url: string;
  headers: Record<string, string>;
};

type ApiCacheEntry = {
  version: 1;
  cachedAt: number;
  expiresAt: number;
  contentType: string | null;
  rawBody: string;
  response: ApiResponseSummary;
};

const apiResponseCache = new Map<string, ApiCacheEntry>();

type QueryValue = string | number | boolean | null | Array<string | number | boolean | null>;

function trimOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function toNodeErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
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

function isPathInside(parentPath: string, childPath: string): boolean {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function trimOptionalPath(value: unknown): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : undefined;
}

function parseCacheTtlMs(value: unknown, method: string): number | undefined {
  if (value === undefined || value === null || method !== "GET") {
    return undefined;
  }

  const normalizedValue = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof normalizedValue !== "number" || !Number.isFinite(normalizedValue)) {
    return undefined;
  }

  const ttlMs = Math.floor(normalizedValue);
  return ttlMs > 0 ? ttlMs : undefined;
}

function parseBypassCache(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalizedValue = value.trim().toLowerCase();
    if (normalizedValue === "true") {
      return true;
    }

    if (normalizedValue === "false") {
      return false;
    }
  }

  return false;
}

async function resolveExistingPathRealPath(candidatePath: string): Promise<string | null> {
  try {
    return await realpath(candidatePath);
  } catch (error) {
    if (toNodeErrorCode(error) === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function resolveNearestExistingParentRealPath(candidatePath: string): Promise<string> {
  let currentPath = path.dirname(candidatePath);

  while (true) {
    try {
      return await realpath(currentPath);
    } catch (error) {
      if (toNodeErrorCode(error) !== "ENOENT") {
        throw error;
      }

      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) {
        throw error;
      }

      currentPath = parentPath;
    }
  }
}

async function hasExistingWorkspaceAnchor(workspaceRoot: string, requestedPath: string): Promise<boolean> {
  const normalizedPath = requestedPath.split(/[\\/]+/).filter(Boolean);
  const anchorSegment = normalizedPath[0];
  if (!anchorSegment || anchorSegment === "." || anchorSegment === "..") {
    return false;
  }

  const anchorPath = path.resolve(workspaceRoot, anchorSegment);
  if (!isPathInside(workspaceRoot, anchorPath)) {
    return false;
  }

  return (await resolveExistingPathRealPath(anchorPath)) !== null;
}

function isNestedRelativePath(requestedPath: string): boolean {
  return /[\\/]/.test(requestedPath);
}

async function resolveWorkspaceOutputPath(
  workspaceRoot: string,
  workspaceRootRealPathPromise: Promise<string>,
  userId: string,
  requestedPath: string
): Promise<string> {
  if (path.isAbsolute(requestedPath)) {
    throw new Error("api_request outputFilePath must be relative to the workspace root");
  }

  const allowedRootPath = resolveUserWorkspaceRoot(workspaceRoot, userId);
  const workspaceRelativeCandidatePath = path.resolve(workspaceRoot, requestedPath);
  const candidatePath = isPathInside(allowedRootPath, workspaceRelativeCandidatePath)
    ? workspaceRelativeCandidatePath
    : !isNestedRelativePath(requestedPath) || await hasExistingWorkspaceAnchor(workspaceRoot, requestedPath)
      ? workspaceRelativeCandidatePath
      : path.resolve(allowedRootPath, requestedPath);

  if (!isPathInside(workspaceRoot, candidatePath)) {
    throw new Error("api_request outputFilePath must stay within the workspace root");
  }

  if (!isPathInside(allowedRootPath, candidatePath)) {
    throw new Error(`api_request outputFilePath must stay within ${toWorkspaceRelativePath(workspaceRoot, allowedRootPath)}`);
  }

  const workspaceRootRealPath = await workspaceRootRealPathPromise;
  const allowedRootRealPath = await resolveNearestExistingParentRealPath(allowedRootPath);
  if (!isPathInside(workspaceRootRealPath, allowedRootRealPath)) {
    throw new Error("api_request outputFilePath must stay within the workspace root");
  }

  const existingTargetRealPath = await resolveExistingPathRealPath(candidatePath);
  if (existingTargetRealPath) {
    if (!isPathInside(allowedRootRealPath, existingTargetRealPath)) {
      throw new Error(`api_request outputFilePath must stay within ${toWorkspaceRelativePath(workspaceRoot, allowedRootPath)}`);
    }

    return candidatePath;
  }

  const existingParentRealPath = await resolveNearestExistingParentRealPath(candidatePath);
  if (!isPathInside(allowedRootRealPath, existingParentRealPath)) {
    throw new Error(`api_request outputFilePath must stay within ${toWorkspaceRelativePath(workspaceRoot, allowedRootPath)}`);
  }

  return candidatePath;
}

function createCacheKey(userId: string, method: string, url: URL, headers: Headers): string {
  const normalizedHeaders = Array.from(headers.entries())
    .sort((left, right) => {
      if (left[0] !== right[0]) {
        return left[0].localeCompare(right[0]);
      }

      return left[1].localeCompare(right[1]);
    });

  return createHash("sha256")
    .update(JSON.stringify({
      userId,
      method,
      url: url.toString(),
      headers: normalizedHeaders
    }))
    .digest("hex");
}

async function persistResponseBody(filePath: string, rawBody: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, rawBody, "utf8");
}

function isApiCacheEntry(value: unknown): value is ApiCacheEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<ApiCacheEntry>;
  const response = candidate.response as Partial<ApiResponseSummary> | undefined;
  return candidate.version === 1
    && typeof candidate.cachedAt === "number"
    && typeof candidate.expiresAt === "number"
    && (typeof candidate.contentType === "string" || candidate.contentType === null)
    && typeof candidate.rawBody === "string"
    && typeof response?.ok === "boolean"
    && typeof response.status === "number"
    && typeof response.statusText === "string"
    && typeof response.url === "string"
    && typeof response.headers === "object"
    && response.headers !== null
    && !Array.isArray(response.headers);
}

function readApiCacheEntry(cacheKey: string): ApiCacheEntry | null {
  const cachedEntry = apiResponseCache.get(cacheKey);
  if (!cachedEntry) {
    return null;
  }

  if (!isApiCacheEntry(cachedEntry) || cachedEntry.expiresAt <= Date.now()) {
    apiResponseCache.delete(cacheKey);
    return null;
  }

  return cachedEntry;
}

function persistApiCacheEntry(cacheKey: string, entry: ApiCacheEntry): void {
  apiResponseCache.set(cacheKey, entry);
}

function toWorkspaceRelativePath(workspaceRoot: string, filePath: string): string {
  return path.relative(workspaceRoot, filePath).split(path.sep).join("/");
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

async function buildApiResponseResult(
  response: ApiResponseSummary,
  rawBody: string,
  contentType: string | null,
  storage: ApiResponseStorage,
  requestedOutputFilePath: string | undefined,
  cached: boolean | undefined
): Promise<Record<string, unknown>> {
  if (requestedOutputFilePath) {
    if (!storage.workspaceRoot) {
      throw new Error("api_request cannot save the response body because workspaceRoot is not configured");
    }

    const resolvedOutputPath = await resolveWorkspaceOutputPath(
      storage.workspaceRoot,
      storage.workspaceRootRealPathPromise ?? Promise.resolve(storage.workspaceRoot),
      storage.userId,
      requestedOutputFilePath
    );

    await persistResponseBody(resolvedOutputPath, rawBody);

    return {
      ...response,
      ...(cached === undefined ? {} : { cached }),
      bodySaved: true,
      bodyFilePath: toWorkspaceRelativePath(storage.workspaceRoot, resolvedOutputPath),
      bodyBytes: Buffer.byteLength(rawBody, "utf8")
    };
  }

  return {
    ...response,
    ...(cached === undefined ? {} : { cached }),
    body: parseResponseBody(rawBody, contentType)
  };
}

async function executeApiRequest(
  config: ApiToolConfig,
  storage: ApiResponseStorage,
  args: Record<string, unknown>,
  context: LLMToolExecutionContext | undefined,
  fetchImpl: typeof fetch
): Promise<unknown> {
  const method = parseMethod(args.method);
  const requestPath = parsePath(args.path);
  const url = resolveApiRequestUrl(config.baseUrl, requestPath, args.query);
  const headers = buildRequestHeaders(config, args.headers);
  const body = serializeRequestBody(method, args.body, headers);
  const requestedOutputFilePath = trimOptionalPath(args.outputFilePath);
  const cacheTtlMs = parseCacheTtlMs(args.cacheTtlMs, method);
  const bypassCache = parseBypassCache(args.bypassCache);

  const cacheKey = cacheTtlMs !== undefined
    ? createCacheKey(storage.userId, method, url, headers)
    : null;

  if (cacheKey && !bypassCache) {
    const cachedResponse = readApiCacheEntry(cacheKey);
    if (cachedResponse) {
      return await buildApiResponseResult(
        cachedResponse.response,
        cachedResponse.rawBody,
        cachedResponse.contentType,
        storage,
        requestedOutputFilePath,
        true
      );
    }
  }

  const response = await fetchImpl(url, {
    method,
    headers,
    ...(body !== undefined ? { body } : {}),
    signal: context?.abortSignal
  });

  const rawBody = await response.text();
  const contentType = response.headers.get("content-type");
  const responseSummary: ApiResponseSummary = {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    url: url.toString(),
    headers: sanitizeResponseHeaders(response.headers)
  };

  if (cacheKey && response.ok && cacheTtlMs !== undefined) {
    const now = Date.now();
    persistApiCacheEntry(cacheKey, {
      version: 1,
      cachedAt: now,
      expiresAt: now + cacheTtlMs,
      contentType,
      rawBody,
      response: responseSummary
    });
  }

  return await buildApiResponseResult(
    responseSummary,
    rawBody,
    contentType,
    storage,
    requestedOutputFilePath,
    cacheKey ? false : undefined
  );
}

export function createApiRequestTool(options: {
  envSource?: NodeJS.ProcessEnv;
  workspaceRoot?: string;
  userId?: string;
  fetchImpl?: typeof fetch;
  inlineBodyByteLimit?: number;
} = {}): LLMToolDefinition | null {
  const envSource = options.envSource ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const config = resolveApiToolConfig(envSource);
  const workspaceRootRealPathPromise = options.workspaceRoot
    ? realpath(options.workspaceRoot).catch(() => options.workspaceRoot as string)
    : undefined;

  if (!config) {
    return null;
  }
  const userId = trimRequiredUserId(options.userId);

  return {
    name: API_TOOL_NAME,
    description: "Call the workspace-configured API using a path relative to API_BASE_URL. Host-owned auth and security headers are applied automatically. Responses are returned inline by default; provide outputFilePath when you need a saved-body path. GET requests can opt into in-memory caching with cacheTtlMs.",
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
        },
        outputFilePath: {
          type: "string",
          description: "Optional nested relative path under the current user's workspace directory, or a workspace-relative path inside that directory, where the raw response body should be saved instead of returned inline. Large responses are saved automatically when this is omitted."
        },
        cacheTtlMs: {
          type: "number",
          description: "Optional positive TTL in milliseconds for GET requests. When provided, successful responses are cached in process memory and reused until the TTL expires."
        },
        bypassCache: {
          type: "boolean",
          description: "Optional GET-only flag that forces a fresh network request while still refreshing the cached entry for the provided cacheTtlMs."
        }
      },
      required: ["method", "path"]
    },
    execute: async (args, context) => await executeApiRequest(config, {
      workspaceRoot: options.workspaceRoot,
      userId,
      inlineBodyByteLimit: options.inlineBodyByteLimit ?? DEFAULT_INLINE_BODY_BYTE_LIMIT,
      workspaceRootRealPathPromise
    }, args, context, fetchImpl)
  };
}

function trimRequiredUserId(value: string | undefined): string {
  const userId = value?.trim();
  if (!userId) {
    throw new Error("api_request requires userId");
  }

  return sanitizeUserIdForPath(userId, "api_request requires userId");
}
