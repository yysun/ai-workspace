/*
 * Feature: unit coverage for the streaming test CLI helpers.
 * Notes: verifies SSE frame parsing, runtime event assembly, compact tool trace rendering, and in-memory history updates without depending on interactive terminal IO.
 * Recent changes: added coverage for compact, verbose, and debug trace modes plus human-input checkpoint rendering.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  applyStreamEvent,
  appendHumanInputAnswerMessages,
  collectHumanInputAnswers,
  commitAssistantResponse,
  commitHumanInputRequestTurn,
  consumeAutoContinueBudget,
  commitTurn,
  createHumanInputAssistantMessage,
  extractSseEventBlocks,
  formatHumanInputCheckpoint,
  formatInlinePathExistsEventLine,
  formatToolEventLine,
  formatToolResultEventLine,
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
    autoContinueTurns: 2,
    traceMode: "default",
    accessToken: undefined
  });
});

test("resolveCliOptions maps verbose and debug flags to trace modes", () => {
  assert.equal(resolveCliOptions(["--verbose"], {}).traceMode, "verbose");
  assert.equal(resolveCliOptions(["--verbose", "--debug"], {}).traceMode, "debug");
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
    autoContinueTurns: 1,
    traceMode: "default",
    accessToken: undefined
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
      autoContinueTurns: 1,
      traceMode: "default"
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

test("formatToolEventLine renders a compact shell command trace by default", () => {
  assert.equal(
    formatToolEventLine("tool.call", "shell_cmd", {
      command: "python",
      parameters: ["-c", "print('hello from a long inline script that should be collapsed for readability')"]
    }),
    [
      "",
      "  ↳ shell_cmd python -c \"...\""
    ].join("\n")
  );
});

test("formatToolEventLine renders a compact generic tool summary by default", () => {
  assert.equal(
    formatToolEventLine("tool.call", "web_fetch", { url: "https://example.test" }),
    [
      "",
      "  ↳ web_fetch https://example.test"
    ].join("\n")
  );
});

test("formatInlinePathExistsEventLine renders path and boolean on one line", () => {
  assert.equal(
    formatInlinePathExistsEventLine(
      { path: "data/accounts/255/current/insight.md" },
      JSON.stringify({
        path: "data/accounts/255/current/insight.md",
        exists: false,
        type: null
      })
    ),
    [
      "",
      "  ↳ path_exists data/accounts/255/current/insight.md false",
      ""
    ].join("\n")
  );
});

test("formatToolEventLine renders verbose tool details without raw dumping", () => {
  assert.equal(
    formatToolEventLine("tool.call", "search_files", { query: "**/*marp*" }, "verbose"),
    [
      "",
      "  ↳ search_files **/*marp*",
      "    args: {\"query\":\"**/*marp*\"}"
    ].join("\n")
  );
});

test("formatToolEventLine preserves raw event output in debug mode", () => {
  assert.equal(
    formatToolEventLine("tool.call", "shell_cmd", {
      command: "curl",
      parameters: ["-sS", "https://example.test"],
      output_format: "json"
    }, "debug"),
    [
      "",
      "[tool.call] shell_cmd",
      "  command: \"curl\"",
      "  args: [\"-sS\",\"https://example.test\"]",
      "  output_format: \"json\""
    ].join("\n")
  );
});

test("formatToolResultEventLine summarizes shell command results with preview lines", () => {
  assert.equal(
    formatToolResultEventLine("shell_cmd", JSON.stringify({
      exit_code: 0,
      stdout: "saved\n",
      stderr: "",
      aborted: false,
      timed_out: false,
      duration_ms: 123,
      signal: null
    })),
    [
      "",
      "  ✓ shell_cmd 123ms · stdout 1 line",
      "    saved",
      ""
    ].join("\n")
  );
});

test("formatToolResultEventLine keeps raw output in debug mode", () => {
  assert.equal(
    formatToolResultEventLine("shell_cmd", JSON.stringify({
      exit_code: 1,
      stderr: "file not found: process/api.yaml\n",
      duration_ms: 11
    }), "debug"),
    [
      "",
      "[tool.result] shell_cmd",
      "  exit_code: 1",
      "  stderr: \"file not found: process/api.yaml\\n\"",
      "  duration_ms: 11",
      ""
    ].join("\n")
  );
});

