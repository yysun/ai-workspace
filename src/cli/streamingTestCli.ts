/*
 * Feature: interactive streaming test CLI for ai-workspace.
 * Notes: posts streaming chat requests to the local server, renders SSE deltas live, and keeps chat history in memory per process.
 * Recent changes: added a dependency-free terminal client plus pure helpers for SSE parsing and turn history management.
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout, stderr } from "node:process";
import type { ChatMessage } from "../runtime/runtimeTypes.js";

export type CliOptions = {
  baseUrl: string;
  model: string;
  autoContinue: boolean;
  autoContinueMessage: string;
  autoContinueTurns: number;
};

export type ParsedSseEvent = {
  event: string;
  data: string;
};

export type StreamProgress = {
  assistantText: string;
  errorMessage?: string;
  isComplete: boolean;
  isDone: boolean;
};

export type StreamTurnResult = {
  assistantText: string;
  sawToolActivity: boolean;
};

type WritableLike = Pick<NodeJS.WriteStream, "write"> & {
  isTTY?: boolean;
};

function readFlagValue(args: string[], flagName: string): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === flagName) {
      return args[index + 1];
    }

    if (arg?.startsWith(`${flagName}=`)) {
      return arg.slice(flagName.length + 1);
    }
  }

  return undefined;
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function readBooleanFlag(args: string[], flagName: string): boolean {
  return args.includes(flagName);
}

function isTruthy(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}

function parseOptionalPositiveInteger(value: string | undefined): number | null {
  if (!value?.trim()) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function formatGray(text: string, output: WritableLike): string {
  return output.isTTY ? `\u001b[90m${text}\u001b[0m` : text;
}

export function resolveCliOptions(args: string[], env: NodeJS.ProcessEnv): CliOptions {
  const rawBaseUrl = readFlagValue(args, "--url")
    ?? env.AI_WORKSPACE_BASE_URL
    ?? `http://localhost:${env.PORT?.trim() || "3000"}`;
  const rawModel = readFlagValue(args, "--model") ?? env.AI_WORKSPACE_MODEL ?? "default";
  const rawAutoContinueMessage = readFlagValue(args, "--auto-continue-message")
    ?? env.AI_WORKSPACE_AUTO_CONTINUE_MESSAGE
    ?? "go ahead";
  const autoContinueTurns = parseOptionalPositiveInteger(
    readFlagValue(args, "--auto-continue-turns") ?? env.AI_WORKSPACE_AUTO_CONTINUE_TURNS
  ) ?? 1;

  return {
    baseUrl: trimTrailingSlashes(rawBaseUrl.trim()),
    model: rawModel.trim() || "default",
    autoContinue: readBooleanFlag(args, "--auto-continue") || isTruthy(env.AI_WORKSPACE_AUTO_CONTINUE),
    autoContinueMessage: rawAutoContinueMessage.trim() || "go ahead",
    autoContinueTurns
  };
}

export function buildTurnMessages(history: ChatMessage[], userInput: string): ChatMessage[] {
  return [
    ...history,
    {
      role: "user",
      content: userInput
    }
  ];
}

export function commitTurn(history: ChatMessage[], userInput: string, assistantText: string): ChatMessage[] {
  return [
    ...history,
    {
      role: "user",
      content: userInput
    },
    {
      role: "assistant",
      content: assistantText
    }
  ];
}

export function extractSseEventBlocks(buffer: string): { eventBlocks: string[]; remainder: string } {
  const eventBlocks: string[] = [];
  let cursor = 0;

  while (cursor < buffer.length) {
    const match = /\r?\n\r?\n/.exec(buffer.slice(cursor));
    if (!match) {
      break;
    }

    const boundaryIndex = cursor + (match.index ?? 0);
    eventBlocks.push(buffer.slice(cursor, boundaryIndex));
    cursor = boundaryIndex + match[0].length;
  }

  return {
    eventBlocks,
    remainder: buffer.slice(cursor)
  };
}

export function parseSseEventBlock(block: string): ParsedSseEvent | null {
  const lines = block.split(/\r?\n/);
  let event = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(":")) {
      continue;
    }

    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      const rawValue = line.slice(5);
      dataLines.push(rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue);
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return {
    event,
    data: dataLines.join("\n")
  };
}

export async function* readSseEvents(stream: ReadableStream<Uint8Array>): AsyncGenerator<ParsedSseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();

    if (done) {
      buffer += decoder.decode();
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const { eventBlocks, remainder } = extractSseEventBlocks(buffer);
    buffer = remainder;

    for (const block of eventBlocks) {
      const event = parseSseEventBlock(block);
      if (event) {
        yield event;
      }
    }
  }

  if (buffer.trim()) {
    const event = parseSseEventBlock(buffer);
    if (event) {
      yield event;
    }
  }
}

function parseRuntimePayload<T>(event: ParsedSseEvent): T | null {
  try {
    return JSON.parse(event.data) as T;
  } catch {
    return null;
  }
}

export function applyStreamEvent(progress: StreamProgress, event: ParsedSseEvent): StreamProgress {
  if (event.event === "done") {
    return {
      ...progress,
      isDone: true
    };
  }

  if (event.event === "message.delta") {
    const payload = parseRuntimePayload<{ text?: unknown }>(event);
    if (typeof payload?.text !== "string") {
      return progress;
    }

    return {
      ...progress,
      assistantText: progress.assistantText + payload.text
    };
  }

  if (event.event === "message.done") {
    const payload = parseRuntimePayload<{ message?: { content?: unknown } }>(event);
    if (typeof payload?.message?.content !== "string") {
      return {
        ...progress,
        isComplete: true
      };
    }

    return {
      ...progress,
      assistantText: payload.message.content,
      isComplete: true
    };
  }

  if (event.event === "error") {
    const payload = parseRuntimePayload<{ error?: unknown }>(event);
    return {
      ...progress,
      errorMessage: typeof payload?.error === "string" ? payload.error : "Unknown runtime error"
    };
  }

  return progress;
}

async function readErrorResponse(response: Response): Promise<string> {
  const responseText = await response.text();

  try {
    const payload = JSON.parse(responseText) as { error?: unknown };
    if (typeof payload.error === "string") {
      return payload.error;
    }
  } catch {
    // Fall through to the raw body text.
  }

  return responseText || `Request failed with status ${response.status}`;
}

export function shouldAutoContinue(assistantText: string, sawToolActivity: boolean): boolean {
  if (sawToolActivity) {
    return false;
  }

  const normalizedText = assistantText.trim();
  if (!normalizedText) {
    return false;
  }

  return /\b(i('|’)ll|i will)\b/i.test(normalizedText)
    || /\bbefore i proceed\b/i.test(normalizedText)
    || /\bwould you like me to\b/i.test(normalizedText)
    || /\bdo you want me to\b/i.test(normalizedText)
    || /\bshall i\b/i.test(normalizedText)
    || /\bshould i\b/i.test(normalizedText)
    || /\bif you'd like\b/i.test(normalizedText)
    || /\bif you want\b/i.test(normalizedText)
    || /\?$/.test(normalizedText);
}

export async function streamAssistantTurn(
  options: CliOptions,
  history: ChatMessage[],
  userInput: string,
  output: WritableLike,
  errorOutput: WritableLike
): Promise<StreamTurnResult> {
  const messages = buildTurnMessages(history, userInput);
  const response = await fetch(`${options.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: options.model,
      stream: true,
      messages
    })
  });

  if (!response.ok) {
    throw new Error(await readErrorResponse(response));
  }

  if (!response.body) {
    throw new Error("Streaming response body is missing");
  }

  let progress: StreamProgress = {
    assistantText: "",
    isComplete: false,
    isDone: false
  };
  let sawToolActivity = false;

  output.write("assistant> ");

  for await (const event of readSseEvents(response.body)) {
    const previousText = progress.assistantText;
    progress = applyStreamEvent(progress, event);

    if (
      (event.event === "message.delta" || event.event === "message.done")
      && progress.assistantText.startsWith(previousText)
      && progress.assistantText.length > previousText.length
    ) {
      output.write(progress.assistantText.slice(previousText.length));
    }

    if (event.event === "tool.call") {
      sawToolActivity = true;
      const payload = parseRuntimePayload<{ name?: unknown }>(event);
      if (typeof payload?.name === "string") {
        errorOutput.write(`${formatGray(`\n[tool.call] ${payload.name}\n`, errorOutput)}`);
        output.write(`assistant> ${progress.assistantText}`);
      }
    }

    if (event.event === "tool.result") {
      sawToolActivity = true;
      const payload = parseRuntimePayload<{ name?: unknown }>(event);
      if (typeof payload?.name === "string") {
        errorOutput.write(`${formatGray(`\n[tool.result] ${payload.name}\n`, errorOutput)}`);
        output.write(`assistant> ${progress.assistantText}`);
      }
    }

    if (progress.isDone) {
      break;
    }
  }

  output.write("\n");

  if (progress.errorMessage) {
    throw new Error(progress.errorMessage);
  }

  if (!progress.assistantText.trim() && !progress.isComplete) {
    throw new Error("Stream ended before an assistant response was completed");
  }

  return {
    assistantText: progress.assistantText,
    sawToolActivity
  };
}

export async function runStreamingTestCli(args = process.argv.slice(2)): Promise<void> {
  const options = resolveCliOptions(args, process.env);
  const readline = createInterface({
    input: stdin,
    output: stdout
  });
  let history: ChatMessage[] = [];

  stdout.write(`Streaming test CLI connected to ${options.baseUrl}\n`);
  stdout.write(`Model: ${options.model}\n`);
  if (options.autoContinue) {
    stdout.write(`Auto-continue: ${options.autoContinueMessage} (${options.autoContinueTurns} max per prompt)\n`);
  }
  stdout.write("Commands: /clear to reset history, /exit to quit\n\n");

  try {
    while (true) {
      const input = (await readline.question("you> ")).trim();

      if (!input) {
        continue;
      }

      if (input === "/exit" || input === "/quit") {
        break;
      }

      if (input === "/clear") {
        history = [];
        stdout.write("history cleared\n\n");
        continue;
      }

      try {
        let nextInput = input;
        let remainingAutoTurns = options.autoContinue ? options.autoContinueTurns : 0;

        while (true) {
          const result = await streamAssistantTurn(options, history, nextInput, stdout, stderr);
          history = commitTurn(history, nextInput, result.assistantText);
          stdout.write("\n");

          if (remainingAutoTurns < 1 || !shouldAutoContinue(result.assistantText, result.sawToolActivity)) {
            break;
          }

          remainingAutoTurns -= 1;
          nextInput = options.autoContinueMessage;
          stdout.write(formatGray(`[auto] you> ${nextInput}\n`, stdout));
        }

        stdout.write("\n");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stderr.write(`request failed: ${message}\n\n`);
      }
    }
  } finally {
    readline.close();
  }
}