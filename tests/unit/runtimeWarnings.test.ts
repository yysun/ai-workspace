/*
 * Feature: unit coverage for runtime warning heuristics.
 * Notes: verifies the server warns only when the assistant claims work has started without any tool activity.
 * Recent changes: added regression coverage for narrated progress without matching tool events.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { detectMissingToolActivityWarning } from "../../src/runtime/runtimeWarnings.js";

test("detectMissingToolActivityWarning flags present-tense progress claims without tool activity", () => {
  const warning = detectMissingToolActivityWarning("Proceeding with the CRM search now.", false);

  assert.equal(
    warning,
    "Assistant claimed it was already proceeding, but no tool.call or tool.result events occurred in this turn."
  );
});

test("detectMissingToolActivityWarning ignores future-tense plans and real tool activity", () => {
  assert.equal(detectMissingToolActivityWarning("I will search the CRM next.", false), null);
  assert.equal(detectMissingToolActivityWarning("Before I proceed, confirm the contact.", false), null);
  assert.equal(detectMissingToolActivityWarning("Proceeding with the CRM search now.", true), null);
});