test("formatToolResultEventLine summarizes path_exists results structurally", () => {
  assert.equal(
    formatToolResultEventLine("path_exists", [
      "{",
      '  "path": "/Users/esun/Documents/Projects/crm-ai-workspace/.env",',
      '  "exists": true,',
      '  "checked": true,',
      '  "kind": "file",',
      '  "scope": "workspace"',
      "}"
    ].join("\n")),
    [
      "",
      "  ✓ path_exists true",
      "    path: /Users/esun/Documents/Projects/crm-ai-workspace/.env",
      "    type: file",
      ""
    ].join("\n")
  );
});

test("formatToolResultEventLine prefers requested read_file line ranges", () => {
  assert.equal(
    formatToolResultEventLine(
      "read_file",
      "alpha\nbeta\ngamma\ndelta\nepsilon\nzeta\neta\n",
      "default",
      {
        filePath: "data/contacts/4539/2026/05/09/insight.md",
        startLine: 41,
        endLine: 47
      }
    ),
    [
      "",
      "  ✓ read_file lines 41-47",
      ""
    ].join("\n")
  );
});

test("formatToolResultEventLine suppresses workspace_read_file previews", () => {
  assert.equal(
    formatToolResultEventLine(
      "workspace_read_file",
      "---\ncreated_at: 2026-05-17T00:00:00Z\nupdated_at: 2026-05-17T00:00:00Z\n",
      "default",
      {
        filePath: "users/3/data/contacts/99000002/current/sources.md"
      },
      1
    ),
    [
      "",
      "  ✓ workspace_read_file 1ms · 3 lines",
      ""
    ].join("\n")
  );
});

test("formatToolResultEventLine ignores requested line ranges for workspace_read_file", () => {
  assert.equal(
    formatToolResultEventLine(
      "workspace_read_file",
      "alpha\nbeta\ngamma\ndelta\n",
      "default",
      {
        filePath: "users/3/data/contacts/99000002/current/sources.md",
        startLine: 1,
        endLine: 200
      },
      2
    ),
    [
      "",
      "  ✓ workspace_read_file 2ms · 4 lines",
      ""
    ].join("\n")
  );
});

test("formatToolResultEventLine uses event timing for shell_cmd markdown results", () => {
  assert.equal(
    formatToolResultEventLine(
      "shell_cmd",
      [
        "status: success",
        "exit_code: 0",
        "aborted: false",
        "timed_out: false",
        "stdout:",
        "stderr:"
      ].join("\n"),
      "default",
      undefined,
      123
    ),
    [
      "",
      "  ✓ shell_cmd 123ms · completed",
      ""
    ].join("\n")
  );
});

test("formatToolEventLine summarizes list_files calls using requestedPath", () => {
  assert.equal(
    formatToolEventLine("tool.call", "list_files", {
      requestedPath: "process",
      recursive: false
    }),
    [
      "",
      "  ↳ list_files process"
    ].join("\n")
  );
});

test("formatToolResultEventLine suppresses list_files metadata previews", () => {
  assert.equal(
    formatToolResultEventLine(
      "list_files",
      [
        "{",
        '  "requestedPath": "process",',
        '  "path": "/Users/esun/Documents/Projects/ai-workspace/crm-ai-workspace/process",',
        '  "recursive": false,',
        '  "entries": ["api.md", "summary.md"]',
        "}"
      ].join("\n"),
      "default",
      undefined,
      1
    ),
    [
      "",
      "  ✓ list_files 1ms · 2 lines",
      ""
    ].join("\n")
  );
});

test("formatToolResultEventLine suppresses create_directory metadata previews", () => {
  assert.equal(
    formatToolResultEventLine(
      "create_directory",
      [
        "{",
        '  "ok": true,',
        '  "status": "success",',
        '  "path": "/Users/esun/Documents/Projects/ai-workspace/crm-ai-workspace/users/3/data/contacts/99027713/current"',
        "}"
      ].join("\n"),
      "default",
      undefined,
      1
    ),
    [
      "",
      "  ✓ create_directory 1ms · success",
      ""
    ].join("\n")
  );
});

