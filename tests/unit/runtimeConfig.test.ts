/*
 * Feature: unit tests for llm-runtime request configuration helpers.
 * Notes: verifies prompt composition and generic LLM_* defaults without requiring live provider calls.
 * Recent changes: verifies the built-in read_file is disabled so the host-owned cached replacement can be registered.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { BUILT_IN_TOOL_NAMES, normalizeBuiltInToolSelection } from "llm-runtime";
import {
  buildRuntimeMessages,
  composeSystemPrompt,
  createBuiltInSelection,
  createEnvironmentOptions,
  createProviderConfigs,
  describeRuntimeDefaults,
  resolveMaxIterations,
  resolveMaxTokens,
  resolveRuntimeTarget,
  resolveTemperature
} from "../../src/runtime/runtimeConfig.js";
import { loadEnv } from "../../src/config/env.js";
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
  const prompt = composeSystemPrompt("Always cite the workspace policy.", {
    userId: "3"
  });

  assert.match(prompt, /You are a workspace agent running inside ai-workspace\./);
  assert.match(prompt, /Prefer workspace evidence over speculation/);
  assert.match(prompt, /Runtime user context:/);
  assert.match(prompt, /User ID: 3/);
  assert.doesNotMatch(prompt, /Workspace root:/);
  assert.doesNotMatch(prompt, /User root:/);
  assert.doesNotMatch(prompt, /Tool working directory:/);
  assert.match(prompt, /Do not claim you lack access to workspace information unless a tool result or runtime constraint actually shows that access is unavailable\./);
  assert.match(prompt, /Responses are returned inline by default; pass outputFilePath under the current user's workspace directory only when you want the body saved to disk and the path returned explicitly\./);
  assert.match(prompt, /prefer `workspace_read_file` for workspace file reads; it is host-owned and truncates oversized reads to stay within the token budget\./);
  assert.match(prompt, /For repeatable GET requests, pass cacheTtlMs to enable in-memory caching and bypassCache when you need a refresh\./);
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
    userId: "3",
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
    userId: "3",
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

test("resolveRuntimeTarget allows openai-compatible as the configured default provider", () => {
  const target = resolveRuntimeTarget({
    model: "default",
    messages: [],
    stream: false,
    userId: "3",
    workspaceRoot: "/workspace"
  }, {
    ...baseEnv,
    llmProvider: "openai-compatible",
    openAiApiKey: undefined,
    openAiCompatibleApiKey: "compatible-key",
    openAiCompatibleBaseUrl: "http://127.0.0.1:4010/v1"
  });

  assert.deepEqual(target, {
    provider: "openai-compatible",
    model: "gpt-4.1-mini"
  });
});

test("resolveRuntimeTarget falls back to generic LLM_* provider and model defaults", () => {
  const target = resolveRuntimeTarget({
    model: "default",
    messages: [],
    stream: true,
    userId: "3",
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
    userId: "3",
    workspaceRoot: "/workspace"
  };

  assert.equal(resolveMaxTokens(input, baseEnv), 4096);
  assert.equal(resolveTemperature(input, baseEnv), 0.2);
});

test("resolveMaxIterations prefers explicit iteration limits and falls back to tool-turn limits", () => {
  assert.equal(resolveMaxIterations(baseEnv), undefined);
  assert.equal(resolveMaxIterations({
    ...baseEnv,
    llmMaxConsecutiveToolTurns: 50
  }), 50);
  assert.equal(resolveMaxIterations({
    ...baseEnv,
    llmMaxIterations: 60,
    llmMaxConsecutiveToolTurns: 50
  }), 60);
});

test("createBuiltInSelection disables load_skill", () => {
  const selection = createBuiltInSelection();
  const normalized = normalizeBuiltInToolSelection(selection);
  const disabledTools = new Set(["load_skill", "web_fetch", "read_file"]);

  for (const toolName of BUILT_IN_TOOL_NAMES) {
    assert.equal(normalized[toolName], !disabledTools.has(toolName));
  }
});

test("createEnvironmentOptions only configures provider defaults", () => {
  const options = createEnvironmentOptions(baseEnv, "/workspace");

  assert.equal(options.skillRoots, undefined);
  assert.deepEqual(options.defaults, {
    reasoningEffort: baseEnv.llmReasoning,
    toolPermission: baseEnv.llmPermission
  });
});

test("createProviderConfigs includes openai-compatible configuration", () => {
  assert.deepEqual(createProviderConfigs({
    ...baseEnv,
    openAiCompatibleApiKey: "compatible-key",
    openAiCompatibleBaseUrl: "http://127.0.0.1:4010/v1"
  })["openai-compatible"], {
    apiKey: "compatible-key",
    baseUrl: "http://127.0.0.1:4010/v1"
  });
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

test("loadEnv parses LLM_MAX_WALL_TIME_MS as a positive integer override", () => {
  const env = loadEnv({
    PORT: "3000",
    WORKSPACE_ROOT: "/workspace",
    LLM_MAX_WALL_TIME_MS: "900000"
  });

  assert.equal(env.llmMaxWallTimeMs, 900000);
});

test("loadEnv parses LLM_MAX_ITERATIONS and MAX_ITERATIONS aliases", () => {
  assert.equal(loadEnv({
    PORT: "3000",
    WORKSPACE_ROOT: "/workspace",
    LLM_MAX_ITERATIONS: "50"
  }).llmMaxIterations, 50);

  assert.equal(loadEnv({
    PORT: "3000",
    WORKSPACE_ROOT: "/workspace",
    MAX_ITERATIONS: "60"
  }).llmMaxIterations, 60);
});