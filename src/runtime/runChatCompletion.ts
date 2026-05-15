/*
 * Feature: per-request llm-runtime orchestration for workspace-aware chat completion.
 * Notes: appends AGENTS.md to the server system prompt, delegates built-ins and skills to llm-runtime, and emits a unified event stream for SSE and JSON callers.
 * Recent changes: removed host-side narration regex heuristics; llm-runtime now classifies text responses structurally and the host only relays warnings/errors.
 */

import {
  createLLMEnvironment,
  DEFAULT_TOOL_VALIDATION_RECOVERY_INSTRUCTION,
  disposeLLMEnvironment,
  parseToolValidationFailureArtifact,
  resolveToolsAsync,
  respondWithTools,
  type LLMChatMessage,
  type LLMEnvironment,
  type LLMResponse,
  type LLMToolDefinition
} from "llm-runtime";
import type { EnvConfig } from "../config/env.js";
import { loadAgentsMd } from "../workspace/loadAgentsMd.js";
import {
  buildRuntimeMessages,
  createBuiltInSelection,
  createEnvironmentOptions,
  resolveMaxTokens,
  resolveTemperature,
  resolveRuntimeTarget
} from "./runtimeConfig.js";
import type { ChatMessage, RunChatCompletionInput, RuntimeEvent } from "./runtimeTypes.js";
import { applyWorkspaceEnv } from "../workspace/loadWorkspaceEnv.js";

type RuntimeState = {
  messages: LLMChatMessage[];
  finalMessage?: LLMChatMessage;
  finalText: string;
  stoppedForHumanInput: boolean;
};

const REJECTED_TEXT_RETRY_LIMIT = 2;

function createRejectedTextTerminalError(reason: string): string {
  if (reason === "rejected_text_response") {
    return "llm-runtime rejected repeated text responses without verified tool evidence or a final answer";
  }

  return `llm-runtime stopped without producing a final assistant message (${reason})`;
}

type AsyncEventQueue<T> = {
  push: (value: T) => void;
  close: () => void;
  iterator: AsyncIterable<T>;
};

function createAsyncEventQueue<T>(): AsyncEventQueue<T> {
  const values: T[] = [];
  const waiters: Array<(result: IteratorResult<T>) => void> = [];
  let closed = false;

  const iterator: AsyncIterable<T> = {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<T>> {
          if (values.length > 0) {
            return Promise.resolve({ value: values.shift() as T, done: false });
          }

          if (closed) {
            return Promise.resolve({ value: undefined, done: true });
          }

          return new Promise((resolve) => {
            waiters.push(resolve);
          });
        }
      };
    }
  };

  return {
    push(value) {
      if (closed) {
        return;
      }

      const waiter = waiters.shift();
      if (waiter) {
        waiter({ value, done: false });
        return;
      }

      values.push(value);
    },
    close() {
      if (closed) {
        return;
      }

      closed = true;
      while (waiters.length > 0) {
        const waiter = waiters.shift();
        waiter?.({ value: undefined, done: true });
      }
    },
    iterator
  };
}

function safeParseToolArguments(rawArguments: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawArguments);
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function safeSerializeToolResult(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }

  try {
    return JSON.stringify(result ?? null);
  } catch {
    return JSON.stringify({ error: "Tool result could not be serialized" });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const HUMAN_INPUT_TOOL_NAMES = new Set([
  "ask_user_input",
  "human_intervention_request",
  "ask_user_question"
]);

export function isPendingHumanInputToolResult(toolName: string, result: unknown): boolean {
  if (!HUMAN_INPUT_TOOL_NAMES.has(toolName) || !isRecord(result)) {
    return false;
  }

  return result.pending === true && result.status === "pending";
}

function isSensitiveEnvName(name: string): boolean {
  return /(^|_)(AUTH|BEARER|CREDENTIAL|KEY|PASS|PASSWORD|SECRET|TOKEN)(_|$)/i.test(name);
}

function redactKnownSecretValues(value: string, envSource: NodeJS.ProcessEnv): string {
  let redactedValue = value;

  const secretEntries = Object.entries(envSource)
    .filter((entry): entry is [string, string] => {
      const [envName, envValue] = entry;
      return !!envValue && envValue.length >= 4 && isSensitiveEnvName(envName);
    })
    .sort((left, right) => right[1].length - left[1].length);

  for (const [envName, envValue] of secretEntries) {
    redactedValue = redactedValue.split(envValue).join(`[redacted:$${envName}]`);
  }

  return redactedValue;
}

export function redactToolResultForEvent(result: unknown, envSource: NodeJS.ProcessEnv = process.env): unknown {
  if (typeof result === "string") {
    return redactKnownSecretValues(result, envSource);
  }

  if (Array.isArray(result)) {
    return result.map((entry) => redactToolResultForEvent(entry, envSource));
  }

  if (isRecord(result)) {
    return Object.fromEntries(
      Object.entries(result).map(([key, entry]) => [key, redactToolResultForEvent(entry, envSource)])
    );
  }

  return result;
}

function expandEnvReferences(value: string, envSource: NodeJS.ProcessEnv, redactSecrets: boolean): string {
  const expandedValue = value.replace(/\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g, (match, bracedName: string | undefined, bareName: string | undefined) => {
    const envName = bracedName ?? bareName;
    if (!envName) {
      return match;
    }

    const envValue = envSource[envName];
    if (envValue === undefined) {
      return match;
    }

    if (redactSecrets && isSensitiveEnvName(envName)) {
      return `[redacted:$${envName}]`;
    }

    return envValue;
  });

  return redactSecrets ? redactKnownSecretValues(expandedValue, envSource) : expandedValue;
}

function mapShellCommandValue(value: unknown, envSource: NodeJS.ProcessEnv, redactSecrets: boolean): unknown {
  if (typeof value === "string") {
    return expandEnvReferences(value, envSource, redactSecrets);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => mapShellCommandValue(entry, envSource, redactSecrets));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, mapShellCommandValue(entry, envSource, redactSecrets)])
    );
  }

  return value;
}

