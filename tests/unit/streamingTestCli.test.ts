/*
 * Feature: unit coverage for the streaming test CLI helpers.
 * Notes: verifies SSE frame parsing, runtime event assembly, and in-memory history updates without depending on interactive terminal IO.
 * Recent changes: added coverage for structured human-input tool call handling.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  applyStreamEvent,
  collectHumanInputAnswers,
  consumeAutoContinueBudget,
  commitTurn,
  extractSseEventBlocks,
  formatToolEventLine,
  formatHumanInputAnswerMessage,
  isReadlineExitError,
  parseSseEventBlock,
  sanitizeHumanInputDisplayText,
  parseHumanInputSelection,
  parseHumanInputToolCall,
  parsePendingHumanInputRequest,
  resolveCliOptions,
  shouldSuppressHumanInputToolEventLine,
  shouldAutoContinue,
  streamAssistantTurn,
  writeQueuedHumanInputFollowUp
} from "../../src/cli/streamingTestCli.js";

function createWritableCapture(isTTY = false): {
  output: { isTTY: boolean; write: (chunk: string) => boolean };
  text: () => string;
} {
  let value = "";

  return {
    output: {
      isTTY,
      write(chunk: string) {
        value += chunk;
        return true;
      }
    },
    text() {
      return value;
    }
  };
}

function createSseResponse(events: Array<{ event: string; data: unknown }>): Response {
  const body = events.map(({ event, data }) => [
    `event: ${event}`,
    `data: ${JSON.stringify(data)}`,
    ""
  ].join("\n")).join("\n");

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream"
    }
  });
}

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
    data: "{\"type\":\"warning\",\"code\":\"assistant_text_rejected_without_evidence\",\"warning\":\"llm-runtime classified the assistant text as non_progressing; retrying.\"}"
  });

  assert.deepEqual(updated.warningMessages, [
    "llm-runtime classified the assistant text as non_progressing; retrying."
  ]);
});

test("streamAssistantTurn writes streamed assistant text without a prompt label", async () => {
  const output = createWritableCapture();
  const errorOutput = createWritableCapture();
  const originalFetch = global.fetch;

  global.fetch = (async () => createSseResponse([
    {
      event: "message.delta",
      data: {
        type: "message.delta",
        text: "hel"
      }
    },
    {
      event: "message.delta",
      data: {
        type: "message.delta",
        text: "lo"
      }
    },
    {
      event: "message.done",
      data: {
        type: "message.done",
        message: {
          role: "assistant",
          content: "hello"
        }
      }
    },
    {
      event: "done",
      data: {}
    }
  ])) as typeof fetch;

  try {
    const turnResult = await streamAssistantTurn({
      baseUrl: "http://localhost:3000",
      model: "default",
      autoContinue: false,
      autoContinueMessage: "go ahead",
      autoContinueTurns: 1
    }, [], "say hello", output.output, errorOutput.output);

    assert.equal(turnResult.assistantText, "hello");
    assert.equal(turnResult.sawToolActivity, false);
    assert.deepEqual(turnResult.warningMessages, []);
    assert.deepEqual(turnResult.humanInputRequests, []);
    assert.equal(errorOutput.text(), "");
    assert.equal(output.text(), "hello\n");
  } finally {
    global.fetch = originalFetch;
  }
});

test("formatToolEventLine prints shell command and parameters", () => {
  assert.equal(
    formatToolEventLine("tool.result", "shell_cmd", {
      command: "curl",
      parameters: ["-sS", "-H", "Authorization: Bearer [redacted:$API_ACCESS_TOKEN]", "https://api.example.test/records", "--fail"],
      directory: "tools",
      output_format: "json"
    }),
    [
      "",
      "[tool.result] shell_cmd",
      "  command: \"curl\"",
      "  args: [\"-sS\",\"-H\",\"Authorization: Bearer [redacted:$API_ACCESS_TOKEN]\",\"https://api.example.test/records\",\"--fail\"]",
      "  directory: \"tools\"",
      "  output_format: \"json\"",
      ""
    ].join("\n")
  );
});

test("formatToolEventLine prints generic tool arguments as JSON", () => {
  assert.equal(
    formatToolEventLine("tool.call", "web_fetch", { url: "https://example.test" }),
    [
      "",
      "[tool.call] web_fetch",
      "  url: \"https://example.test\"",
      ""
    ].join("\n")
  );
});

test("parsePendingHumanInputRequest reads ask_user_input pending artifacts", () => {
  const request = parsePendingHumanInputRequest("ask_user_input", JSON.stringify({
    ok: false,
    pending: true,
    status: "pending",
    confirmed: false,
    requestId: "call_123",
    type: "single-select",
    allowSkip: false,
    questions: [
      {
        header: "Test scope",
        id: "test-scope",
        question: "Which tests should run?",
        options: [
          { id: "unit", label: "Unit tests" },
          { id: "all", label: "All tests", description: "Includes e2e" }
        ]
      }
    ]
  }));

  assert.deepEqual(request, {
    toolName: "ask_user_input",
    requestId: "call_123",
    type: "single-select",
    allowSkip: false,
    questions: [
      {
        header: "Test scope",
        id: "test-scope",
        question: "Which tests should run?",
        options: [
          { id: "unit", label: "Unit tests" },
          { id: "all", label: "All tests", description: "Includes e2e" }
        ]
      }
    ]
  });
});

test("parseHumanInputToolCall accepts ask_user_question as a local alias", () => {
  const request = parseHumanInputToolCall("ask_user_question", {
    type: "multiple-select",
    allowSkip: true,
    questions: [
      {
        header: "Follow-up",
        id: "next-step",
        question: "What should happen next?",
        options: [
          { id: "continue", label: "Continue" },
          { id: "pause", label: "Pause" }
        ]
      }
    ]
  }, "call_alias");

  assert.equal(request?.toolName, "ask_user_question");
  assert.equal(request?.requestId, "call_alias");
  assert.equal(request?.type, "multiple-select");
  assert.equal(request?.allowSkip, true);
  assert.equal(request?.questions[0]?.id, "next-step");
});

test("sanitizeHumanInputDisplayText removes emoji from rendered prompts", () => {
  assert.equal(
    sanitizeHumanInputDisplayText("✅ Contact Match"),
    "Contact Match"
  );
  assert.equal(
    sanitizeHumanInputDisplayText("🎯 Which Jazz Gill are you looking for?"),
    "Which Jazz Gill are you looking for?"
  );
  assert.equal(
    sanitizeHumanInputDisplayText("📄 Jazz Gill (Contact ID 123)"),
    "Jazz Gill (Contact ID 123)"
  );
});

test("shouldSuppressHumanInputToolEventLine hides structured human-input tool events", () => {
  assert.equal(shouldSuppressHumanInputToolEventLine("tool.call", "ask_user_question", {
    type: "single-select",
    questions: [
      {
        header: "Entity Type",
        id: "entity-type",
        question: "What type of record are you looking for?",
        options: [
          { id: "contact", label: "Contact" }
        ]
      }
    ]
  }, "call_123"), true);

  assert.equal(shouldSuppressHumanInputToolEventLine("tool.result", "ask_user_input", {
    pending: true,
    status: "pending",
    requestId: "call_123",
    type: "single-select",
    questions: [
      {
        header: "Entity Type",
        id: "entity-type",
        question: "What type of record are you looking for?",
        options: [
          { id: "contact", label: "Contact" }
        ]
      }
    ]
  }, "call_123"), true);

  assert.equal(shouldSuppressHumanInputToolEventLine("tool.result", "shell_cmd", {
    stdout: "ok"
  }), false);
});

test("collectHumanInputAnswers grays human-input request tags for TTY output", async () => {
  const output = createWritableCapture(true);
  const answers = await collectHumanInputAnswers([
    {
      toolName: "ask_user_input",
      requestId: "call_123",
      type: "single-select",
      allowSkip: false,
      questions: [
        {
          header: "Contact Match",
          id: "contact_match",
          question: "Which contact?",
          options: [
            { id: "jazz-gill-1", label: "Jazz Gill" }
          ]
        }
      ]
    }
  ], {
    async question(query: string) {
      output.output.write(query);
      output.output.write("1\n");
      return "1";
    }
  }, output.output);

  assert.deepEqual(answers[0]?.selections[0]?.selectedOptions, [
    { id: "jazz-gill-1", label: "Jazz Gill" }
  ]);
  assert.match(output.text(), /\u001b\[90m\[ask_user_input\]\u001b\[0m Contact Match/);
});

test("writeQueuedHumanInputFollowUp includes the readable answer payload", () => {
  const output = createWritableCapture();
  const answerMessage = [
    "Human input response:",
    "- Answer for request call_123:",
    "  - mode (Which mode?): safe (Safe)"
  ].join("\n");

  writeQueuedHumanInputFollowUp(output.output, answerMessage);

  assert.equal(output.text(), [
    "[human-input] queued answer follow-up:",
    "Human input response:",
    "- Answer for request call_123:",
    "  - mode (Which mode?): safe (Safe)",
    ""
  ].join("\n"));
});

test("Jazz Gill contact disambiguation transcript uses correct ask_user_input request and response payloads", async () => {
  const toolArgs = {
    questions: [
      {
        header: "✅ Contact Match",
        id: "contact_match",
        question: "🎯 Which Jazz Gill are you looking for?",
        options: [
          {
            id: "jazz-gill-1",
            label: "📄 Jazz Gill (Contact ID 123)",
            description: "✅ If this is the primary Jazz Gill you want to analyze."
          },
          {
            id: "not-sure",
            label: "🤷 Not sure / search all",
            description: "🔎 Search across all contacts named Jazz Gill and show matches."
          }
        ]
      }
    ]
  };
  const pendingToolResult = {
    ok: false,
    pending: true,
    status: "pending",
    confirmed: false,
    requestId: "call_contact_match",
    type: "single-select",
    allowSkip: false,
    questions: toolArgs.questions
  };
  const output = createWritableCapture();
  const errorOutput = createWritableCapture();
  const originalFetch = global.fetch;

  global.fetch = (async () => createSseResponse([
    {
      event: "tool.call",
      data: {
        type: "tool.call",
        name: "ask_user_input",
        args: toolArgs,
        toolCallId: "call_contact_match"
      }
    },
    {
      event: "tool.result",
      data: {
        type: "tool.result",
        name: "ask_user_input",
        args: toolArgs,
        result: pendingToolResult,
        toolCallId: "call_contact_match"
      }
    },
    {
      event: "done",
      data: {}
    }
  ])) as typeof fetch;

  try {
    assert.equal(
      formatToolEventLine("tool.call", "ask_user_input", toolArgs),
      [
        "",
        "[tool.call] ask_user_input",
        "  questions: [{\"header\":\"✅ Contact Match\",\"id\":\"contact_match\",\"question\":\"🎯 Which Jazz Gill are you looking for?\",\"options\":[{\"id\":\"jazz-gill-1\",\"label\":\"📄 Jazz Gill (Contact ID 123)\",\"description\":\"✅ If this is the primary Jazz Gill you want to analyze.\"},{\"id\":\"not-sure\",\"label\":\"🤷 Not sure / search all\",\"description\":\"🔎 Search across all contacts named Jazz Gill and show matches.\"}]}]",
        ""
      ].join("\n")
    );

    assert.deepEqual(
      parsePendingHumanInputRequest("ask_user_input", pendingToolResult, "call_contact_match"),
      {
        toolName: "ask_user_input",
        requestId: "call_contact_match",
        type: "single-select",
        allowSkip: false,
        questions: [
          {
            header: "Contact Match",
            id: "contact_match",
            question: "Which Jazz Gill are you looking for?",
            options: [
              {
                id: "jazz-gill-1",
                label: "Jazz Gill (Contact ID 123)",
                description: "If this is the primary Jazz Gill you want to analyze."
              },
              {
                id: "not-sure",
                label: "Not sure / search all",
                description: "Search across all contacts named Jazz Gill and show matches."
              }
            ]
          }
        ]
      }
    );

    const turnResult = await streamAssistantTurn({
      baseUrl: "http://localhost:3000",
      model: "default",
      autoContinue: false,
      autoContinueMessage: "go ahead",
      autoContinueTurns: 1
    }, [], "find contact Jazz Gill", output.output, errorOutput.output);

    output.output.write("\n");

    const answers = await collectHumanInputAnswers(turnResult.humanInputRequests, {
      async question(query: string) {
        output.output.write(query);
        output.output.write("1\n");
        return "1";
      }
    }, output.output);

    writeQueuedHumanInputFollowUp(output.output, formatHumanInputAnswerMessage(answers));

    assert.equal(turnResult.assistantText, "");
    assert.equal(turnResult.sawToolActivity, true);
    assert.deepEqual(turnResult.warningMessages, []);
    assert.equal(errorOutput.text(), "");
    assert.equal(output.text(), [
      "",
      "",
      "[ask_user_input] Contact Match",
      "Which Jazz Gill are you looking for?",
      "  1. Jazz Gill (Contact ID 123) [jazz-gill-1] - If this is the primary Jazz Gill you want to analyze.",
      "  2. Not sure / search all [not-sure] - Search across all contacts named Jazz Gill and show matches.",
      "Select a number: 1",
      "[human-input] queued answer follow-up:",
      "Human input response:",
      "- Answer for request call_contact_match:",
      "  - contact_match (Which Jazz Gill are you looking for?): jazz-gill-1 (Jazz Gill (Contact ID 123))",
      ""
    ].join("\n"));

    assert.equal(formatHumanInputAnswerMessage(answers), [
      "Human input response:",
      "- Answer for request call_contact_match:",
      "  - contact_match (Which Jazz Gill are you looking for?): jazz-gill-1 (Jazz Gill (Contact ID 123))"
    ].join("\n"));
  } finally {
    global.fetch = originalFetch;
  }
});

test("parseHumanInputSelection supports option numbers, ids, and skippable prompts", () => {
  const question = {
    header: "Mode",
    id: "mode",
    question: "Which mode?",
    options: [
      { id: "fast", label: "Fast" },
      { id: "safe", label: "Safe" },
      { id: "full", label: "Full" }
    ]
  };

  assert.deepEqual(parseHumanInputSelection(question, "single-select", false, "2"), {
    ok: true,
    selection: {
      questionId: "mode",
      questionText: "Which mode?",
      skipped: false,
      selectedOptions: [{ id: "safe", label: "Safe" }]
    }
  });

  assert.deepEqual(parseHumanInputSelection(question, "multiple-select", false, "fast, 3"), {
    ok: true,
    selection: {
      questionId: "mode",
      questionText: "Which mode?",
      skipped: false,
      selectedOptions: [
        { id: "fast", label: "Fast" },
        { id: "full", label: "Full" }
      ]
    }
  });

  assert.deepEqual(parseHumanInputSelection(question, "single-select", true, ""), {
    ok: true,
    selection: {
      questionId: "mode",
      questionText: "Which mode?",
      skipped: true,
      selectedOptions: []
    }
  });
  assert.deepEqual(parseHumanInputSelection(question, "single-select", false, ""), {
    ok: false,
    error: "Select an option before continuing."
  });
});

test("formatHumanInputAnswerMessage serializes selected ids and labels", () => {
  assert.equal(formatHumanInputAnswerMessage([
    {
      requestId: "call_123",
      selections: [
        {
          questionId: "mode",
          questionText: "Which mode?",
          skipped: false,
          selectedOptions: [
            { id: "safe", label: "Safe" },
            { id: "full", label: "Full" }
          ]
        },
        {
          questionId: "notes",
          questionText: "Any notes?",
          skipped: true,
          selectedOptions: []
        }
      ]
    }
  ]), [
    "Human input response:",
    "- Answer for request call_123:",
    "  - mode (Which mode?): safe, full (Safe, Full)",
    "  - notes (Any notes?): skipped"
  ].join("\n"));
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