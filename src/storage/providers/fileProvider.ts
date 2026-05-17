import fs from "node:fs/promises";
import path from "node:path";
import { AiwError, type ContentSearchInput, type ContentSearchResult, type CreateContentInput, type CreateContentResult, type DeleteContentInput, type DeleteContentResult, type ListContentInput, type ListContentResult, type ReadContentInput, type ReadContentResult, type ResolveObjectInput, type ResolvedObject, type WorkspaceContext, type WorkspaceProvider, type WriteContentInput, type WriteContentResult } from "../types.js";
import { canonicalObjectPath, defaultLayerPaths, inferMetadataFromPath, joinWorkspacePath, normalizeName, normalizeWorkspacePath } from "../utils/path.js";

interface SidecarMetadata {
  contentType?: string;
  metadata?: Record<string, unknown>;
  updatedAt?: string;
}

export class FileWorkspaceProvider implements WorkspaceProvider {
  private root: string;
  private rootRealPathPromise?: Promise<string>;

  constructor(private context: WorkspaceContext) {
    if (!context.fileRoot) throw new AiwError("INVALID_INPUT", "fileRoot is required for file provider");
    this.root = path.resolve(context.fileRoot);
  }

  async doctor(): Promise<Record<string, unknown>> {
    await this.rootRealPath();
    return {
      ok: true,
      storage: "file",
      workspaceId: this.context.workspaceId,
      userId: this.context.userId,
      root: this.root
    };
  }

  async searchContent(input: ContentSearchInput): Promise<ContentSearchResult[]> {
    const limit = input.limit ?? 20;
    const prefix = normalizeWorkspacePath(input.pathPrefix ?? "");
    const query = input.query.toLowerCase();
    const files = await this.walk(prefix);
    const matches: ContentSearchResult[] = [];

    for (const filePath of files) {
      if (matches.length >= limit) break;
      if (filePath.endsWith(".metadata.json")) continue;
      const inferred = inferMetadataFromPath(filePath);
      if (input.objectType && inferred.objectType !== input.objectType) continue;
      if (input.objectId && inferred.objectId !== input.objectId) continue;
      if (input.layer && inferred.layer !== input.layer) continue;
      const abs = await this.resolveExistingWorkspacePath(filePath);
      const content = await fs.readFile(abs, "utf8").catch(() => "");
      const lowerPath = filePath.toLowerCase();
      const lowerContent = content.toLowerCase();
      const foundAt = lowerContent.indexOf(query);
      if (lowerPath.includes(query) || foundAt >= 0) {
        const sidecar = await this.readSidecar(filePath);
        matches.push({
          path: filePath,
          title: typeof sidecar.metadata?.title === "string" ? sidecar.metadata.title : null,
          snippet: foundAt >= 0 ? makeSnippet(content, foundAt) : null,
          objectType: inferred.objectType ?? null,
          objectId: inferred.objectId ?? null,
          layer: inferred.layer ?? null,
          updatedAt: sidecar.updatedAt ?? null,
          score: lowerPath.includes(query) ? 1 : 0.7
        });
      }
    }
    return matches;
  }

