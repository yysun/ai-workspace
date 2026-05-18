/*
 * Feature: host-owned Marp CLI rendering tool for workspace runtime requests.
 * Notes: renders Markdown slide decks into workspace output files with workspace-bound path guards and deterministic CLI flags.
 * Recent changes: initial tool implementation for HTML, PDF, PPTX, and notes rendering through the locally installed marp-cli package.
 */

import { execFile as execFileCallback } from "node:child_process";
import { mkdir, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import type { Stats } from "node:fs";
import type { LLMToolDefinition, LLMToolExecutionContext } from "llm-runtime";

export const MARP_CLI_TOOL_NAME = "marp_cli";

const require = createRequire(import.meta.url);
const execFile = promisify(execFileCallback);
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdown", ".mkd"]);
const OUTPUT_EXTENSION_FORMATS = new Map<string, MarpOutputFormat>([
  [".html", "html"],
  [".htm", "html"],
  [".pdf", "pdf"],
  [".pptx", "pptx"],
  [".txt", "notes"]
]);
const FORMAT_FLAGS: Partial<Record<MarpOutputFormat, string>> = {
  pdf: "--pdf",
  pptx: "--pptx",
  notes: "--notes"
};

type MarpOutputFormat = "html" | "pdf" | "pptx" | "notes";

type ExecFileResult = {
  stdout: string;
  stderr: string;
};

type ExecFileImpl = (
  file: string,
  args: string[],
  options: {
    cwd: string;
    signal?: AbortSignal;
    maxBuffer: number;
  }
) => Promise<ExecFileResult>;

type MarpCliToolOptions = {
  workspaceRoot: string;
  binaryPath?: string;
  execFileImpl?: ExecFileImpl;
  realpathImpl?: (filePath: string) => Promise<string>;
  statImpl?: (filePath: string) => Promise<Stats>;
};

function trimRequiredPath(value: unknown, fieldName: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    throw new Error(`marp_cli requires ${fieldName}`);
  }

  return trimmed;
}

function trimOptionalPath(value: unknown): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || undefined;
}

