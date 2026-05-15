/*
 * Feature: workspace-local .env bootstrap for runtime-visible variables.
 * Notes: reads `${WORKSPACE_ROOT}/.env` and merges variables into a target env object.
 * Recent changes: added support for workspace-scoped variables like CRM_BASE_URL.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";

type LoadWorkspaceEnvOptions = {
  target?: NodeJS.ProcessEnv;
  override?: boolean;
};

export type AppliedWorkspaceEnv = {
  parsed: Record<string, string>;
  restore: () => void;
};

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "ENOENT";
}

async function readWorkspaceEnvFile(workspaceRoot: string): Promise<Record<string, string>> {
  const envPath = path.join(workspaceRoot, ".env");
  let rawEnv: string;

  try {
    rawEnv = await readFile(envPath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return {};
    }

    throw error;
  }

  return dotenv.parse(rawEnv);
}

function applyParsedEnv(
  parsed: Record<string, string>,
  target: NodeJS.ProcessEnv,
  override: boolean
): Map<string, string | undefined> {
  const previousValues = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(parsed)) {
    if (!override && target[key] !== undefined) {
      continue;
    }

    previousValues.set(key, target[key]);
    target[key] = value;
  }

  return previousValues;
}

function restoreParsedEnv(target: NodeJS.ProcessEnv, previousValues: Map<string, string | undefined>): void {
  for (const [key, value] of previousValues.entries()) {
    if (value === undefined) {
      delete target[key];
      continue;
    }

    target[key] = value;
  }
}

export async function loadWorkspaceEnv(
  workspaceRoot: string,
  options: LoadWorkspaceEnvOptions = {}
): Promise<Record<string, string>> {
  const target = options.target ?? process.env;
  const override = options.override ?? false;
  const parsed = await readWorkspaceEnvFile(workspaceRoot);

  applyParsedEnv(parsed, target, override);

  return parsed;
}

export async function applyWorkspaceEnv(
  workspaceRoot: string,
  options: LoadWorkspaceEnvOptions = {}
): Promise<AppliedWorkspaceEnv> {
  const target = options.target ?? process.env;
  const override = options.override ?? false;
  const parsed = await readWorkspaceEnvFile(workspaceRoot);
  const previousValues = applyParsedEnv(parsed, target, override);

  return {
    parsed,
    restore: () => {
      restoreParsedEnv(target, previousValues);
    }
  };
}