  async listContent(input: ListContentInput): Promise<ListContentResult[]> {
    const prefix = normalizeWorkspacePath(input.path);
    const limit = input.limit ?? 100;
    const abs = await this.resolveExistingWorkspacePath(prefix);
    const entries = await fs.readdir(abs, { withFileTypes: true }).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") throw new AiwError("NOT_FOUND", "Path prefix not found", { path: input.path });
      throw err;
    });

    const results: ListContentResult[] = [];
    for (const entry of entries) {
      if (results.length >= limit) break;
      if (entry.name.endsWith(".metadata.json")) continue;
      const childPath = joinWorkspacePath(prefix, entry.name) + (entry.isDirectory() ? "/" : "");
      const inferred = inferMetadataFromPath(childPath);
      const sidecar = entry.isDirectory() ? {} : await this.readSidecar(childPath);
      results.push({
        path: childPath,
        type: entry.isDirectory() ? "prefix" : "content",
        title: typeof sidecar.metadata?.title === "string" ? sidecar.metadata.title : null,
        layer: inferred.layer ?? null,
        updatedAt: sidecar.updatedAt ?? null
      });
    }
    return results;
  }

  async readContent(input: ReadContentInput): Promise<ReadContentResult> {
    const p = normalizeWorkspacePath(input.path);
    const abs = await this.resolveExistingWorkspacePath(p);
    const content = await fs.readFile(abs, "utf8").catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") throw new AiwError("NOT_FOUND", "Content path not found", { path: input.path });
      throw err;
    });
    const sidecar = await this.readSidecar(p);
    return {
      path: p,
      content,
      contentType: sidecar.contentType ?? "text/markdown",
      metadata: { ...inferMetadataFromPath(p), ...(sidecar.metadata ?? {}) },
      updatedAt: sidecar.updatedAt ?? null
    };
  }

  async writeContent(input: WriteContentInput): Promise<WriteContentResult> {
    const p = normalizeWorkspacePath(input.path);
    const abs = await this.resolveWritableWorkspacePath(p);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await this.assertRealPathInsideWorkspace(await resolveNearestExistingParentRealPath(abs), p);
    const existed = await exists(abs);
    await fs.writeFile(abs, input.content, "utf8");
    const updatedAt = new Date().toISOString();
    await this.writeSidecar(p, {
      contentType: input.contentType ?? "text/markdown",
      metadata: { ...inferMetadataFromPath(p), ...(input.metadata ?? {}) },
      updatedAt
    });
    return { path: p, created: !existed, updatedAt };
  }

  async createContent(input: CreateContentInput): Promise<CreateContentResult> {
    const p = normalizeWorkspacePath(input.path);
    if (await exists(await this.resolveWritableWorkspacePath(p))) throw new AiwError("CONFLICT", "Content path already exists", { path: p });
    const result = await this.writeContent(input);
    return { path: result.path, created: true, updatedAt: result.updatedAt };
  }

  async deleteContent(input: DeleteContentInput): Promise<DeleteContentResult> {
    const p = normalizeWorkspacePath(input.path);
    const abs = await this.resolveExistingWorkspacePath(p);
    const deletedAt = new Date().toISOString();
    if (!(await exists(abs))) throw new AiwError("NOT_FOUND", "Content path not found", { path: p });
    await fs.rm(abs, { force: true });
    await fs.rm(await this.resolveWritableWorkspacePath(this.sidecarPath(p)), { force: true });
    return { path: p, deleted: true, deletedAt };
  }

  async resolveObject(input: ResolveObjectInput): Promise<ResolvedObject[]> {
    const limit = input.limit ?? 10;
    const query = normalizeName(input.query);
    const objects = await this.readObjectsIndex();
    const matches = objects
      .filter((o) => !input.objectType || o.objectType === input.objectType)
      .map((o) => {
        const name = normalizeName(o.displayName);
        const aliasHit = (o.aliases ?? []).some((a: string) => normalizeName(a).includes(query));
        const score = name === query ? 1 : name.includes(query) || aliasHit ? 0.8 : 0;
        return { ...o, score };
      })
      .filter((o) => o.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    if (matches.length > 0) {
      return matches.map((o) => ({
        objectType: o.objectType,
        objectId: o.objectId,
        displayName: o.displayName,
        canonicalPath: canonicalObjectPath(o.objectType, o.objectId),
        score: o.score,
        layers: defaultLayerPaths(o.objectType, o.objectId),
        metadata: o.metadata ?? {}
      }));
    }

    // fallback: infer from object.md files if no index exists
    const found = await this.searchContent({ query: input.query, pathPrefix: "data/", limit });
    const seen = new Set<string>();
    const inferred: ResolvedObject[] = [];
    for (const result of found) {
      if (!result.objectType || !result.objectId) continue;
      const key = `${result.objectType}:${result.objectId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      inferred.push({
        objectType: result.objectType,
        objectId: result.objectId,
        displayName: result.title ?? result.objectId,
        canonicalPath: canonicalObjectPath(result.objectType, result.objectId),
        score: result.score ?? 0.5,
        layers: defaultLayerPaths(result.objectType, result.objectId),
        metadata: {}
      });
    }
    return inferred;
  }

  private toAbs(workspacePath: string): string {
    const p = normalizeWorkspacePath(workspacePath);
    const abs = path.resolve(this.root, p);
    if (!isPathInside(this.root, abs)) throw new AiwError("INVALID_INPUT", "Path escapes workspace", { path: workspacePath });
    return abs;
  }

  private async resolveExistingWorkspacePath(workspacePath: string): Promise<string> {
    const abs = this.toAbs(workspacePath);
    const real = await fs.realpath(abs).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") throw new AiwError("NOT_FOUND", "Content path not found", { path: workspacePath });
      throw err;
    });
    await this.assertRealPathInsideWorkspace(real, workspacePath);
    return real;
  }

  private async resolveWritableWorkspacePath(workspacePath: string): Promise<string> {
    const abs = this.toAbs(workspacePath);
    const existingRealPath = await resolveExistingPathRealPath(abs);

    if (existingRealPath) {
      await this.assertRealPathInsideWorkspace(existingRealPath, workspacePath);
      return abs;
    }

    await this.rootRealPath();
    await this.assertRealPathInsideWorkspace(await resolveNearestExistingParentRealPath(abs), workspacePath);
    return abs;
  }

  private async assertRealPathInsideWorkspace(realPath: string, workspacePath: string): Promise<void> {
    const rootRealPath = await this.rootRealPath();
    if (!isPathInside(rootRealPath, realPath)) {
      throw new AiwError("INVALID_INPUT", "Path escapes workspace", { path: workspacePath });
    }
  }

  private rootRealPath(): Promise<string> {
    this.rootRealPathPromise ??= fs.mkdir(this.root, { recursive: true }).then(() => fs.realpath(this.root));
    return this.rootRealPathPromise;
  }

  private sidecarPath(workspacePath: string): string {
    return `${normalizeWorkspacePath(workspacePath)}.metadata.json`;
  }

  private async readSidecar(workspacePath: string): Promise<SidecarMetadata> {
    const txt = await fs.readFile(await this.resolveWritableWorkspacePath(this.sidecarPath(workspacePath)), "utf8").catch(() => "{}");
    try { return JSON.parse(txt) as SidecarMetadata; } catch { return {}; }
  }

  private async writeSidecar(workspacePath: string, metadata: SidecarMetadata): Promise<void> {
    const sidecar = await this.resolveWritableWorkspacePath(this.sidecarPath(workspacePath));
    await fs.mkdir(path.dirname(sidecar), { recursive: true });
    await this.assertRealPathInsideWorkspace(await resolveNearestExistingParentRealPath(sidecar), workspacePath);
    await fs.writeFile(sidecar, JSON.stringify(metadata, null, 2), "utf8");
  }

  private async walk(prefix: string): Promise<string[]> {
    const start = this.toAbs(prefix);
    if (!(await exists(start))) return [];
    await this.assertRealPathInsideWorkspace(await fs.realpath(start), prefix);
    const out: string[] = [];
    const visit = async (abs: string) => {
      await this.assertRealPathInsideWorkspace(await fs.realpath(abs), path.relative(this.root, abs));
      const entries = await fs.readdir(abs, { withFileTypes: true });
      for (const entry of entries) {
        const childAbs = path.join(abs, entry.name);
        if (entry.isDirectory()) await visit(childAbs);
        else out.push(path.relative(this.root, childAbs).replaceAll(path.sep, "/"));
      }
    };
    const stat = await fs.stat(start);
    if (stat.isDirectory()) await visit(start); else out.push(prefix);
    return out;
  }

  private async readObjectsIndex(): Promise<Array<{ objectType: string; objectId: string; displayName: string; aliases?: string[]; metadata?: Record<string, unknown> }>> {
    const indexPath = await this.resolveExistingWorkspacePath("indexes/objects.jsonl").catch((error) => {
      if (error instanceof AiwError && error.code === "NOT_FOUND") {
        return null;
      }

      throw error;
    });
    if (!indexPath) {
      return [];
    }

    const txt = await fs.readFile(indexPath, "utf8").catch(() => "");
    return txt.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  }
}

function makeSnippet(content: string, foundAt: number): string {
  const start = Math.max(0, foundAt - 80);
  const end = Math.min(content.length, foundAt + 160);
  return content.slice(start, end).replace(/\s+/g, " ").trim();
}

async function exists(abs: string): Promise<boolean> {
  return fs.access(abs).then(() => true, () => false);
}

function isPathInside(parentPath: string, childPath: string): boolean {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

async function resolveExistingPathRealPath(candidatePath: string): Promise<string | null> {
  try {
    return await fs.realpath(candidatePath);
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
      return await fs.realpath(currentPath);
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

function toNodeErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}
