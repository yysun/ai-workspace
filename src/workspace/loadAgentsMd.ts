/*
 * Feature: AGENTS.md loader for per-request workspace instruction enrichment.
 * Notes: returns null when the instruction file is absent so callers can stay tolerant.
 * Recent changes: restored the workspace instruction loader after the runtime refactor.
 */

import { access, readFile } from "node:fs/promises";
import path from "node:path";

export async function loadAgentsMd(workspaceRoot: string): Promise<string | null> {
  const agentsPath = path.join(workspaceRoot, "AGENTS.md");

  try {
    await access(agentsPath);
  } catch {
    return null;
  }

  return readFile(agentsPath, "utf8");
}