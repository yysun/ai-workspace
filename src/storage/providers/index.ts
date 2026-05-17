import { type CreateContextOptions, createWorkspaceContext } from "../utils/config.js";
import { type WorkspaceContext, type WorkspaceProvider } from "../types.js";
import { FileWorkspaceProvider } from "./fileProvider.js";
import { MssqlWorkspaceProvider } from "./mssqlProvider.js";

export function createWorkspaceProvider(options: CreateContextOptions | WorkspaceContext = {}): WorkspaceProvider {
  const context = "workspaceId" in options && "userId" in options && "storage" in options
    ? options as WorkspaceContext
    : createWorkspaceContext(options as CreateContextOptions);

  switch (context.storage) {
    case "file":
      return new FileWorkspaceProvider(context);
    case "mssql":
      return new MssqlWorkspaceProvider(context);
    default:
      throw new Error(`Unsupported storage provider: ${(context as { storage: string }).storage}`);
  }
}

export { FileWorkspaceProvider } from "./fileProvider.js";
export { MssqlWorkspaceProvider } from "./mssqlProvider.js";
