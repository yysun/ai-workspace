/*
 * Feature: targeted tests for workspace AGENTS.md loading.
 * Notes: confirms the repository workspace instructions are read from disk and included in the runtime system prompt.
 * Recent changes: moved targeted AGENTS.md coverage into tests/targeted.
 */

import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildRuntimeMessages } from "../../src/runtime/runtimeConfig.js";
import { loadAgentsMd, loadAgentsMdCache } from "../../src/workspace/loadAgentsMd.js";

const workspaceRoot = fileURLToPath(new URL("../fixtures/workspace", import.meta.url));

test("loadAgentsMdCache returns the resolved AGENTS.md path and cached content", async () => {
  const loaded = await loadAgentsMdCache(workspaceRoot);

  assert.equal(loaded.path, `${workspaceRoot}/AGENTS.md`);
  assert.equal(loaded.content, "Prefer concise answers.\n");
});

test("loadAgentsMd reads workspace AGENTS.md into the runtime system prompt", async () => {
  const agentsMd = await loadAgentsMd(workspaceRoot);
  const messages = buildRuntimeMessages([
    { role: "user", content: "Summarize the workspace." }
  ], agentsMd);

  assert.equal(agentsMd, "Prefer concise answers.\n");
  assert.equal(messages[0]?.role, "system");
  assert.match(messages[0]?.content ?? "", /Additional workspace instructions:\nPrefer concise answers\./);
  assert.equal(messages[1]?.role, "user");
});