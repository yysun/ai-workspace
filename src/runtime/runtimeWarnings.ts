/*
 * Feature: runtime warning heuristics for assistant/tool mismatches.
 * Notes: detects when the assistant claims to have started work even though the turn produced no tool activity.
 * Recent changes: added a guardrail warning for narrated progress without matching tool events.
 */

const STARTED_ACTION_PATTERNS = [
  /\bproceeding with\b/i,
  /\b(i('|’)m|i am)\s+(searching|fetching|pulling|looking up|checking|creating|generating|running|calling|querying)\b/i,
  /\b(searching|fetching|pulling|looking up|checking|creating|generating|running|calling|querying)\b[^.?!\n]{0,60}\bnow\b/i,
  /\b(starting|beginning)\b[^.?!\n]{0,40}\b(search|lookup|fetch|generation|call)\b/i
];

export function detectMissingToolActivityWarning(assistantText: string, sawToolActivity: boolean): string | null {
  if (sawToolActivity) {
    return null;
  }

  const normalizedText = assistantText.trim();
  if (!normalizedText) {
    return null;
  }

  if (!STARTED_ACTION_PATTERNS.some((pattern) => pattern.test(normalizedText))) {
    return null;
  }

  return "Assistant claimed it was already proceeding, but no tool.call or tool.result events occurred in this turn.";
}