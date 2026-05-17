export type StorageType = "file" | "mssql";

export type ContentType = "text/markdown" | "application/json" | "text/plain" | string;
export type ContentEncoding = "utf8" | "base64";

export type AiwMetadata = Record<string, unknown> & {
  objectType?: string;
  objectId?: string;
  layer?: string;
  title?: string;
};

export interface WorkspaceContext {
  storage: StorageType;
  workspaceId: string;
  userId: string;
  fileRoot?: string;
  mssqlConnectionString?: string;
}

export interface ContentSearchInput {
  query: string;
  pathPrefix?: string;
  objectType?: string;
  objectId?: string;
  layer?: string;
  limit?: number;
}

export interface ContentSearchResult {
  path: string;
  title?: string | null;
  snippet?: string | null;
  objectType?: string | null;
  objectId?: string | null;
  layer?: string | null;
  updatedAt?: string | null;
  score?: number | null;
}

export interface ListContentInput {
  path: string;
  limit?: number;
}

export interface ListContentResult {
  path: string;
  type: "content" | "prefix";
  title?: string | null;
  layer?: string | null;
  updatedAt?: string | null;
}

export interface ReadContentInput {
  path: string;
}

export interface ReadContentResult {
  path: string;
  content: string;
  contentType: ContentType;
  contentEncoding: ContentEncoding;
  metadata: AiwMetadata;
  updatedAt?: string | null;
}

export interface WriteContentInput {
  path: string;
  content: string;
  contentType?: ContentType;
  contentEncoding?: ContentEncoding;
  metadata?: AiwMetadata;
}

export interface WriteContentResult {
  path: string;
  created: boolean;
  updatedAt: string;
}

export interface CreateContentInput extends WriteContentInput { }

export interface CreateContentResult {
  path: string;
  created: true;
  updatedAt: string;
}

export interface DeleteContentInput {
  path: string;
  reason?: string;
}

export interface DeleteContentResult {
  path: string;
  deleted: boolean;
  deletedAt: string;
}

export interface ResolveObjectInput {
  query: string;
  objectType?: string;
  limit?: number;
}

export interface ResolvedObject {
  objectType: string;
  objectId: string;
  displayName: string;
  canonicalPath: string;
  score: number;
  layers: Record<string, string>;
  metadata?: AiwMetadata;
}

export interface WorkspaceProvider {
  searchContent(input: ContentSearchInput): Promise<ContentSearchResult[]>;
  listContent(input: ListContentInput): Promise<ListContentResult[]>;
  readContent(input: ReadContentInput): Promise<ReadContentResult>;
  writeContent(input: WriteContentInput): Promise<WriteContentResult>;
  createContent(input: CreateContentInput): Promise<CreateContentResult>;
  deleteContent(input: DeleteContentInput): Promise<DeleteContentResult>;
  resolveObject(input: ResolveObjectInput): Promise<ResolvedObject[]>;
  doctor(): Promise<Record<string, unknown>>;
  close?(): Promise<void>;
}

export class AiwError extends Error {
  constructor(
    public code: "NOT_FOUND" | "CONFLICT" | "INVALID_INPUT" | "PERMISSION_DENIED" | "BACKEND_ERROR",
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AiwError";
  }
}
