/*
 * Feature: unit coverage for the streaming test CLI helpers.
 * Notes: verifies SSE frame parsing, runtime event assembly, and in-memory history updates without depending on interactive terminal IO.
 * Recent changes: added regression coverage for chunked SSE parsing and successful turn commits.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  applyStreamEvent,
  commitTurn,
  extractSseEventBlocks,
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
  assert.equal(shouldAutoContinue("I will search the CRM and confirm the record before proceeding.", false), true);
  assert.equal(shouldAutoContinue("Before I proceed: do you want me to continue?", false), true);
  assert.equal(shouldAutoContinue("I searched the CRM and found the contact.", true), false);
  assert.equal(shouldAutoContinue("Here is the final answer.", false), false);
});