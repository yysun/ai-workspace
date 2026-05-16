/*
 * Feature: targeted tests for package-bundled skill discovery.
 * Notes: verifies llm-runtime can load a skill from the package root skills/ directory.
 * Recent changes: updated to reflect removal of workspace-mounted skill roots; only PACKAGE_ROOT/skills is now registered.
 */

import assert from "node:assert/strict";
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

test("load_skill resolves a skill from the package root skills/ directory", async () => {
  const environment = createRuntime(createEnvironmentOptions(baseEnv, "/workspace"));

  try {
    const tools = await resolveToolsAsync({
      environment,
      builtIns: createBuiltInSelection()
    });

    const result = await tools.load_skill?.execute?.({
      skill_id: "crm-skill"
    });

    assert.equal(typeof result, "string");
    const normalizedResult = String(result).replaceAll("\\", "/");
    assert.match(normalizedResult, /<skill_context id="crm-skill">/);
    assert.match(normalizedResult, /<skill_root>.*\/skills\/crm-skill<\/skill_root>/);
  } finally {
    await environment.dispose().catch(() => undefined);
  }
});