test("streamAssistantTurn writes tool results using returned payloads", async () => {
  const output = createWritableCapture();
  const errorOutput = createWritableCapture();
  const originalFetch = global.fetch;

  global.fetch = (async () => createSseResponse([
    {
      event: "tool.call",
      data: {
        type: "tool.call",
        name: "shell_cmd",
        args: {
          command: "bash",
          parameters: ["-lc", "echo saved"],
          output_format: "json",
          output_detail: "minimal"
        },
        toolCallId: "call_1"
      }
    },
    {
      event: "tool.result",
      data: {
        type: "tool.result",
        name: "shell_cmd",
        args: {
          command: "bash",
          parameters: ["-lc", "echo saved"],
          output_format: "json",
          output_detail: "minimal"
        },
        result: JSON.stringify({
          exit_code: 0,
          stdout: "saved\n",
          stderr: "",
          aborted: false,
          timed_out: false,
          duration_ms: 12,
          signal: null
        }),
        toolCallId: "call_1"
      }
    },
    {
      event: "message.done",
      data: {
        type: "message.done",
        message: {
          role: "assistant",
          content: "done"
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
      autoContinueTurns: 1,
      traceMode: "default"
    }, [], "run it", output.output, errorOutput.output);

    assert.equal(turnResult.assistantText, "done");
    assert.match(errorOutput.text(), /↳ shell_cmd bash -lc "echo saved"/);
    assert.match(errorOutput.text(), /✓ shell_cmd 12ms · stdout 1 line/);
    assert.match(errorOutput.text(), /saved/);
    assert.doesNotMatch(errorOutput.text(), /\[tool\.result\] shell_cmd/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("streamAssistantTurn keeps tool call and result adjacent on a shared TTY", async () => {
  const sharedTerminal = createWritableCapture(true);
  const originalFetch = global.fetch;

  global.fetch = (async () => createSseResponse([
    {
      event: "tool.call",
      data: {
        type: "tool.call",
        name: "read_file",
        args: {
          filePath: "data/contacts/4539/2026/05/09/insight.md",
          startLine: 41,
          endLine: 47
        },
        toolCallId: "call_1"
      }
    },
    {
      event: "tool.result",
      data: {
        type: "tool.result",
        name: "read_file",
        result: "alpha\nbeta\ngamma\ndelta\nepsilon\nzeta\neta\n",
        toolCallId: "call_1"
      }
    },
    {
      event: "message.done",
      data: {
        type: "message.done",
        message: {
          role: "assistant",
          content: "done"
        }
      }
    },
    {
      event: "done",
      data: {}
    }
  ])) as typeof fetch;

  try {
    await streamAssistantTurn({
      baseUrl: "http://localhost:3000",
      model: "default",
      autoContinue: false,
      autoContinueMessage: "go ahead",
      autoContinueTurns: 1,
      traceMode: "default"
    }, [], "run it", sharedTerminal.output, sharedTerminal.output);

    assert.match(
      sharedTerminal.text(),
      /↳ read_file data\/contacts\/4539\/2026\/05\/09\/insight\.md(?:\u001b\[[0-9;]*m)*\n(?:\u001b\[[0-9;]*m)*\s*✓ read_file lines 41-47/u
    );
    assert.match(
      sharedTerminal.text(),
      /✓ read_file lines 41-47\n(?:\u001b\[[0-9;]*m)*\n(?:\u001b\[[0-9;]*m)*done/u
    );
    assert.doesNotMatch(
      sharedTerminal.text(),
      /↳ read_file data\/contacts\/4539\/2026\/05\/09\/insight\.md(?:\u001b\[[0-9;]*m)*\n\n(?:\u001b\[[0-9;]*m)*\s*✓ read_file lines 41-47/u
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("streamAssistantTurn does not preview workspace_read_file content", async () => {
  const sharedTerminal = createWritableCapture(true);
  const originalFetch = global.fetch;

  global.fetch = (async () => createSseResponse([
    {
      event: "tool.call",
      data: {
        type: "tool.call",
        name: "workspace_read_file",
        args: {
          filePath: "users/3/data/contacts/99000002/current/sources.md"
        },
        toolCallId: "call_workspace_read"
      }
    },
    {
      event: "tool.result",
      data: {
        type: "tool.result",
        name: "workspace_read_file",
        result: "---\ncreated_at: 2026-05-17T00:00:00Z\nupdated_at: 2026-05-17T00:00:00Z\n",
        durationMs: 1,
        toolCallId: "call_workspace_read"
      }
    },
    {
      event: "message.done",
      data: {
        type: "message.done",
        message: {
          role: "assistant",
          content: "done"
        }
      }
    },
    {
      event: "done",
      data: {}
    }
  ])) as typeof fetch;

  try {
    await streamAssistantTurn({
      baseUrl: "http://localhost:3000",
      model: "default",
      autoContinue: false,
      autoContinueMessage: "go ahead",
      autoContinueTurns: 1,
      traceMode: "default"
    }, [], "run it", sharedTerminal.output, sharedTerminal.output);

    assert.match(
      sharedTerminal.text(),
      /↳ workspace_read_file users\/3\/data\/contacts\/99000002\/current\/sources\.md(?:\u001b\[[0-9;]*m)*\n(?:\u001b\[[0-9;]*m)*\s*✓ workspace_read_file 1ms · 3 lines/u
    );
    assert.match(
      sharedTerminal.text(),
      /✓ workspace_read_file 1ms · 3 lines\n(?:\u001b\[[0-9;]*m)*\n(?:\u001b\[[0-9;]*m)*done/u
    );
    assert.doesNotMatch(sharedTerminal.text(), /created_at: 2026-05-17T00:00:00Z/u);
    assert.doesNotMatch(sharedTerminal.text(), /updated_at: 2026-05-17T00:00:00Z/u);
  } finally {
    global.fetch = originalFetch;
  }
});

test("streamAssistantTurn renders path_exists as a single inline trace line", async () => {
  const sharedTerminal = createWritableCapture(true);
  const originalFetch = global.fetch;

  global.fetch = (async () => createSseResponse([
    {
      event: "tool.call",
      data: {
        type: "tool.call",
        name: "path_exists",
        args: {
          path: "data/accounts/255/current/insight.md"
        },
        toolCallId: "call_exists"
      }
    },
    {
      event: "tool.result",
      data: {
        type: "tool.result",
        name: "path_exists",
        result: JSON.stringify({
          path: "data/accounts/255/current/insight.md",
          exists: false,
          type: null
        }),
        toolCallId: "call_exists"
      }
    },
    {
      event: "message.done",
      data: {
        type: "message.done",
        message: {
          role: "assistant",
          content: "done"
        }
      }
    },
    {
      event: "done",
      data: {}
    }
  ])) as typeof fetch;

  try {
    await streamAssistantTurn({
      baseUrl: "http://localhost:3000",
      model: "default",
      autoContinue: false,
      autoContinueMessage: "go ahead",
      autoContinueTurns: 1,
      traceMode: "default"
    }, [], "run it", sharedTerminal.output, sharedTerminal.output);

    assert.match(
      sharedTerminal.text(),
      /↳ path_exists data\/accounts\/255\/current\/insight\.md false/u
    );
    assert.doesNotMatch(
      sharedTerminal.text(),
      /✓ false/u
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("streamAssistantTurn renders shell_cmd duration from tool.result payload when result is markdown", async () => {
  const sharedTerminal = createWritableCapture(true);
  const originalFetch = global.fetch;

  global.fetch = (async () => createSseResponse([
    {
      event: "tool.call",
      data: {
        type: "tool.call",
        name: "shell_cmd",
        args: {
          command: "pwd",
          parameters: []
        },
        toolCallId: "call_shell"
      }
    },
    {
      event: "tool.result",
      data: {
        type: "tool.result",
        name: "shell_cmd",
        result: [
          "status: success",
          "exit_code: 0",
          "aborted: false",
          "timed_out: false",
          "stdout:",
          "stderr:"
        ].join("\n"),
        durationMs: 42,
        toolCallId: "call_shell"
      }
    },
    {
      event: "message.done",
      data: {
        type: "message.done",
        message: {
          role: "assistant",
          content: "done"
        }
      }
    },
    {
      event: "done",
      data: {}
    }
  ])) as typeof fetch;

  try {
    await streamAssistantTurn({
      baseUrl: "http://localhost:3000",
      model: "default",
      autoContinue: false,
      autoContinueMessage: "go ahead",
      autoContinueTurns: 1,
      traceMode: "default"
    }, [], "run it", sharedTerminal.output, sharedTerminal.output);

    assert.match(
      sharedTerminal.text(),
      /↳ shell_cmd pwd(?:\u001b\[[0-9;]*m)*\n(?:\u001b\[[0-9;]*m)*\s*✓ shell_cmd 42ms · completed/u
    );
    assert.match(
      sharedTerminal.text(),
      /✓ shell_cmd 42ms · completed\n(?:\u001b\[[0-9;]*m)*\n(?:\u001b\[[0-9;]*m)*done/u
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("streamAssistantTurn synthesizes a missing shell_cmd call line from tool.result args", async () => {
  const sharedTerminal = createWritableCapture(true);
  const originalFetch = global.fetch;

  global.fetch = (async () => createSseResponse([
    {
      event: "tool.result",
      data: {
        type: "tool.result",
        name: "shell_cmd",
        args: {
          command: "pwd",
          parameters: []
        },
        result: [
          "status: success",
          "exit_code: 0",
          "aborted: false",
          "timed_out: false",
          "stdout:",
          "stderr:"
        ].join("\n"),
        durationMs: 74,
        toolCallId: "call_shell_missing"
      }
    },
    {
      event: "message.done",
      data: {
        type: "message.done",
        message: {
          role: "assistant",
          content: "done"
        }
      }
    },
    {
      event: "done",
      data: {}
    }
  ])) as typeof fetch;

  try {
    await streamAssistantTurn({
      baseUrl: "http://localhost:3000",
      model: "default",
      autoContinue: false,
      autoContinueMessage: "go ahead",
      autoContinueTurns: 1,
      traceMode: "default"
    }, [], "run it", sharedTerminal.output, sharedTerminal.output);

    assert.match(
      sharedTerminal.text(),
      /↳ shell_cmd pwd(?:\u001b\[[0-9;]*m)*\n(?:\u001b\[[0-9;]*m)*\s*✓ shell_cmd 74ms · completed/u
    );
  } finally {
    global.fetch = originalFetch;
  }
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

test("formatHumanInputCheckpoint renders a user checkpoint instead of a tool trace", () => {
  assert.equal(
    formatHumanInputCheckpoint({
      toolName: "ask_user_input",
      requestId: "call_123",
      type: "single-select",
      allowSkip: false,
      questions: []
    }, {
      header: "Entity Type",
      id: "entity-type",
      question: "What type of record are you looking for?",
      options: [
        { id: "contact", label: "Contact" },
        { id: "account", label: "Account" },
        { id: "unknown", label: "Not sure" }
      ]
    }),
    [
      "assistant needs input:",
      "  What type of record are you looking for?",
      "",
      "  1. Contact",
      "  2. Account",
      "  3. Not sure",
      "  0. Exit UI",
      ""
    ].join("\n")
  );
});

test("collectHumanInputAnswers writes a readable user checkpoint", async () => {
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

  assert.ok(answers);
  assert.deepEqual(answers[0]?.selections[0]?.selectedOptions, [
    { id: "jazz-gill-1", label: "Jazz Gill" }
  ]);
  assert.match(output.text(), /^\nassistant needs input:/);
  assert.match(output.text(), /Which contact\?/);
  assert.match(output.text(), /0\. Exit UI/);
});

test("collectHumanInputAnswers returns null when the user exits the prompt UI", async () => {
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
      output.output.write("0\n");
      return "0";
    }
  }, output.output);

  assert.equal(answers, null);
});

test("writeQueuedHumanInputFollowUp includes the readable answer payload", () => {
  const output = createWritableCapture();
  const answerMessage = [
    "- Answer for request call_123:",
    "  - mode (Which mode?): safe (Safe)"
  ].join("\n");

  writeQueuedHumanInputFollowUp(output.output, answerMessage);

  assert.equal(output.text(), [
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
      event: "done",
      data: {}
    }
  ])) as typeof fetch;

  try {
    assert.equal(
      formatHumanInputCheckpoint({
        toolName: "ask_user_input",
        requestId: "call_contact_match",
        type: "single-select",
        allowSkip: false,
        questions: []
      }, {
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
      }),
      [
        "assistant needs input:",
        "  Which Jazz Gill are you looking for?",
        "",
        "  1. Jazz Gill (Contact ID 123)",
        "  2. Not sure / search all",
        "  0. Exit UI",
        ""
      ].join("\n")
    );

    assert.deepEqual(
      parseHumanInputToolCall("ask_user_input", toolArgs, "call_contact_match"),
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
      autoContinueTurns: 1,
      traceMode: "default"
    }, [], "find contact Jazz Gill", output.output, errorOutput.output);

    output.output.write("\n");

    const answers = await collectHumanInputAnswers(turnResult.humanInputRequests, {
      async question(query: string) {
        output.output.write(query);
        output.output.write("1\n");
        return "1";
      }
    }, output.output);

    assert.ok(answers);
    writeQueuedHumanInputFollowUp(output.output, formatHumanInputAnswerMessage(answers));

    assert.equal(turnResult.assistantText, "");
    assert.equal(turnResult.sawToolActivity, true);
    assert.deepEqual(turnResult.warningMessages, []);
    assert.equal(errorOutput.text(), "");
    assert.equal(output.text(), [
      "",
      "",
      "assistant needs input:",
      "  Which Jazz Gill are you looking for?",
      "",
      "  1. Jazz Gill (Contact ID 123)",
      "  2. Not sure / search all",
      "  0. Exit UI",
      "Select a number or option id, or type a custom answer. Enter 0 to exit UI: 1",
      "- Answer for request call_contact_match:",
      "  - contact_match (Which Jazz Gill are you looking for?): jazz-gill-1 (Jazz Gill (Contact ID 123))",
      ""
    ].join("\n"));

    assert.equal(formatHumanInputAnswerMessage(answers), [
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

  assert.deepEqual(parseHumanInputSelection(question, "single-select", false, "Need audit logs"), {
    ok: true,
    selection: {
      questionId: "mode",
      questionText: "Which mode?",
      skipped: false,
      selectedOptions: [],
      enteredText: "Need audit logs"
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
          skipped: false,
          selectedOptions: [],
          enteredText: "Need SOC 2 docs"
        },
        {
          questionId: "empty",
          questionText: "Leave blank?",
          skipped: true,
          selectedOptions: []
        }
      ]
    }
  ]), [
    "- Answer for request call_123:",
    "  - mode (Which mode?): safe, full (Safe, Full)",
    "  - notes (Any notes?): Need SOC 2 docs",
    "  - empty (Leave blank?): skipped"
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

test("createHumanInputAssistantMessage preserves the assistant tool call for runtime continuation", () => {
  assert.deepEqual(createHumanInputAssistantMessage({
    toolName: "ask_user_input",
    requestId: "call_123",
    type: "single-select",
    allowSkip: false,
    questions: [
      {
        header: "Mode",
        id: "mode",
        question: "Which mode?",
        options: [
          { id: "safe", label: "Safe" }
        ]
      }
    ]
  }), {
    role: "assistant",
    content: "",
    tool_calls: [
      {
        id: "call_123",
        type: "function",
        function: {
          name: "ask_user_input",
          arguments: JSON.stringify({
            type: "single-select",
            allowSkip: false,
            questions: [
              {
                header: "Mode",
                id: "mode",
                question: "Which mode?",
                options: [
                  { id: "safe", label: "Safe" }
                ]
              }
            ]
          })
        }
      }
    ]
  });
});

test("commitHumanInputRequestTurn appends the pending assistant tool call instead of a synthetic answer user turn", () => {
  const updated = commitHumanInputRequestTurn([], "Start task", [
    {
      toolName: "ask_user_input",
      requestId: "call_123",
      type: "single-select",
      allowSkip: false,
      questions: [
        {
          header: "Mode",
          id: "mode",
          question: "Which mode?",
          options: [
            { id: "safe", label: "Safe" }
          ]
        }
      ]
    }
  ]);

  assert.equal(updated[0]?.role, "user");
  assert.equal(updated[1]?.role, "assistant");
  assert.equal(updated[1]?.tool_calls?.[0]?.id, "call_123");
});

test("appendHumanInputAnswerMessages appends tool messages keyed to the paused tool call", () => {
  const updated = appendHumanInputAnswerMessages([
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "call_123",
          type: "function",
          function: {
            name: "ask_user_input",
            arguments: "{}"
          }
        }
      ]
    }
  ], [
    {
      toolName: "ask_user_input",
      requestId: "call_123",
      type: "single-select",
      allowSkip: false,
      questions: []
    }
  ], [
    {
      requestId: "call_123",
      selections: [
        {
          questionId: "mode",
          questionText: "Which mode?",
          skipped: false,
          selectedOptions: [
            { id: "safe", label: "Safe" }
          ]
        }
      ]
    }
  ]);

  assert.equal(updated.at(-1)?.role, "tool");
  assert.equal(updated.at(-1)?.tool_call_id, "call_123");
  assert.equal(updated.at(-1)?.name, "ask_user_input");
  assert.deepEqual(JSON.parse(updated.at(-1)?.content ?? "{}"), {
    requestId: "call_123",
    answers: {
      mode: ["safe"]
    },
    selections: [
      {
        questionId: "mode",
        questionText: "Which mode?",
        skipped: false,
        selectedOptions: [
          { id: "safe", label: "Safe" }
        ]
      }
    ]
  });
});

test("commitAssistantResponse appends only the resumed assistant reply", () => {
  assert.deepEqual(commitAssistantResponse([
    { role: "assistant", content: "", tool_calls: [] }
  ], "Done"), [
    { role: "assistant", content: "", tool_calls: [] },
    { role: "assistant", content: "Done" }
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