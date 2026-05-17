import path from "node:path";
import { AiwError, type AiwMetadata } from "../types.js";

export function normalizeWorkspacePath(input: string): string {
  const raw = input.replaceAll("\\", "/").trim();
  if (!raw || raw === "." || raw === "/") return "";
  if (raw.includes("\0")) throw new AiwError("INVALID_INPUT", "Path contains invalid null byte");
  const normalized = path.posix.normalize(raw).replace(/^\/+/, "");
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new AiwError("INVALID_INPUT", "Path must stay inside workspace", { path: input });
  }
  return normalized === "." ? "" : normalized;
}

export function joinWorkspacePath(...parts: string[]): string {
  return normalizeWorkspacePath(parts.filter(Boolean).join("/"));
}

export function inferMetadataFromPath(inputPath: string): AiwMetadata {
  const p = normalizeWorkspacePath(inputPath);
  const parts = p.split("/").filter(Boolean);
  const metadata: AiwMetadata = {};

  // data/accounts/a123/memory.md -> account, a123, memory
  if (parts.length >= 4 && parts[0] === "data") {
    const collection = parts[1];
    const id = parts[2];
    const file = parts[3] ?? "";
    metadata.objectType = singularize(collection);
    metadata.objectId = id;
    metadata.layer = file.replace(/\.[^.]+$/, "");
  } else if (parts[0] === "views") {
    metadata.objectType = "view";
    metadata.layer = "view";
  } else if (parts[0] === "outputs") {
    metadata.objectType = "output";
    metadata.layer = "output";
  }

  return metadata;
}

export function canonicalObjectPath(objectType: string, objectId: string): string {
  return `data/${pluralize(objectType)}/${objectId}/`;
}

export function defaultLayerPaths(objectType: string, objectId: string): Record<string, string> {
  const base = canonicalObjectPath(objectType, objectId);
  return {
    source: `${base}source.md`,
    memory: `${base}summary.md`,
    action: `${base}action.md`
  };
}

export function pluralize(value: string): string {
  if (value.endsWith("s")) return value;
  if (value.endsWith("y")) return `${value.slice(0, -1)}ies`;
  return `${value}s`;
}

export function singularize(value: string): string {
  if (value.endsWith("ies")) return `${value.slice(0, -3)}y`;
  if (value.endsWith("s")) return value.slice(0, -1);
  return value;
}

export function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
