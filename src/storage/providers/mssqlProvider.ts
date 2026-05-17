import sql from "mssql";
import { AiwError, type ContentEncoding, type ContentSearchInput, type ContentSearchResult, type CreateContentInput, type CreateContentResult, type DeleteContentInput, type DeleteContentResult, type ListContentInput, type ListContentResult, type ReadContentInput, type ReadContentResult, type ResolveObjectInput, type ResolvedObject, type WorkspaceContext, type WorkspaceProvider, type WriteContentInput, type WriteContentResult } from "../types.js";
import { resolveContentDescriptor } from "../utils/content.js";
import { canonicalObjectPath, defaultLayerPaths, inferMetadataFromPath, normalizeName, normalizeWorkspacePath } from "../utils/path.js";

const CONTENT_ENCODING_METADATA_KEY = "_contentEncoding";

export class MssqlWorkspaceProvider implements WorkspaceProvider {
  private poolPromise?: Promise<sql.ConnectionPool>;

  constructor(private context: WorkspaceContext) {
    if (!context.mssqlConnectionString) {
      throw new AiwError("INVALID_INPUT", "mssqlConnectionString is required for MSSQL provider");
    }
  }

  async doctor(): Promise<Record<string, unknown>> {
    const pool = await this.pool();
    await pool.request().query("SELECT 1 AS ok");
    return {
      ok: true,
      storage: "mssql",
      workspaceId: this.context.workspaceId,
      userId: this.context.userId
    };
  }

  async searchContent(input: ContentSearchInput): Promise<ContentSearchResult[]> {
    const request = (await this.pool()).request();
    request.input("workspace_id", sql.NVarChar(128), this.context.workspaceId);
    request.input("user_id", sql.NVarChar(128), this.context.userId);
    request.input("query", sql.NVarChar(500), `%${escapeLike(input.query)}%`);
    request.input("limit", sql.Int, input.limit ?? 20);
    if (input.pathPrefix) request.input("path_prefix", sql.NVarChar(1000), `${normalizeWorkspacePath(input.pathPrefix)}%`);
    if (input.objectType) request.input("object_type", sql.NVarChar(100), input.objectType);
    if (input.objectId) request.input("object_id", sql.NVarChar(200), input.objectId);
    if (input.layer) request.input("layer", sql.NVarChar(100), input.layer);

    const where: string[] = [
      "workspace_id = @workspace_id",
      "user_id = @user_id",
      "deleted_at IS NULL",
      "(path LIKE @query ESCAPE '\\' OR title LIKE @query ESCAPE '\\' OR (ISNULL(JSON_VALUE(metadata_json, '$._contentEncoding'), '') <> 'base64' AND (content_type IS NULL OR content_type LIKE 'text/%' OR content_type IN ('application/json', 'application/ld+json', 'application/xml', 'application/yaml', 'image/svg+xml', 'text/xml', 'text/yaml')) AND content LIKE @query ESCAPE '\\'))"
    ];
    if (input.pathPrefix) where.push("path LIKE @path_prefix ESCAPE '\\'");
    if (input.objectType) where.push("object_type = @object_type");
    if (input.objectId) where.push("object_id = @object_id");
    if (input.layer) where.push("layer = @layer");

    const result = await request.query(`
      SELECT TOP (@limit)
        path,
        title,
        object_type,
        object_id,
        layer,
        updated_at,
        CASE
          WHEN ISNULL(JSON_VALUE(metadata_json, '$._contentEncoding'), '') <> 'base64'
            AND (content_type IS NULL OR content_type LIKE 'text/%' OR content_type IN ('application/json', 'application/ld+json', 'application/xml', 'application/yaml', 'image/svg+xml', 'text/xml', 'text/yaml'))
            AND CHARINDEX(REPLACE(REPLACE(@query, '%', ''), '\\', ''), content) > 0
          THEN SUBSTRING(content, CASE WHEN CHARINDEX(REPLACE(REPLACE(@query, '%', ''), '\\', ''), content) - 80 > 0 THEN CHARINDEX(REPLACE(REPLACE(@query, '%', ''), '\\', ''), content) - 80 ELSE 1 END, 240)
          ELSE NULL
        END AS snippet
      FROM aiw_documents
      WHERE ${where.join(" AND ")}
      ORDER BY updated_at DESC
    `);

    return result.recordset.map((r) => ({
      path: r.path,
      title: r.title,
      snippet: r.snippet,
      objectType: r.object_type,
      objectId: r.object_id,
      layer: r.layer,
      updatedAt: r.updated_at?.toISOString?.() ?? null,
      score: null
    }));
  }