export function prepareToolCallArguments(
  toolName: string,
  parsedArgs: Record<string, unknown>,
  envSource: NodeJS.ProcessEnv = process.env
): { executionArgs: Record<string, unknown>; eventArgs: Record<string, unknown> } {
  if (toolName !== "shell_cmd") {
    return {
      executionArgs: parsedArgs,
      eventArgs: parsedArgs
    };
  }

  return {
    executionArgs: mapShellCommandValue(parsedArgs, envSource, false) as Record<string, unknown>,
    eventArgs: mapShellCommandValue(parsedArgs, envSource, true) as Record<string, unknown>
  };
}

function createToolExecutionContext(
  input: RunChatCompletionInput,
  environment: LLMEnvironment,
  messages: LLMChatMessage[],
  toolCallId: string | undefined
) {
  return {
    workingDirectory: input.workspaceRoot,
    abortSignal: input.signal,
    toolPermission: environment.defaults.toolPermission,
    reasoningEffort: environment.defaults.reasoningEffort,
    ...(toolCallId ? { toolCallId } : {}),
    messages: messages as unknown as Array<Record<string, unknown>>
  };
}

function createMissingToolResult(toolName: string): { error: string } {
  return {
    error: `llm-runtime did not resolve an executable tool named ${toolName}`
  };
}

async function executeToolCall(
  tool: LLMToolDefinition | undefined,
  toolName: string,
  args: Record<string, unknown>,
  input: RunChatCompletionInput,
  environment: LLMEnvironment,
  messages: LLMChatMessage[],
  toolCallId: string | undefined
): Promise<unknown> {
  if (!tool?.execute) {
    return createMissingToolResult(toolName);
  }

  return await tool.execute(
    args,
    createToolExecutionContext(input, environment, messages, toolCallId)
  );
}

function extractFinalMessage(result: { state: RuntimeState; response: LLMResponse | null; reason: string }): { role: "assistant"; content: string } | null {
  const stateMessage = result.state.finalMessage;
  if (stateMessage) {
    return {
      role: "assistant",
      content: result.state.finalText || stateMessage.content
    };
  }

  if (result.reason !== "text_response") {
    return null;
  }

  const responseMessage = result.response?.assistantMessage;
  if (responseMessage) {
    return {
      role: "assistant",
      content: result.response?.content ?? responseMessage.content
    };
  }

  return null;
}

