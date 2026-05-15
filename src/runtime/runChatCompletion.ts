/*
 * Feature: per-request llm-runtime orchestration for workspace-aware chat completion.
 * Notes: appends AGENTS.md to the server system prompt, delegates built-ins and skills to llm-runtime, and emits a unified event stream for SSE and JSON callers.
 * Recent changes: replaced the mock runtime and custom tool layer with direct llm-runtime integration.
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
  type LLMToolDefinition,
  type TurnLoopTextResponseClassification
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
import {
  classifyMissingActionEvidenceResponse,
  detectMissingToolActivityWarning
} from "./runtimeWarnings.js";
import { applyWorkspaceEnv } from "../workspace/loadWorkspaceEnv.js";

type RuntimeState = {
  messages: LLMChatMessage[];
  finalMessage?: LLMChatMessage;
  finalText: string;
};

const REJECTED_TEXT_RETRY_LIMIT = 2;

function shouldRequireActionEvidence(state: RuntimeState): boolean {
  return !state.finalText.trim();
}

function createRejectedTextRetryWarning(
  classification: TurnLoopTextResponseClassification,
  retryCount: number,
  retryLimit: number
): string | null {
  if (retryCount >= retryLimit) {
    return null;
  }

  if (classification === "intent_only_narration") {
    return "Assistant narrated the next action without calling a tool. Retrying the turn and requiring action evidence.";
  }

  if (classification === "non_progressing") {
    return "Assistant response did not make progress toward a tool action or verified final answer. Retrying the turn.";
  }

  return null;
}

function createRejectedTextTerminalError(reason: string): string {
  if (reason === "rejected_text_response") {
    return "llm-runtime rejected repeated intent-only narration before any tool action or verified final answer was produced";
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

function createToolExecutionContext(input: RunChatCompletionInput, environment: LLMEnvironment, messages: LLMChatMessage[]) {
  return {
    workingDirectory: input.workspaceRoot,
    abortSignal: input.signal,
    toolPermission: environment.defaults.toolPermission,
    reasoningEffort: environment.defaults.reasoningEffort,
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
  rawArguments: string,
  input: RunChatCompletionInput,
  environment: LLMEnvironment,
  messages: LLMChatMessage[]
): Promise<unknown> {
  if (!tool?.execute) {
    return createMissingToolResult(toolName);
  }

  return await tool.execute(
    safeParseToolArguments(rawArguments),
    createToolExecutionContext(input, environment, messages)
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
      let sawToolActivity = false;

      const result = await respondWithTools({
        initialState: {
          messages: buildRuntimeMessages(input.messages as ChatMessage[], agentsMd),
          finalText: ""
        },
        emptyTextRetryLimit: 0,
        rejectedTextRetryLimit: REJECTED_TEXT_RETRY_LIMIT,
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
        requiresActionEvidence: ({ state }) => shouldRequireActionEvidence(state),
        classifyTextResponse: ({ responseText, requiresActionEvidence }) => {
          if (!requiresActionEvidence) {
            return undefined;
          }

          const assessment = classifyMissingActionEvidenceResponse(responseText, sawToolActivity);
          if (!assessment) {
            return undefined;
          }

          return {
            classification: assessment.classification,
            transientInstruction: assessment.transientInstruction
          };
        },
        onRejectedTextResponse: async ({ state, responseText, classification, retryCount }) => {
          const actionEvidenceAssessment = classifyMissingActionEvidenceResponse(responseText, sawToolActivity);
          const warning = actionEvidenceAssessment?.warning ?? createRejectedTextRetryWarning(
            classification,
            retryCount,
            REJECTED_TEXT_RETRY_LIMIT
          );
          pendingAssistantText = "";

          if (warning) {
            eventQueue.push({
              type: "warning",
              code: "assistant_claimed_progress_without_tool_activity",
              warning
            });
          }

          return { state };
        },
        onToolCallsResponse: async ({ state, response }) => {
          const nextMessages = [...state.messages, response.assistantMessage];
          let recoveryInstruction: string | undefined;
          pendingAssistantText = "";

          for (const toolCall of response.tool_calls ?? []) {
            const toolName = toolCall.function.name;
            const parsedArgs = safeParseToolArguments(toolCall.function.arguments);
            sawToolActivity = true;

            eventQueue.push({
              type: "tool.call",
              name: toolName,
              args: parsedArgs
            });

            const toolResult = await executeToolCall(
              resolvedTools[toolName],
              toolName,
              toolCall.function.arguments,
              input,
              requestEnvironment,
              nextMessages
            );

            eventQueue.push({
              type: "tool.result",
              name: toolName,
              result: toolResult
            });

            const serializedResult = safeSerializeToolResult(toolResult);
            const validationArtifact = parseToolValidationFailureArtifact(serializedResult);
            if (validationArtifact) {
              recoveryInstruction = DEFAULT_TOOL_VALIDATION_RECOVERY_INSTRUCTION;
            }

            nextMessages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: serializedResult
            });
          }

          return {
            state: {
              ...state,
              messages: nextMessages
            },
            next: {
              control: "continue",
              ...(recoveryInstruction ? { transientInstruction: recoveryInstruction } : {})
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

        const warning = detectMissingToolActivityWarning(finalMessage.content, sawToolActivity);
        if (warning) {
          eventQueue.push({
            type: "warning",
            code: "assistant_claimed_progress_without_tool_activity",
            warning
          });
        }
      } else {
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