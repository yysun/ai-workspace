/*
 * Feature: unit coverage for llm-runtime orchestration helpers.
 * Notes: verifies local guardrails around accepted text responses without calling a provider.
 * Recent changes: added coverage for post-tool action-evidence handling.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  isPendingHumanInputToolResult,
  prepareToolCallArguments,
  redactToolResultForEvent,
  shouldRequireActionEvidence
} from "../../src/runtime/runChatCompletion.js";

test("shouldRequireActionEvidence stops requiring action evidence after tool activity", () => {
  assert.equal(shouldRequireActionEvidence({ finalText: "" }, false), true);
  assert.equal(shouldRequireActionEvidence({ finalText: "" }, true), false);
  assert.equal(shouldRequireActionEvidence({ finalText: "Verified final answer." }, false), false);
});

test("prepareToolCallArguments expands shell env references for execution", () => {
  const prepared = prepareToolCallArguments("shell_cmd", {
    command: "curl",
    parameters: [
      "-H",
      "Authorization: Bearer $API_ACCESS_TOKEN",
      "${API_BASE_URL}/records?search=example"
    ],
    timeout: 200000
  }, {
    API_ACCESS_TOKEN: "secret-token-value",
    API_BASE_URL: "https://api.example.test"
  });

  assert.deepEqual(prepared.executionArgs, {
    command: "curl",
    parameters: [
      "-H",
      "Authorization: Bearer secret-token-value",
      "https://api.example.test/records?search=example"
    ],
    timeout: 200000
  });

  assert.deepEqual(prepared.eventArgs, {
    command: "curl",
    parameters: [
      "-H",
      "Authorization: Bearer [redacted:$API_ACCESS_TOKEN]",
      "https://api.example.test/records?search=example"
    ],
    timeout: 200000
  });
});

test("prepareToolCallArguments leaves unresolved shell env references intact", () => {
  const prepared = prepareToolCallArguments("shell_cmd", {
    command: "curl",
    parameters: ["$MISSING_API_BASE_URL/records"]
  }, {});

  assert.deepEqual(prepared.executionArgs, {
    command: "curl",
    parameters: ["$MISSING_API_BASE_URL/records"]
  });
  assert.deepEqual(prepared.eventArgs, prepared.executionArgs);
});

test("redactToolResultForEvent redacts secrets recursively and prefers longer overlapping values", () => {
  assert.deepEqual(redactToolResultForEvent({
    stdout: "Authorization failed for abcd1234 with fallback abcd.",
    nested: ["token abcd1234", { stderr: "plain abcd" }],
    count: 1
  }, {
    API_KEY: "abcd",
    API_TOKEN: "abcd1234"
  }), {
    stdout: "Authorization failed for [redacted:$API_TOKEN] with fallback [redacted:$API_KEY].",
    nested: ["token [redacted:$API_TOKEN]", { stderr: "plain [redacted:$API_KEY]" }],
    count: 1
  });
});

test("isPendingHumanInputToolResult recognizes pending human-input artifacts", () => {
  assert.equal(isPendingHumanInputToolResult("ask_user_input", {
    pending: true,
    status: "pending",
    requestId: "call_123"
  }), true);

  assert.equal(isPendingHumanInputToolResult("human_intervention_request", {
    pending: true,
    status: "pending"
  }), true);

  assert.equal(isPendingHumanInputToolResult("ask_user_input", {
    pending: false,
    status: "completed"
  }), false);

  assert.equal(isPendingHumanInputToolResult("shell_cmd", {
    pending: true,
    status: "pending"
  }), false);
});