function isPathInside(parentPath: string, childPath: string): boolean {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function formatToFlag(format: MarpOutputFormat): string | undefined {
  return FORMAT_FLAGS[format];
}

function normalizeFormat(value: unknown, outputFilePath: string): MarpOutputFormat {
  const explicitFormat = typeof value === "string" ? value.trim().toLowerCase() : "";
  const inferredFormat = OUTPUT_EXTENSION_FORMATS.get(path.extname(outputFilePath).toLowerCase());

  if (explicitFormat) {
    if (explicitFormat !== "html" && explicitFormat !== "pdf" && explicitFormat !== "pptx" && explicitFormat !== "notes") {
      throw new Error("marp_cli format must be one of: html, pdf, pptx, notes");
    }

    if (inferredFormat && inferredFormat !== explicitFormat) {
      throw new Error(`marp_cli outputFilePath extension must match format ${explicitFormat}`);
    }

    return explicitFormat;
  }

  if (inferredFormat) {
    return inferredFormat;
  }

  throw new Error("marp_cli could not infer format from outputFilePath; use .html, .pdf, .pptx, or .txt, or provide format explicitly");
}

function assertMarkdownPath(filePath: string): void {
  if (!MARKDOWN_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    throw new Error("marp_cli markdownPath must point to a Markdown file");
  }
}

async function resolveExistingPathRealPath(candidatePath: string, realpathImpl: (filePath: string) => Promise<string>): Promise<string | null> {
  try {
    return await realpathImpl(candidatePath);
  } catch (error) {
    if (toNodeErrorCode(error) === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function resolveNearestExistingParentRealPath(candidatePath: string, realpathImpl: (filePath: string) => Promise<string>): Promise<string> {
  let currentPath = path.dirname(candidatePath);

  while (true) {
    try {
      return await realpathImpl(currentPath);
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

async function resolveNearestExistingParent(
  candidatePath: string,
  realpathImpl: (filePath: string) => Promise<string>
): Promise<{ path: string; realPath: string }> {
  let currentPath = path.dirname(candidatePath);

  while (true) {
    try {
      return {
        path: currentPath,
        realPath: await realpathImpl(currentPath)
      };
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

async function resolveExistingWorkspaceFilePath(
  workspaceRootPath: string,
  workspaceRootRealPathPromise: Promise<string>,
  requestedPath: string,
  fieldName: string,
  realpathImpl: (filePath: string) => Promise<string>,
  statImpl: (filePath: string) => Promise<Stats>
): Promise<string> {
  const candidatePath = path.isAbsolute(requestedPath)
    ? path.resolve(requestedPath)
    : path.resolve(workspaceRootPath, requestedPath);

  if (!isPathInside(workspaceRootPath, candidatePath)) {
    throw new Error(`marp_cli ${fieldName} must stay within the workspace root`);
  }

  const resolvedPath = await realpathImpl(candidatePath);
  const workspaceRootRealPath = await workspaceRootRealPathPromise;
  if (!isPathInside(workspaceRootRealPath, resolvedPath)) {
    throw new Error(`marp_cli ${fieldName} must stay within the workspace root`);
  }

  const fileStats = await statImpl(resolvedPath);
  if (!fileStats.isFile()) {
    throw new Error(`marp_cli ${fieldName} must be a regular file`);
  }

  return resolvedPath;
}

async function resolveWorkspaceOutputPath(
  workspaceRootPath: string,
  workspaceRootRealPathPromise: Promise<string>,
  requestedPath: string,
  realpathImpl: (filePath: string) => Promise<string>
): Promise<string> {
  const candidatePath = path.isAbsolute(requestedPath)
    ? path.resolve(requestedPath)
    : path.resolve(workspaceRootPath, requestedPath);

  if (!isPathInside(workspaceRootPath, candidatePath)) {
    throw new Error("marp_cli outputFilePath must stay within the workspace root");
  }

  const workspaceRootRealPath = await workspaceRootRealPathPromise;
  const existingTargetRealPath = await resolveExistingPathRealPath(candidatePath, realpathImpl);
  if (existingTargetRealPath) {
    if (!isPathInside(workspaceRootRealPath, existingTargetRealPath)) {
      throw new Error("marp_cli outputFilePath must stay within the workspace root");
    }

    return existingTargetRealPath;
  }

  const existingParent = await resolveNearestExistingParent(candidatePath, realpathImpl);
  if (!isPathInside(workspaceRootRealPath, existingParent.realPath)) {
    throw new Error("marp_cli outputFilePath must stay within the workspace root");
  }

  return path.join(existingParent.realPath, path.relative(existingParent.path, candidatePath));
}

function toWorkspaceRelativePath(workspaceRoot: string, filePath: string, workspaceRootRealPath?: string): string {
  const basePath = isPathInside(workspaceRoot, filePath)
    ? workspaceRoot
    : workspaceRootRealPath && isPathInside(workspaceRootRealPath, filePath)
      ? workspaceRootRealPath
      : workspaceRoot;
  const relativePath = path.relative(basePath, filePath);
  return relativePath === "" ? "." : relativePath.split(path.sep).join("/");
}

function toNodeErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function readExecErrorText(error: unknown): string | null {
  if (typeof error === "object" && error !== null) {
    const stderr = "stderr" in error && typeof error.stderr === "string" ? error.stderr.trim() : "";
    if (stderr) {
      return stderr;
    }
  }

  if (error instanceof Error) {
    return error.message.trim();
  }

  if (typeof error === "string") {
    return error.trim();
  }

  return null;
}

function normalizeMarpError(error: unknown, requestedPath: string): Error {
  if (error instanceof Error && error.name === "AbortError") {
    return new Error(`marp_cli aborted while rendering ${requestedPath}`);
  }

  switch (toNodeErrorCode(error)) {
    case "ENOENT":
      return new Error(`marp_cli could not find ${requestedPath}`);
    default: {
      const detail = readExecErrorText(error);
      return new Error(detail
        ? `marp_cli failed for ${requestedPath}: ${detail.split(/\r?\n/, 1)[0]}`
        : `marp_cli failed for ${requestedPath}`);
    }
  }
}

function resolveMarpCliBinaryPath(overridePath: string | undefined): string {
  if (overridePath?.trim()) {
    return overridePath;
  }

  return path.join(path.dirname(require.resolve("@marp-team/marp-cli/package.json")), "marp-cli.js");
}

async function executeMarpCli(
  workspaceRootPath: string,
  workspaceRootRealPathPromise: Promise<string>,
  binaryPath: string,
  args: Record<string, unknown>,
  context: LLMToolExecutionContext | undefined,
  execFileImpl: ExecFileImpl,
  realpathImpl: (filePath: string) => Promise<string>,
  statImpl: (filePath: string) => Promise<Stats>
): Promise<unknown> {
  const requestedMarkdownPath = trimRequiredPath(args.markdownPath, "markdownPath");
  const requestedOutputFilePath = trimRequiredPath(args.outputFilePath, "outputFilePath");
  const requestedConfigFilePath = trimOptionalPath(args.configFilePath);
  const allowLocalFiles = args.allowLocalFiles === true;
  const format = normalizeFormat(args.format, requestedOutputFilePath);

  const resolvedMarkdownPath = await resolveExistingWorkspaceFilePath(
    workspaceRootPath,
    workspaceRootRealPathPromise,
    requestedMarkdownPath,
    "markdownPath",
    realpathImpl,
    statImpl
  );
  assertMarkdownPath(resolvedMarkdownPath);

  const resolvedOutputPath = await resolveWorkspaceOutputPath(
    workspaceRootPath,
    workspaceRootRealPathPromise,
    requestedOutputFilePath,
    realpathImpl
  );
  const workspaceRootRealPath = await workspaceRootRealPathPromise;

  const resolvedConfigFilePath = requestedConfigFilePath
    ? await resolveExistingWorkspaceFilePath(
      workspaceRootPath,
      workspaceRootRealPathPromise,
      requestedConfigFilePath,
      "configFilePath",
      realpathImpl,
      statImpl
    )
    : undefined;

  await mkdir(path.dirname(resolvedOutputPath), { recursive: true });

  const marpArgs = [binaryPath];
  if (resolvedConfigFilePath) {
    marpArgs.push("--config-file", resolvedConfigFilePath);
  } else {
    marpArgs.push("--no-config-file");
  }

  const formatFlag = formatToFlag(format);
  if (formatFlag) {
    marpArgs.push(formatFlag);
  }

  if (allowLocalFiles) {
    marpArgs.push("--allow-local-files");
  }

  marpArgs.push("--output", resolvedOutputPath, resolvedMarkdownPath);

  try {
    const { stdout, stderr } = await execFileImpl(process.execPath, marpArgs, {
      cwd: workspaceRootRealPath,
      signal: context?.abortSignal,
      maxBuffer: DEFAULT_MAX_BUFFER
    });
    const outputStats = await statImpl(resolvedOutputPath);

    return {
      ok: true,
      format,
      markdownPath: toWorkspaceRelativePath(workspaceRootPath, resolvedMarkdownPath, workspaceRootRealPath),
      outputFilePath: toWorkspaceRelativePath(workspaceRootPath, resolvedOutputPath, workspaceRootRealPath),
      bytesWritten: outputStats.size,
      message: `rendered ${format} to ${toWorkspaceRelativePath(workspaceRootPath, resolvedOutputPath, workspaceRootRealPath)}`,
      ...(stdout.trim() ? { stdout: stdout.trim() } : {}),
      ...(stderr.trim() ? { warnings: stderr.trim() } : {})
    };
  } catch (error) {
    throw normalizeMarpError(error, requestedMarkdownPath);
  }
}

export function createMarpCliTool(options: MarpCliToolOptions): LLMToolDefinition {
  const workspaceRootPath = path.resolve(options.workspaceRoot);
  const realpathImpl = options.realpathImpl ?? realpath;
  const statImpl = options.statImpl ?? stat;
  const workspaceRootRealPathPromise = realpathImpl(workspaceRootPath).catch(() => workspaceRootPath);
  const binaryPath = resolveMarpCliBinaryPath(options.binaryPath);
  const execFileImpl = options.execFileImpl ?? execFile;

  return {
    name: MARP_CLI_TOOL_NAME,
    description: "Render a Markdown slide deck in the current workspace into HTML, PDF, PPTX, or notes text using the locally installed Marp CLI.",
    evidenceKind: "write",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        markdownPath: {
          type: "string",
          description: "Relative or absolute path to an existing Markdown slide deck inside the current workspace."
        },
        outputFilePath: {
          type: "string",
          description: "Relative or absolute path inside the current workspace where the rendered output file should be written."
        },
        format: {
          type: "string",
          description: "Optional output format. When omitted, the tool infers it from outputFilePath.",
          enum: ["html", "pdf", "pptx", "notes"]
        },
        configFilePath: {
          type: "string",
          description: "Optional Marp config file path inside the current workspace. When omitted, config discovery is disabled for deterministic execution."
        },
        allowLocalFiles: {
          type: "boolean",
          description: "Optional flag to pass --allow-local-files for deck assets when required by PDF, PPTX, or image-style rendering."
        }
      },
      required: ["markdownPath", "outputFilePath"]
    },
    execute: async (args, context) => await executeMarpCli(
      workspaceRootPath,
      workspaceRootRealPathPromise,
      binaryPath,
      args,
      context,
      execFileImpl,
      realpathImpl,
      statImpl
    )
  };
}