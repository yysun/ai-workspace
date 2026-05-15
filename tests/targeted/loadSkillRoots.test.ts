/*
 * Feature: targeted tests for workspace skill-root discovery.
 * Notes: verifies llm-runtime can load a skill from the hidden .agents/skills workspace root.
 * Recent changes: added regression coverage for dual skill-root support.
 */

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createRuntime, resolveToolsAsync } from "llm-runtime";
import type { EnvConfig } from "../../src/config/env.js";
import { createBuiltInSelection, createEnvironmentOptions } from "../../src/runtime/runtimeConfig.js";

const baseEnv: EnvConfig = {
  port: 3000,
  workspaceRoot: "/workspace",
  llmPermission: "auto",
  llmReasoning: "medium"
};

test("load_skill resolves a skill from .agents/skills", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "ai-workspace-skill-roots-"));
  const skillRoot = path.join(workspaceRoot, ".agents", "skills", "api-lookup");
  await mkdir(skillRoot, { recursive: true });
  await writeFile(path.join(skillRoot, "SKILL.md"), [
    "---",
    "name: api-lookup",
    "description: Resolve API lookups.",
    "---",
    "Use this skill to resolve API records from the hidden workspace skill root."
  ].join("\n"));

  const environment = createRuntime(createEnvironmentOptions(baseEnv, workspaceRoot));

  try {
    const tools = await resolveToolsAsync({
      environment,
      builtIns: createBuiltInSelection()
    });

    const result = await tools.load_skill?.execute?.({
      skill_id: "api-lookup"
    });

    assert.equal(typeof result, "string");
    const normalizedResult = String(result).replaceAll("\\", "/");
    assert.match(normalizedResult, /<skill_context id="api-lookup">/);
    assert.match(normalizedResult, /<description>Resolve API lookups\.<\/description>/);
    assert.match(normalizedResult, /<skill_root>.*\/.agents\/skills\/api-lookup<\/skill_root>/);
  } finally {
    await environment.dispose().catch(() => undefined);
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});