export async function* runChatCompletion(
  input: RunChatCompletionInput,
  env: EnvConfig
): AsyncIterable<RuntimeEvent> {
  const eventQueue = createAsyncEventQueue<RuntimeEvent>();

  void (async () => {
    let restoreWorkspaceEnv: () => void = () => undefined;
    let environment: LLMEnvironment | undefined;
    let pendingAssistantText = "";

    try {
      const appliedWorkspaceEnv = await applyWorkspaceEnv(input.workspaceRoot, {
        target: process.env,
        override: true
      });
      restoreWorkspaceEnv = appliedWorkspaceEnv.restore;

      const agentsMd = await loadAgentsMd(input.workspaceRoot);
      const builtIns = createBuiltInSelection();
      const runtimeTarget = resolveRuntimeTarget(input, env);
      const requestEnvironment = createLLMEnvironment(createEnvironmentOptions(env, input.workspaceRoot));
      environment = requestEnvironment;

      const resolvedTools = await resolveToolsAsync({
        environment: requestEnvironment,
        builtIns
      });

      const result = await respondWithTools({
        initialState: {
          messages: buildRuntimeMessages(input.messages as ChatMessage[], agentsMd),
          finalText: "",
          stoppedForHumanInput: false
        },
        emptyTextRetryLimit: 0,
        rejectedTextRetryLimit: REJECTED_TEXT_RETRY_LIMIT,
        markSyntheticToolCalls: true,
        abortSignal: input.signal,
        modelRequest: {
          mode: "stream",
          environment: requestEnvironment,
          provider: runtimeTarget.provider,
          model: runtimeTarget.model,
          temperature: resolveTemperature(input, env),
          maxTokens: resolveMaxTokens(input, env),
          builtIns,
          context: {
            workingDirectory: input.workspaceRoot,
            abortSignal: input.signal,
            toolPermission: requestEnvironment.defaults.toolPermission,
            reasoningEffort: requestEnvironment.defaults.reasoningEffort
          },
          onChunk: (chunk) => {
            if (chunk.content) {
              pendingAssistantText += chunk.content;
            }
          }
        },
        onIterationStart: () => {
          pendingAssistantText = "";
        },
        buildMessages: async ({ state, transientInstruction }) => {
          if (!transientInstruction) {
            return state.messages;
          }

          return [
            ...state.messages,
            {
              role: "system",
              content: transientInstruction
            }
          ];
        },
        onRejectedTextResponse: async ({ state, classification, retryCount }) => {
          pendingAssistantText = "";

          if (retryCount < REJECTED_TEXT_RETRY_LIMIT) {
            eventQueue.push({
              type: "warning",
              code: "assistant_text_rejected_without_evidence",
              warning: `llm-runtime classified the assistant text as ${classification}; retrying.`
            });
          }

          return { state };
        },
        onToolCallsResponse: async ({ state, response }) => {
          const nextMessages = [...state.messages, response.assistantMessage];
          let recoveryInstruction: string | undefined;
          let stoppedForHumanInput = false;
          pendingAssistantText = "";

          for (const toolCall of response.tool_calls ?? []) {
            const toolName = toolCall.function.name;
            const parsedArgs = safeParseToolArguments(toolCall.function.arguments);
            const preparedArgs = prepareToolCallArguments(toolName, parsedArgs);

            eventQueue.push({
              type: "tool.call",
              name: toolName,
              args: preparedArgs.eventArgs,
              toolCallId: toolCall.id
            });

            const toolResult = await executeToolCall(
              resolvedTools[toolName],
              toolName,
              preparedArgs.executionArgs,
              input,
              requestEnvironment,
              nextMessages,
              toolCall.id
            );

            eventQueue.push({
              type: "tool.result",
              name: toolName,
              args: preparedArgs.eventArgs,
              toolCallId: toolCall.id,
              result: redactToolResultForEvent(toolResult)
            });

            if (isPendingHumanInputToolResult(toolName, toolResult)) {
              stoppedForHumanInput = true;
            }

            const serializedResult = safeSerializeToolResult(toolResult);
            const validationArtifact = parseToolValidationFailureArtifact(serializedResult);
            if (validationArtifact) {
              recoveryInstruction = DEFAULT_TOOL_VALIDATION_RECOVERY_INSTRUCTION;
            }

            nextMessages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: redactKnownSecretValues(serializedResult, process.env)
            });
          }

          return {
            state: {
              ...state,
              messages: nextMessages,
              stoppedForHumanInput
            },
            next: {
              control: stoppedForHumanInput ? "stop" : "continue",
              ...(!stoppedForHumanInput && recoveryInstruction ? { transientInstruction: recoveryInstruction } : {})
            }
          };
        },
        onTextResponse: async ({ state, response, responseText }) => {
          if (input.stream && responseText) {
            eventQueue.push({
              type: "message.delta",
              text: responseText
            });
          }
          pendingAssistantText = "";

          return {
            state: {
              ...state,
              messages: [...state.messages, response.assistantMessage],
              finalMessage: response.assistantMessage,
              finalText: responseText
            }
          };
        }
      });

      const finalMessage = extractFinalMessage(result);
      if (finalMessage) {
        eventQueue.push({
          type: "message.done",
          message: finalMessage
        });
      } else if (!result.state.stoppedForHumanInput || result.reason !== "tool_calls_response") {
        eventQueue.push({
          type: "error",
          error: createRejectedTextTerminalError(result.reason)
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown llm-runtime error";
      eventQueue.push({
        type: "error",
        error: message
      });
    } finally {
      restoreWorkspaceEnv();
      if (environment) {
        await disposeLLMEnvironment(environment).catch(() => undefined);
      }
      eventQueue.close();
    }
  })();

  yield* eventQueue.iterator;
}