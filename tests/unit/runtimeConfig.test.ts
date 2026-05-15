/*
 * Feature: unit tests for llm-runtime request configuration helpers.
 * Notes: verifies prompt composition and generic LLM_* defaults without requiring live provider calls.
 * Recent changes: moved unit coverage into tests/unit.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRuntimeMessages,
  composeSystemPrompt,
  createBuiltInSelection,
  createEnvironmentOptions,
  describeRuntimeDefaults,
  resolveMaxTokens,
  resolveRuntimeTarget,
  resolveTemperature
} from "../../src/runtime/runtimeConfig.js";
import type { EnvConfig } from "../../src/config/env.js";

const baseEnv: EnvConfig = {
  port: 3000,
  workspaceRoot: "/workspace",
  llmProvider: "openai",
  llmModel: "gpt-4.1-mini",
  llmMaxToken: 4096,
  llmTemperature: 0.2,
  llmPermission: "auto",
  llmReasoning: "medium",
  openAiApiKey: "test-openai-key"
};

test("composeSystemPrompt appends AGENTS.md content to the default system prompt", () => {
  const prompt = composeSystemPrompt("Always cite the workspace policy.");

  assert.match(prompt, /You are a workspace agent running inside ai-workspace\./);
  assert.match(prompt, /Additional workspace instructions:\nAlways cite the workspace policy\./);
});

test("buildRuntimeMessages prepends one system message before user content", () => {
  const messages = buildRuntimeMessages([
    { role: "user", content: "Summarize the workspace." }
  ], "Follow the repo conventions.");

  assert.equal(messages[0]?.role, "system");
  assert.match(messages[0]?.content ?? "", /Follow the repo conventions\./);
  assert.equal(messages[1]?.role, "user");
});

test("resolveRuntimeTarget uses provider-prefixed models when present", () => {
  const target = resolveRuntimeTarget({
    model: "anthropic:claude-3-7-sonnet",
    messages: [],
    stream: false,
    workspaceRoot: "/workspace"
  }, baseEnv);

  assert.deepEqual(target, {
    provider: "anthropic",
    model: "claude-3-7-sonnet"
  });
});

test("resolveRuntimeTarget allows azure as the configured default provider", () => {
  const target = resolveRuntimeTarget({
    model: "default",
    messages: [],
    stream: false,
    workspaceRoot: "/workspace"
  }, {
    ...baseEnv,
    llmProvider: "azure",
    llmModel: "gpt-4.1-mini",
    openAiApiKey: undefined,
    azureOpenAiApiKey: "azure-key",
    azureOpenAiResourceName: "resource-name",
    azureOpenAiDeploymentName: "deployment-name",
    azureOpenAiApiVersion: "2024-10-21"
  });

  assert.deepEqual(target, {
    provider: "azure",
    model: "gpt-4.1-mini"
  });
});

test("resolveRuntimeTarget falls back to generic LLM_* provider and model defaults", () => {
  const target = resolveRuntimeTarget({
    model: "default",
    messages: [],
    stream: true,
    workspaceRoot: "/workspace"
  }, baseEnv);

  assert.deepEqual(target, {
    provider: "openai",
    model: "gpt-4.1-mini"
  });
});

test("resolveMaxTokens and resolveTemperature fall back to generic env defaults", () => {
  const input = {
    messages: [],
    stream: false,
    workspaceRoot: "/workspace"
  };

  assert.equal(resolveMaxTokens(input, baseEnv), 4096);
  assert.equal(resolveTemperature(input, baseEnv), 0.2);
});

test("createBuiltInSelection narrows write access when permission is read", () => {
  const builtIns = createBuiltInSelection({
    ...baseEnv,
    llmPermission: "read"
  }) as Exclude<ReturnType<typeof createBuiltInSelection>, boolean>;

  assert.equal(builtIns.read_file, true);
  assert.equal(builtIns.write_file, false);
  assert.equal(builtIns.shell_cmd, false);
});

test("createEnvironmentOptions loads skills from both workspace skill roots", () => {
  const options = createEnvironmentOptions(baseEnv, "/workspace");

  assert.deepEqual(options.skillRoots, [
    "/workspace/skills",
    "/workspace/.agents/skills"
  ]);
});

test("describeRuntimeDefaults reports generic LLM_* defaults for health output", () => {
  assert.deepEqual(describeRuntimeDefaults(baseEnv), {
    provider: "openai",
    model: "gpt-4.1-mini",
    maxToken: 4096,
    temperature: 0.2,
    permission: "auto",
    reasoning: "medium"
  });
});