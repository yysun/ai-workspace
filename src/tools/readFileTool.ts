/*
 * Feature: host-owned cached file-reading tool for workspace runtime requests.
 * Notes: enforces workspace-root path boundaries and reuses identical reads by resolved path, line range, and file version.
 * Recent changes: added a non-reserved cached workspace_read_file tool for repeated workspace file reads because llm-runtime reserves built-in tool names.
 */

import type { Stats } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { LLMToolDefinition } from "llm-runtime";

export const WORKSPACE_READ_FILE_TOOL_NAME = "workspace_read_file";
const DEFAULT_MAX_CACHE_ENTRIES = 512;
const READ_FILE_CACHE = new Map<string, string>();

type ReadFileTextImpl = (filePath: string) => Promise<string>;
type StatImpl = (filePath: string) => Promise<Stats>;
type RealpathImpl = (filePath: string) => Promise<string>;

type ReadFileToolOptions = {
  workspaceRoot: string;
  cache?: Map<string, string>;
  maxCacheEntries?: number;
  readFileImpl?: ReadFileTextImpl;
  statImpl?: StatImpl;
  realpathImpl?: RealpathImpl;
};

function defaultReadFileText(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}

function toNodeErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function trimPath(value: unknown): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    throw new Error("read_file requires a non-empty filePath");
  }

  return trimmed;
}

function parseOptionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error(`read_file ${fieldName} must be a positive integer`);
  }

  return value as number;
}

function parseRange(args: Record<string, unknown>): { startLine: number; endLine?: number } {
  const startLine = parseOptionalPositiveInteger(args.startLine, "startLine") ?? 1;
  const endLine = parseOptionalPositiveInteger(args.endLine, "endLine");

  if (typeof endLine === "number" && endLine < startLine) {
    throw new Error("read_file endLine must be greater than or equal to startLine");
  }

  return { startLine, endLine };
}

function isPathInside(parentPath: string, childPath: string): boolean {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

async function resolveWorkspaceFilePath(
  workspaceRootPath: string,
  workspaceRootRealPathPromise: Promise<string>,
  requestedPath: string,
  realpathImpl: RealpathImpl
): Promise<string> {
  const candidatePath = path.isAbsolute(requestedPath)
    ? path.resolve(requestedPath)
    : path.resolve(workspaceRootPath, requestedPath);

  if (!isPathInside(workspaceRootPath, candidatePath)) {
    throw new Error("read_file path must stay within the workspace root");
  }

  const resolvedFilePath = await realpathImpl(candidatePath);
  const workspaceRootRealPath = await workspaceRootRealPathPromise;
  if (!isPathInside(workspaceRootRealPath, resolvedFilePath)) {
    throw new Error("read_file path must stay within the workspace root");
  }

  return resolvedFilePath;
}

function createFileVersion(stats: Stats): string {
  return `${stats.size}:${stats.mtimeMs}`;
}

function createCacheKey(filePath: string, startLine: number, endLine: number | undefined, fileVersion: string): string {
  return JSON.stringify({ filePath, startLine, endLine: endLine ?? null, fileVersion });
}

function storeCacheEntry(cache: Map<string, string>, key: string, value: string, maxEntries: number): void {
  if (cache.has(key)) {
    cache.delete(key);
  }

  cache.set(key, value);
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey !== "string") {
      break;
    }

    cache.delete(oldestKey);
  }
}

function sliceContentByLineRange(content: string, startLine: number, endLine?: number): string {
  if (!content) {
    return "";
  }

  const finalEndLine = endLine ?? Number.POSITIVE_INFINITY;
  let currentLine = 1;
  let startIndex = startLine === 1 ? 0 : -1;
  let endIndex = -1;

  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== "\n") {
      continue;
    }

    if (currentLine === finalEndLine) {
      endIndex = index + 1;
      break;
    }

    currentLine += 1;
    if (currentLine === startLine) {
      startIndex = index + 1;
    }
  }

  if (startIndex === -1) {
    return "";
  }

  if (endIndex === -1) {
    endIndex = content.length;
  }

  return content.slice(startIndex, endIndex);
}

function normalizeReadFileError(error: unknown, requestedPath: string): Error {
  if (error instanceof Error && error.message.startsWith("read_file ")) {
    return error;
  }

  switch (toNodeErrorCode(error)) {
    case "ENOENT":
      return new Error(`read_file could not find ${requestedPath}`);
    case "EACCES":
    case "EPERM":
      return new Error(`read_file could not access ${requestedPath}`);
    case "EISDIR":
      return new Error("read_file requires a regular file");
    default:
      return error instanceof Error
        ? new Error(`read_file failed for ${requestedPath}: ${error.message}`)
        : new Error(`read_file failed for ${requestedPath}`);
  }
}

export function createReadFileTool(options: ReadFileToolOptions): LLMToolDefinition {
  const workspaceRootPath = path.resolve(options.workspaceRoot);
  const workspaceRootRealPathPromise = (options.realpathImpl ?? realpath)(workspaceRootPath)
    .catch(() => workspaceRootPath);
  const cache = options.cache ?? READ_FILE_CACHE;
  const maxCacheEntries = options.maxCacheEntries ?? DEFAULT_MAX_CACHE_ENTRIES;
  const readFileImpl = options.readFileImpl ?? defaultReadFileText;
  const statImpl = options.statImpl ?? stat;
  const realpathImpl = options.realpathImpl ?? realpath;

  return {
    name: WORKSPACE_READ_FILE_TOOL_NAME,
    description: "Read a file from the current workspace. Use filePath with optional startLine and endLine to limit the returned content.",
    evidenceKind: "read",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        filePath: {
          type: "string",
          description: "Relative or absolute file path within the current workspace root."
        },
        startLine: {
          type: "integer",
          description: "Optional 1-based starting line. Defaults to 1.",
          minimum: 1
        },
        endLine: {
          type: "integer",
          description: "Optional 1-based inclusive ending line.",
          minimum: 1
        }
      },
      required: ["filePath"]
    },
    execute: async (args) => {
      const requestedPath = trimPath(args.filePath);
      try {
        const { startLine, endLine } = parseRange(args);
        const resolvedFilePath = await resolveWorkspaceFilePath(
          workspaceRootPath,
          workspaceRootRealPathPromise,
          requestedPath,
          realpathImpl
        );
        const fileStats = await statImpl(resolvedFilePath);

        if (!fileStats.isFile()) {
          throw new Error("read_file requires a regular file");
        }

        const cacheKey = createCacheKey(
          resolvedFilePath,
          startLine,
          endLine,
          createFileVersion(fileStats)
        );
        const cached = cache.get(cacheKey);
        if (typeof cached === "string") {
          return cached;
        }

        const content = await readFileImpl(resolvedFilePath);
        const slicedContent = sliceContentByLineRange(content, startLine, endLine);
        storeCacheEntry(cache, cacheKey, slicedContent, maxCacheEntries);
        return slicedContent;
      } catch (error) {
        throw normalizeReadFileError(error, requestedPath);
      }
    }
  };
}