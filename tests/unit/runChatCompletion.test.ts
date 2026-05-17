/*
 * Feature: unit coverage for llm-runtime orchestration helpers.
 * Notes: verifies host-side helpers without calling a provider.
 * Recent changes: adds coverage for host-owned request tool registration alongside runtime helper behavior and the non-reserved cached file-read tool name.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createRequestTools,
  isPendingHumanInputToolResult,
  prepareToolCallArguments,
  redactToolResultForEvent
} from "../../src/runtime/runChatCompletion.js";

async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("createRequestTools always includes workspace_read_file and conditionally includes api_request", () => {
  assert.deepEqual(
    createRequestTools("/workspace", {}, "3").map((tool) => tool.name),
    [
      "workspace_read_file",
      "marp_cli",
      "resolve_object",
      "search_content",
      "list_content",
      "read_content",
      "write_content",
      "create_content",
      "delete_content"
    ]
  );

  assert.deepEqual(
    createRequestTools("/workspace", {
      API_BASE_URL: "https://api.example.test/root"
    }, "3").map((tool) => tool.name),
    [
      "workspace_read_file",
      "marp_cli",
      "api_request",
      "resolve_object",
      "search_content",
      "list_content",
      "read_content",
      "write_content",
      "create_content",
      "delete_content"
    ]
  );
});

test("createRequestTools includes AIW storage tools by default and honors explicit storage config", () => {
  assert.deepEqual(
    createRequestTools("/workspace", {
      AIW_STORAGE: "file"
    }, "3").map((tool) => tool.name),
    [
      "workspace_read_file",
      "marp_cli",
      "resolve_object",
      "search_content",
      "list_content",
      "read_content",
      "write_content",
      "create_content",
      "delete_content"
    ]
  );
});

test("createRequestTools uses the request workspace root for AIW file storage when no override is set", async () => {
  await withTempDir("ai-workspace-request-tools-", async (workspaceRoot) => {
    const tools = Object.fromEntries(
      createRequestTools(workspaceRoot, {
        AIW_STORAGE: "file"
      }, "3").map((tool) => [tool.name, tool])
    );

    const writeResult = await tools.write_content?.execute({
      path: "data/accounts/a123/memory.md",
      content: "Stored in the request workspace root."
    });
    assert.equal(writeResult?.ok, true);

    const storedContent = await readFile(path.join(workspaceRoot, "users/3/data/accounts/a123/memory.md"), "utf8");
    assert.equal(storedContent, "Stored in the request workspace root.");
  });
});

test("createRequestTools requires a host-provided userId for all request tools", () => {
  assert.throws(
    () => createRequestTools("/workspace", {}, " "),
    /userId is required/
  );
});

test("prepareToolCallArguments expands shell env references for execution", () => {
  const prepared = prepareToolCallArguments("shell_cmd", {
    command: "curl",
    parameters: [
      "-H",
      "Authorization: Bearer $API_ACCESS_TOKEN",
      "${API_BASE_URL}/records?search=example"
    ],
    timeout: 200000
  }, {
    API_ACCESS_TOKEN: "secret-token-value",
    API_BASE_URL: "https://api.example.test"
  });

  assert.deepEqual(prepared.executionArgs, {
    command: "curl",
    parameters: [
      "-H",
      "Authorization: Bearer secret-token-value",
      "https://api.example.test/records?search=example"
    ],
    timeout: 200000
  });

  assert.deepEqual(prepared.eventArgs, {
    command: "curl",
    parameters: [
      "-H",
      "Authorization: Bearer [redacted:$API_ACCESS_TOKEN]",
      "https://api.example.test/records?search=example"
    ],
    timeout: 200000
  });
});

test("prepareToolCallArguments leaves unresolved shell env references intact", () => {
  const prepared = prepareToolCallArguments("shell_cmd", {
    command: "curl",
    parameters: ["$MISSING_API_BASE_URL/records"]
  }, {});

  assert.deepEqual(prepared.executionArgs, {
    command: "curl",
    parameters: ["$MISSING_API_BASE_URL/records"]
  });
  assert.deepEqual(prepared.eventArgs, prepared.executionArgs);
});

test("redactToolResultForEvent redacts secrets recursively and prefers longer overlapping values", () => {
  assert.deepEqual(redactToolResultForEvent({
    stdout: "Authorization failed for abcd1234 with fallback abcd.",
    nested: ["token abcd1234", { stderr: "plain abcd" }],
    count: 1
  }, {
    API_KEY: "abcd",
    API_TOKEN: "abcd1234"
  }), {
    stdout: "Authorization failed for [redacted:$API_TOKEN] with fallback [redacted:$API_KEY].",
    nested: ["token [redacted:$API_TOKEN]", { stderr: "plain [redacted:$API_KEY]" }],
    count: 1
  });
});

test("redactToolResultForEvent redacts security context values", () => {
  assert.deepEqual(redactToolResultForEvent({
    headers: {
      "x-security-context": "tenant-secret"
    },
    body: "tenant-secret"
  }, {
    API_SECURITY_CONTEXT: "tenant-secret"
  }), {
    headers: {
      "x-security-context": "[redacted:$API_SECURITY_CONTEXT]"
    },
    body: "[redacted:$API_SECURITY_CONTEXT]"
  });
});

test("isPendingHumanInputToolResult recognizes pending human-input artifacts", () => {
  assert.equal(isPendingHumanInputToolResult("ask_user_input", {
    pending: true,
    status: "pending",
    requestId: "call_123"
  }), true);

  assert.equal(isPendingHumanInputToolResult("human_intervention_request", {
    pending: true,
    status: "pending"
  }), true);

  assert.equal(isPendingHumanInputToolResult("ask_user_input", {
    pending: false,
    status: "completed"
  }), false);

  assert.equal(isPendingHumanInputToolResult("shell_cmd", {
    pending: true,
    status: "pending"
  }), false);
});