  async listContent(input: ListContentInput): Promise<ListContentResult[]> {
    const prefix = normalizeWorkspacePath(input.path);
    const request = (await this.pool()).request();
    request.input("workspace_id", sql.NVarChar(128), this.context.workspaceId);
    request.input("user_id", sql.NVarChar(128), this.context.userId);
    request.input("prefix", sql.NVarChar(1000), `${prefix}%`);
    request.input("limit", sql.Int, input.limit ?? 100);
    const result = await request.query(`
      SELECT TOP (@limit) path, title, layer, updated_at
      FROM aiw_documents
      WHERE workspace_id = @workspace_id
        AND user_id = @user_id
        AND path LIKE @prefix ESCAPE '\\'
        AND deleted_at IS NULL
      ORDER BY path
    `);
    return result.recordset.map((r) => ({
      path: r.path,
      type: "content" as const,
      title: r.title,
      layer: r.layer,
      updatedAt: r.updated_at?.toISOString?.() ?? null
    }));
  }

  async readContent(input: ReadContentInput): Promise<ReadContentResult> {
    const p = normalizeWorkspacePath(input.path);
    const request = (await this.pool()).request();
    request.input("workspace_id", sql.NVarChar(128), this.context.workspaceId);
    request.input("user_id", sql.NVarChar(128), this.context.userId);
    request.input("path", sql.NVarChar(1000), p);
    const result = await request.query(`
      SELECT TOP 1 path, content, content_type, metadata_json, object_type, object_id, layer, title, updated_at
      FROM aiw_documents
      WHERE workspace_id = @workspace_id
        AND user_id = @user_id
        AND path = @path
        AND deleted_at IS NULL
    `);
    const row = result.recordset[0];
    if (!row) throw new AiwError("NOT_FOUND", "Content path not found", { path: p });
    const { metadata, contentEncoding } = parseStoredMetadata(row.metadata_json);
    const descriptor = resolveContentDescriptor({
      workspacePath: row.path,
      contentType: row.content_type ?? undefined,
      contentEncoding
    });
    return {
      path: row.path,
      content: row.content,
      contentType: descriptor.contentType,
      contentEncoding: descriptor.contentEncoding,
      metadata: {
        objectType: row.object_type ?? undefined,
        objectId: row.object_id ?? undefined,
        layer: row.layer ?? undefined,
        title: row.title ?? undefined,
        ...metadata
      },
      updatedAt: row.updated_at?.toISOString?.() ?? null
    };
  }

