import path from "node:path";
import type { ContentEncoding, WriteContentInput } from "../types.js";

const TEXT_CONTENT_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/yaml",
  "image/svg+xml",
  "text/csv",
  "text/html",
  "text/markdown",
  "text/plain",
  "text/xml",
  "text/yaml"
]);

const BINARY_CONTENT_TYPES = new Set([
  "application/msword",
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/zip",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp"
]);

const TEXT_EXTENSION_TO_CONTENT_TYPE: Record<string, string> = {
  ".csv": "text/csv",
  ".htm": "text/html",
  ".html": "text/html",
  ".json": "application/json",
  ".markdown": "text/markdown",
  ".md": "text/markdown",
  ".mdx": "text/markdown",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".xml": "application/xml",
  ".yaml": "application/yaml",
  ".yml": "application/yaml"
};

const BINARY_EXTENSION_TO_CONTENT_TYPE: Record<string, string> = {
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".webp": "image/webp",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".zip": "application/zip"
};

export interface ContentDescriptorInput {
  workspacePath: string;
  contentType?: string;
  contentEncoding?: string;
}

export interface ResolvedContentDescriptor {
  contentType: string;
  contentEncoding: ContentEncoding;
}

export interface PrepareWriteContentInput extends Omit<WriteContentInput, "content"> {
  path: string;
  content: string | Uint8Array;
}

export function resolveContentDescriptor(input: ContentDescriptorInput): ResolvedContentDescriptor {
  const normalizedContentType = normalizeContentType(input.contentType);
  const inferredContentType = normalizedContentType ?? inferContentTypeFromPath(input.workspacePath);
  const explicitEncoding = normalizeExplicitContentEncoding(input.contentEncoding);
  const contentEncoding = explicitEncoding ?? inferContentEncoding(input.workspacePath, inferredContentType);

  return {
    contentType: inferredContentType ?? defaultContentType(contentEncoding),
    contentEncoding
  };
}

export function defaultContentType(contentEncoding: ContentEncoding): string {
  return contentEncoding === "base64" ? "application/octet-stream" : "text/markdown";
}

export function isSearchableTextContent(contentEncoding: ContentEncoding, contentType?: string | null): boolean {
  if (contentEncoding === "base64") return false;
  if (!contentType) return true;
  return isTextContentType(contentType);
}

export function prepareWriteContentInput(input: PrepareWriteContentInput): WriteContentInput {
  const descriptor = resolveContentDescriptor({
    workspacePath: input.path,
    contentType: input.contentType,
    contentEncoding: input.contentEncoding
  });

  return {
    path: input.path,
    content: serializeWriteContent(input.content, descriptor.contentEncoding),
    contentType: descriptor.contentType,
    contentEncoding: descriptor.contentEncoding,
    metadata: input.metadata
  };
}

function inferContentEncoding(workspacePath: string, contentType?: string): ContentEncoding {
  if (contentType) {
    if (isBinaryContentType(contentType)) return "base64";
    if (isTextContentType(contentType)) return "utf8";
  }

  const extension = path.posix.extname(workspacePath.toLowerCase());
  if (extension in BINARY_EXTENSION_TO_CONTENT_TYPE) return "base64";
  if (extension in TEXT_EXTENSION_TO_CONTENT_TYPE) return "utf8";
  return "utf8";
}

function inferContentTypeFromPath(workspacePath: string): string | undefined {
  const extension = path.posix.extname(workspacePath.toLowerCase());
  return TEXT_EXTENSION_TO_CONTENT_TYPE[extension] ?? BINARY_EXTENSION_TO_CONTENT_TYPE[extension];
}

function isBinaryContentType(contentType: string): boolean {
  const normalized = normalizeContentType(contentType);
  if (!normalized) return false;
  return normalized.startsWith("audio/")
    || (normalized.startsWith("image/") && normalized !== "image/svg+xml")
    || normalized.startsWith("video/")
    || BINARY_CONTENT_TYPES.has(normalized);
}

function isTextContentType(contentType: string): boolean {
  const normalized = normalizeContentType(contentType);
  if (!normalized) return false;
  return normalized.startsWith("text/") || TEXT_CONTENT_TYPES.has(normalized);
}

function normalizeContentType(contentType?: string): string | undefined {
  return contentType?.split(";", 1)[0]?.trim().toLowerCase() || undefined;
}

function normalizeExplicitContentEncoding(contentEncoding?: string): ContentEncoding | undefined {
  if (contentEncoding === "base64") return "base64";
  if (contentEncoding === "utf8") return "utf8";
  return undefined;
}

function serializeWriteContent(content: string | Uint8Array, contentEncoding: ContentEncoding): string {
  if (typeof content === "string") return content;
  return Buffer.from(content).toString(contentEncoding === "base64" ? "base64" : "utf8");
}