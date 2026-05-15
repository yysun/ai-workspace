/*
 * Feature: unit coverage for runtime warning heuristics.
 * Notes: verifies the server warns only when the assistant claims work has started without any tool activity.
 * Recent changes: added regression coverage for narrated progress without matching tool events.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyMissingActionEvidenceResponse,
  detectMissingToolActivityWarning,
  detectUnsupportedWorkspaceAccessWarning
} from "../../src/runtime/runtimeWarnings.js";

test("detectMissingToolActivityWarning flags present-tense progress claims without tool activity", () => {
  const warning = detectMissingToolActivityWarning("Proceeding with the CRM search now.", false);

  assert.equal(
    warning,
    "Assistant claimed it was already proceeding, but no tool.call or tool.result events occurred in this turn."
  );
});

test("detectMissingToolActivityWarning flags immediate tool-action claims without tool activity", () => {
  const warning = detectMissingToolActivityWarning("I will now execute the search and return with a summary.", false);

  assert.equal(
    warning,
    "Assistant claimed it was already proceeding, but no tool.call or tool.result events occurred in this turn."
  );
});

test("detectMissingToolActivityWarning ignores optional suggestions and real tool activity", () => {
  assert.equal(detectMissingToolActivityWarning("I can search the CRM next if you want.", false), null);
  assert.equal(detectMissingToolActivityWarning("Before I proceed, confirm the contact.", false), null);
  assert.equal(detectMissingToolActivityWarning("Proceeding with the CRM search now.", true), null);
});

test("detectUnsupportedWorkspaceAccessWarning flags unsupported workspace access claims", () => {
  const warning = detectUnsupportedWorkspaceAccessWarning([
    "Before I can do that, I must confirm the workspace has:",
    "",
    "- `CRM_BASE_URL`",
    "- `CRM_ACCESS_TOKEN`",
    "",
    "These are loaded from the `.env` file.",
    "",
    "I don’t currently have access to the workspace environment variables from this session.",
    "",
    "Please confirm the `.env` file exists."
  ].join("\n"), false);

  assert.equal(
    warning,
    "Assistant claimed workspace information was unavailable or required confirmation before using available workspace tools."
  );
});

test("classifyMissingActionEvidenceResponse classifies retryable host guardrails", () => {
  assert.deepEqual(
    classifyMissingActionEvidenceResponse("Great - proceeding with CRM search now.", false),
    {
      classification: "intent_only_narration",
      warning: "Assistant narrated the next action without calling a tool. Retrying the turn and requiring action evidence.",
      transientInstruction: "Do not describe future tool actions. Use the available workspace tools now, or answer only if prior tool results already provide a verified final result."
    }
  );

  assert.deepEqual(
    classifyMissingActionEvidenceResponse("I cannot confirm the workspace .env configuration from this session.", false),
    {
      classification: "non_progressing",
      warning: "Assistant claimed workspace information was unavailable without inspecting available workspace sources. Retrying the turn.",
      transientInstruction: "Do not ask the user to confirm workspace-local files, credentials, configuration, or environment variables before inspecting likely workspace sources with read-only tools. Use available workspace tools now, and report only presence, absence, or other non-sensitive metadata for secrets."
    }
  );
});
