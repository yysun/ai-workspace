import "dotenv/config";
import { AiwError, type StorageType, type WorkspaceContext } from "../types.js";
import { resolveToolWorkspaceRoot } from "../../workspace/resolveWorkspace.js";

export interface CreateContextOptions {
  envSource?: NodeJS.ProcessEnv;
  storage?: StorageType;
  workspaceId?: string;
  userId?: string;
  fileRoot?: string;
  mssqlConnectionString?: string;
}

export function createWorkspaceContext(options: CreateContextOptions = {}): WorkspaceContext {
  const envSource = options.envSource ?? process.env;
  const storage = options.storage ?? resolveStorageType(envSource.AIW_STORAGE);
  const workspaceId = options.workspaceId ?? envSource.AIW_WORKSPACE_ID ?? "local";
  const userId = trimRequiredUserId(options.userId ?? envSource.AIW_USER_ID);

  const context: WorkspaceContext = {
    storage,
    workspaceId,
    userId,
    fileRoot: resolveToolWorkspaceRoot({
      workspaceRoot: options.fileRoot ?? envSource.WORKSPACE_ROOT,
      userId,
      defaultRoot: "./aiw-workspace"
    }),
    mssqlConnectionString: options.mssqlConnectionString ?? envSource.AIW_MSSQL_CONNECTION_STRING
  };

  if (storage === "mssql" && !context.mssqlConnectionString) {
    throw new AiwError("INVALID_INPUT", "AIW_MSSQL_CONNECTION_STRING is required for mssql storage");
  }

  return context;
}

export function resolveStorageType(value: string | undefined): StorageType {
  const normalized = value ?? "file";

  return parseStorage(normalized);
}

export function formatStorageTypeForLog(storage: StorageType): "file" | "sql server" {
  return storage === "mssql" ? "sql server" : "file";
}

function parseStorage(value: string): StorageType {
  if (value === "file" || value === "mssql") return value;
  throw new AiwError("INVALID_INPUT", `Unsupported AIW_STORAGE: ${value}`);
}

function trimRequiredUserId(value: string | undefined): string {
  const userId = value?.trim();
  if (!userId) {
    throw new AiwError("INVALID_INPUT", "userId is required for AIW storage");
  }

  return userId;
}
