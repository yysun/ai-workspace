/*
 * Feature: unit coverage for the streaming test CLI helpers.
 * Notes: verifies SSE frame parsing, runtime event assembly, and in-memory history updates without depending on interactive terminal IO.
 * Recent changes: added regression coverage for chunked SSE parsing and successful turn commits.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  applyStreamEvent,
  consumeAutoContinueBudget,
  commitTurn,
  extractSseEventBlocks,
  formatToolEventLine,
  isReadlineExitError,
  parseSseEventBlock,
  resolveCliOptions,
  shouldAutoContinue
} from "../../src/cli/streamingTestCli.js";

test("resolveCliOptions derives baseUrl and model from args and env", () => {
  const options = resolveCliOptions([
    "--url",
    "http://localhost:4010/",
    "--model=anthropic:claude",
    "--auto-continue",
    "--auto-continue-message=keep going",
    "--auto-continue-turns=2"
  ], {
    PORT: "3000",
    AI_WORKSPACE_BASE_URL: "http://localhost:9999",
    AI_WORKSPACE_MODEL: "default"
  });

  assert.deepEqual(options, {
    baseUrl: "http://localhost:4010",
    model: "anthropic:claude",
    autoContinue: true,
    autoContinueMessage: "keep going",
    autoContinueTurns: 2
  });
});

test("resolveCliOptions falls back to default auto-continue settings", () => {
  const options = resolveCliOptions([], {
    PORT: "3000"
  });

  assert.deepEqual(options, {
    baseUrl: "http://localhost:3000",
    model: "default",
    autoContinue: false,
    autoContinueMessage: "go ahead",
    autoContinueTurns: 1
  });
});

test("consumeAutoContinueBudget uses warning grace turns after normal auto turns are exhausted", () => {
  assert.deepEqual(consumeAutoContinueBudget(1, 2, []), {
    remainingAutoTurns: 0,
    remainingWarningGraceTurns: 2
  });

  assert.deepEqual(consumeAutoContinueBudget(0, 2, [
    "Assistant claimed it was already proceeding, but no tool.call or tool.result events occurred in this turn."
  ]), {
    remainingAutoTurns: 0,
    remainingWarningGraceTurns: 1
  });

  assert.equal(consumeAutoContinueBudget(0, 0, ["warning"]), null);
  assert.equal(consumeAutoContinueBudget(0, 2, []), null);
});

test("isReadlineExitError treats closed and aborted prompts as clean exits", () => {
  assert.equal(isReadlineExitError({ code: "ERR_USE_AFTER_CLOSE" }), true);
  assert.equal(isReadlineExitError({ code: "ABORT_ERR" }), true);
  assert.equal(isReadlineExitError({ code: "SOMETHING_ELSE" }), false);
});

test("extractSseEventBlocks returns completed frames and preserves remainder", () => {
  const parsed = extractSseEventBlocks([
    'event: message.delta\n',
    'data: {"type":"message.delta","text":"hel"}\n\n',
    'event: message.delta\n',
    'data: {"type":"message.delta","text":"lo"}'
  ].join(""));

  assert.equal(parsed.eventBlocks.length, 1);
  assert.match(parsed.eventBlocks[0] ?? "", /"hel"/);
  assert.match(parsed.remainder, /"lo"/);
});

test("parseSseEventBlock reads event and data lines", () => {
  const parsed = parseSseEventBlock([
    "event: message.done",
    'data: {"type":"message.done","message":{"role":"assistant","content":"hello"}}'
  ].join("\n"));

  assert.deepEqual(parsed, {
    event: "message.done",
    data: '{"type":"message.done","message":{"role":"assistant","content":"hello"}}'
  });
});

test("applyStreamEvent assembles deltas and final completion", () => {
  const initial = {
    assistantText: "",
    warningMessages: [],
    isComplete: false,
    isDone: false
  };

  const afterDelta = applyStreamEvent(initial, {
    event: "message.delta",
    data: '{"type":"message.delta","text":"hel"}'
  });
  const afterDone = applyStreamEvent(afterDelta, {
    event: "message.done",
    data: '{"type":"message.done","message":{"role":"assistant","content":"hello"}}'
  });

  assert.equal(afterDelta.assistantText, "hel");
  assert.equal(afterDone.assistantText, "hello");
  assert.equal(afterDone.isComplete, true);
});

test("applyStreamEvent collects runtime warning messages", () => {
  const updated = applyStreamEvent({
    assistantText: "Proceeding with the API search now.",
    warningMessages: [],
    isComplete: true,
    isDone: false
  }, {
    event: "warning",
    data: "{\"type\":\"warning\",\"code\":\"assistant_claimed_progress_without_tool_activity\",\"warning\":\"Assistant claimed it was already proceeding, but no tool.call or tool.result events occurred in this turn.\"}"
  });

  assert.deepEqual(updated.warningMessages, [
    "Assistant claimed it was already proceeding, but no tool.call or tool.result events occurred in this turn."
  ]);
});

test("formatToolEventLine prints shell command and parameters", () => {
  assert.equal(
    formatToolEventLine("tool.result", "shell_cmd", {
      command: "curl",
      parameters: ["-sS", "-H", "Authorization: Bearer [redacted:$API_ACCESS_TOKEN]", "https://api.example.test/records", "--fail"],
      directory: "tools",
      output_format: "json"
    }),
    "\n[tool.result] shell_cmd command=\"curl\" args=[\"-sS\",\"-H\",\"Authorization: Bearer [redacted:$API_ACCESS_TOKEN]\",\"https://api.example.test/records\",\"--fail\"] directory=\"tools\" output_format=\"json\"\n"
  );
});

test("formatToolEventLine prints generic tool arguments as JSON", () => {
  assert.equal(
    formatToolEventLine("tool.call", "web_fetch", { url: "https://example.test" }),
    "\n[tool.call] web_fetch args={\"url\":\"https://example.test\"}\n"
  );
});

test("commitTurn appends a complete user and assistant turn", () => {
  const updated = commitTurn([
    {
      role: "user",
      content: "First question"
    },
    {
      role: "assistant",
      content: "First answer"
    }
  ], "Second question", "Second answer");

  assert.deepEqual(updated, [
    {
      role: "user",
      content: "First question"
    },
    {
      role: "assistant",
      content: "First answer"
    },
    {
      role: "user",
      content: "Second question"
    },
    {
      role: "assistant",
      content: "Second answer"
    }
  ]);
});

test("shouldAutoContinue only triggers for planning-style assistant replies without tool activity", () => {
  assert.equal(shouldAutoContinue("I will search the API and confirm the record before proceeding.", false), true);
  assert.equal(shouldAutoContinue("Before I proceed: do you want me to continue?", false), true);
  assert.equal(shouldAutoContinue([
    "Understood. I will search the API for the requested record and confirm whether exactly one match exists.",
    "",
    "Proceeding with record search now."
  ].join("\n"), false), true);
  assert.equal(shouldAutoContinue("I searched the API and found the record.", true), false);
  assert.equal(shouldAutoContinue("Here is the final answer.", false), false);
});