  async writeContent(input: WriteContentInput): Promise<WriteContentResult> {
    const p = normalizeWorkspacePath(input.path);
    const inferred = inferMetadataFromPath(p);
    const metadata = { ...inferred, ...(input.metadata ?? {}) };
    const descriptor = resolveContentDescriptor({
      workspacePath: p,
      contentType: input.contentType,
      contentEncoding: input.contentEncoding
    });
    const now = new Date().toISOString();
    const pool = await this.pool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      const check = new sql.Request(transaction);
      check.input("workspace_id", sql.NVarChar(128), this.context.workspaceId);
      check.input("user_id", sql.NVarChar(128), this.context.userId);
      check.input("path", sql.NVarChar(1000), p);
      const found = await check.query(`
        SELECT TOP 1 id, content, metadata_json
        FROM aiw_documents WITH (UPDLOCK)
        WHERE workspace_id = @workspace_id AND user_id = @user_id AND path = @path AND deleted_at IS NULL
      `);
      const existing = found.recordset[0];
      const created = !existing;

      if (existing) {
        const versionReq = new sql.Request(transaction);
        versionReq.input("document_id", sql.UniqueIdentifier, existing.id);
        versionReq.input("workspace_id", sql.NVarChar(128), this.context.workspaceId);
        versionReq.input("user_id", sql.NVarChar(128), this.context.userId);
        versionReq.input("content", sql.NVarChar(sql.MAX), existing.content);
        versionReq.input("metadata_json", sql.NVarChar(sql.MAX), existing.metadata_json);
        await versionReq.query(`
          INSERT INTO aiw_document_versions (document_id, workspace_id, user_id, version_number, content, metadata_json)
          VALUES (
            @document_id,
            @workspace_id,
            @user_id,
            ISNULL((SELECT MAX(version_number) + 1 FROM aiw_document_versions WHERE document_id = @document_id), 1),
            @content,
            @metadata_json
          )
        `);

        const update = new sql.Request(transaction);
        this.bindDocumentInputs(update, p, input.content, descriptor.contentType, descriptor.contentEncoding, metadata);
        update.input("id", sql.UniqueIdentifier, existing.id);
        await update.query(`
          UPDATE aiw_documents
          SET content = @content,
              content_type = @content_type,
              metadata_json = @metadata_json,
              object_type = @object_type,
              object_id = @object_id,
              layer = @layer,
              title = @title,
              updated_at = SYSUTCDATETIME()
          WHERE id = @id
        `);
      } else {
        const insert = new sql.Request(transaction);
        insert.input("workspace_id", sql.NVarChar(128), this.context.workspaceId);
        insert.input("user_id", sql.NVarChar(128), this.context.userId);
        this.bindDocumentInputs(insert, p, input.content, descriptor.contentType, descriptor.contentEncoding, metadata);
        await insert.query(`
          INSERT INTO aiw_documents (workspace_id, user_id, path, content, content_type, metadata_json, object_type, object_id, layer, title)
          VALUES (@workspace_id, @user_id, @path, @content, @content_type, @metadata_json, @object_type, @object_id, @layer, @title)
        `);
      }

      await transaction.commit();
      return { path: p, created, updatedAt: now };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async createContent(input: CreateContentInput): Promise<CreateContentResult> {
    const p = normalizeWorkspacePath(input.path);
    const request = (await this.pool()).request();
    request.input("workspace_id", sql.NVarChar(128), this.context.workspaceId);
    request.input("user_id", sql.NVarChar(128), this.context.userId);
    request.input("path", sql.NVarChar(1000), p);
    const found = await request.query(`
      SELECT 1 FROM aiw_documents WHERE workspace_id = @workspace_id AND user_id = @user_id AND path = @path AND deleted_at IS NULL
    `);
    if (found.recordset.length) throw new AiwError("CONFLICT", "Content path already exists", { path: p });
    const result = await this.writeContent(input);
    return { path: result.path, created: true, updatedAt: result.updatedAt };
  }

  async deleteContent(input: DeleteContentInput): Promise<DeleteContentResult> {
    const p = normalizeWorkspacePath(input.path);
    const request = (await this.pool()).request();
    request.input("workspace_id", sql.NVarChar(128), this.context.workspaceId);
    request.input("user_id", sql.NVarChar(128), this.context.userId);
    request.input("path", sql.NVarChar(1000), p);
    request.input("reason", sql.NVarChar(500), input.reason ?? null);
    const result = await request.query(`
      UPDATE aiw_documents
      SET deleted_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME(), metadata_json = JSON_MODIFY(ISNULL(metadata_json, '{}'), '$.deleteReason', @reason)
      WHERE workspace_id = @workspace_id AND user_id = @user_id AND path = @path AND deleted_at IS NULL;
      SELECT @@ROWCOUNT AS count;
    `);
    const count = result.recordset[0]?.count ?? 0;
    if (!count) throw new AiwError("NOT_FOUND", "Content path not found", { path: p });
    return { path: p, deleted: true, deletedAt: new Date().toISOString() };
  }

  async resolveObject(input: ResolveObjectInput): Promise<ResolvedObject[]> {
    const normalized = normalizeName(input.query);
    const request = (await this.pool()).request();
    request.input("workspace_id", sql.NVarChar(128), this.context.workspaceId);
    request.input("user_id", sql.NVarChar(128), this.context.userId);
    request.input("query", sql.NVarChar(500), normalized);
    request.input("query_like", sql.NVarChar(500), `${escapeLike(normalized)}%`);
    request.input("limit", sql.Int, input.limit ?? 10);
    if (input.objectType) request.input("object_type", sql.NVarChar(100), input.objectType);
    const typeFilter = input.objectType ? "AND o.object_type = @object_type" : "";
    const result = await request.query(`
      SELECT TOP (@limit)
        o.object_type,
        o.object_id,
        o.display_name,
        o.metadata_json,
        CASE WHEN o.normalized_name = @query THEN 1.0 ELSE 0.8 END AS score
      FROM aiw_objects o
      WHERE o.workspace_id = @workspace_id
        AND o.user_id = @user_id
        ${typeFilter}
        AND o.deleted_at IS NULL
        AND (o.normalized_name = @query OR o.normalized_name LIKE @query_like ESCAPE '\\')
      UNION ALL
      SELECT TOP (@limit)
        o.object_type,
        o.object_id,
        o.display_name,
        o.metadata_json,
        0.75 AS score
      FROM aiw_object_aliases a
      JOIN aiw_objects o
        ON o.workspace_id = a.workspace_id
       AND o.user_id = a.user_id
       AND o.object_type = a.object_type
       AND o.object_id = a.object_id
      WHERE a.workspace_id = @workspace_id
        AND a.user_id = @user_id
        ${typeFilter}
        AND a.normalized_alias LIKE @query_like ESCAPE '\\'
        AND o.deleted_at IS NULL
      ORDER BY score DESC
    `);

    return result.recordset.slice(0, input.limit ?? 10).map((r) => ({
      objectType: r.object_type,
      objectId: r.object_id,
      displayName: r.display_name,
      canonicalPath: canonicalObjectPath(r.object_type, r.object_id),
      score: Number(r.score),
      layers: defaultLayerPaths(r.object_type, r.object_id),
      metadata: parseJson(r.metadata_json)
    }));
  }

  async close(): Promise<void> {
    if (this.poolPromise) await (await this.poolPromise).close();
  }

  private async pool(): Promise<sql.ConnectionPool> {
    if (!this.poolPromise) {
      this.poolPromise = sql.connect(this.context.mssqlConnectionString!);
    }
    return this.poolPromise;
  }

  private bindDocumentInputs(request: sql.Request, p: string, content: string, contentType: string, contentEncoding: ContentEncoding, metadata: Record<string, unknown>): void {
    request.input("path", sql.NVarChar(1000), p);
    request.input("content", sql.NVarChar(sql.MAX), content);
    request.input("content_type", sql.NVarChar(100), contentType);
    request.input("metadata_json", sql.NVarChar(sql.MAX), JSON.stringify(serializeStoredMetadata(metadata, contentEncoding)));
    request.input("object_type", sql.NVarChar(100), typeof metadata.objectType === "string" ? metadata.objectType : null);
    request.input("object_id", sql.NVarChar(200), typeof metadata.objectId === "string" ? metadata.objectId : null);
    request.input("layer", sql.NVarChar(100), typeof metadata.layer === "string" ? metadata.layer : null);
    request.input("title", sql.NVarChar(500), typeof metadata.title === "string" ? metadata.title : null);
  }
}

function parseJson(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try { return JSON.parse(value); } catch { return {}; }
}

function parseStoredMetadata(value: string | null | undefined): { metadata: Record<string, unknown>; contentEncoding?: ContentEncoding } {
  const metadata = parseJson(value);
  const contentEncoding = typeof metadata[CONTENT_ENCODING_METADATA_KEY] === "string"
    ? metadata[CONTENT_ENCODING_METADATA_KEY] as ContentEncoding
    : undefined;
  delete metadata[CONTENT_ENCODING_METADATA_KEY];
  return { metadata, contentEncoding };
}

function serializeStoredMetadata(metadata: Record<string, unknown>, contentEncoding: ContentEncoding): Record<string, unknown> {
  if (contentEncoding === "utf8") return { ...metadata };
  return { ...metadata, [CONTENT_ENCODING_METADATA_KEY]: contentEncoding };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_\[]/g, (m) => `\\${m}`);
}
