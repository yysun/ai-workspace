/*
 * Feature: runtime warning heuristics for assistant/tool mismatches.
 * Notes: detects when the assistant claims to have started work even though the turn produced no tool activity.
 * Recent changes: added a guardrail warning for narrated progress without matching tool events.
 */

type MissingActionEvidenceClassification = "intent_only_narration" | "non_progressing";

export type MissingActionEvidenceAssessment = {
  classification: MissingActionEvidenceClassification;
  warning: string;
  transientInstruction: string;
};

const STARTED_ACTION_PATTERNS = [
  /\bproceeding with\b/i,
  /\b(i('|’)ll|i will|let me|i am going to|i'm going to)\s+(now\s+|then\s+|next\s+|immediately\s+)?(run|check|search|open|update|inspect|read|look for|review|use|call|execute|query|load|save|fetch|write|ask)\b/i,
  /\b(i('|’)m|i am)\s+(searching|fetching|pulling|looking up|checking|creating|generating|running|calling|querying)\b/i,
  /\b(searching|fetching|pulling|looking up|checking|creating|generating|running|calling|querying)\b[^.?!\n]{0,60}\bnow\b/i,
  /\b(starting|beginning)\b[^.?!\n]{0,40}\b(search|lookup|fetch|generation|call)\b/i
];

const WORKSPACE_ACCESS_CLAIM_PATTERNS = [
  /\b(i\s+(do\s+not|don't)|i\s+(cannot|can't))\s+(currently\s+)?(have\s+)?(access|confirm|verify|inspect|read)\b[^.?!\n]{0,180}\b(workspace|environment variables?|env(?:ironment)?|\.env|credentials?|configuration|config)\b/i,
  /\bbefore\s+i\s+can\b[\s\S]{0,260}\b(confirm|verify|proceed|do that|call|query|search)\b[\s\S]{0,260}\b(workspace|environment variables?|env(?:ironment)?|\.env|credentials?|configuration|config)\b/i,
  /\bplease\s+confirm\b[\s\S]{0,600}\b(\.env|environment variables?|credentials?|configuration|config|api access)\b/i
];

const TOOL_ACTION_RETRY_INSTRUCTION = [
  "Do not describe future tool actions.",
  "Use the available workspace tools now, or answer only if prior tool results already provide a verified final result."
].join(" ");

const WORKSPACE_INSPECTION_RETRY_INSTRUCTION = [
  "Do not ask the user to confirm workspace-local files, credentials, configuration, or environment variables before inspecting likely workspace sources with read-only tools.",
  "Use available workspace tools now, and report only presence, absence, or other non-sensitive metadata for secrets."
].join(" ");

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

export function detectUnsupportedWorkspaceAccessWarning(assistantText: string, sawToolActivity: boolean): string | null {
  if (sawToolActivity) {
    return null;
  }

  const normalizedText = assistantText.trim();
  if (!normalizedText) {
    return null;
  }

  if (!WORKSPACE_ACCESS_CLAIM_PATTERNS.some((pattern) => pattern.test(normalizedText))) {
    return null;
  }

  return "Assistant claimed workspace information was unavailable or required confirmation before using available workspace tools.";
}

export function classifyMissingActionEvidenceResponse(
  assistantText: string,
  sawToolActivity: boolean
): MissingActionEvidenceAssessment | null {
  const missingToolActivityWarning = detectMissingToolActivityWarning(assistantText, sawToolActivity);
  if (missingToolActivityWarning) {
    return {
      classification: "intent_only_narration",
      warning: "Assistant narrated the next action without calling a tool. Retrying the turn and requiring action evidence.",
      transientInstruction: TOOL_ACTION_RETRY_INSTRUCTION
    };
  }

  const unsupportedWorkspaceAccessWarning = detectUnsupportedWorkspaceAccessWarning(assistantText, sawToolActivity);
  if (unsupportedWorkspaceAccessWarning) {
    return {
      classification: "non_progressing",
      warning: "Assistant claimed workspace information was unavailable without inspecting available workspace sources. Retrying the turn.",
      transientInstruction: WORKSPACE_INSPECTION_RETRY_INSTRUCTION
    };
  }

  return null;
}
