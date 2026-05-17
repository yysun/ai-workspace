/*
 * Feature: unit coverage for the host-owned cached read_file tool.
 * Notes: verifies cache reuse, invalidation on file changes, and workspace-boundary enforcement without calling llm-runtime.
 * Recent changes: adds focused coverage for the cached read_file replacement tool.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createReadFileTool } from "../../src/tools/readFileTool.js";

async function withTempDir(run: (tempDir: string) => Promise<void>): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ai-workspace-read-file-tool-"));
  try {
    await run(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

test("createReadFileTool reuses cached content for identical reads", async () => {
  await withTempDir(async (tempDir) => {
    const cache = new Map<string, string>();
    const filePath = path.join(tempDir, "notes.md");
    await writeFile(filePath, "alpha\nbeta\ngamma\n", "utf8");

    let readCount = 0;
    const tool = createReadFileTool({
      workspaceRoot: tempDir,
      cache,
      readFileImpl: async (resolvedFilePath) => {
        readCount += 1;
        return await readFile(resolvedFilePath, "utf8");
      }
    });

    const firstResult = await tool.execute?.({ filePath: "notes.md" });
    const secondResult = await tool.execute?.({ filePath: "notes.md" });

    assert.equal(firstResult, "alpha\nbeta\ngamma\n");
    assert.equal(secondResult, "alpha\nbeta\ngamma\n");
    assert.equal(readCount, 1);
  });
});

test("createReadFileTool invalidates the cache when the file version changes", async () => {
  await withTempDir(async (tempDir) => {
    const cache = new Map<string, string>();
    const filePath = path.join(tempDir, "notes.md");
    await writeFile(filePath, "alpha\nbeta\ngamma\n", "utf8");

    let readCount = 0;
    const tool = createReadFileTool({
      workspaceRoot: tempDir,
      cache,
      readFileImpl: async (resolvedFilePath) => {
        readCount += 1;
        return await readFile(resolvedFilePath, "utf8");
      }
    });

    const firstResult = await tool.execute?.({ filePath: "notes.md" });
    await writeFile(filePath, "alpha\nbeta updated\ngamma\n", "utf8");
    const secondResult = await tool.execute?.({ filePath: "notes.md" });

    assert.equal(firstResult, "alpha\nbeta\ngamma\n");
    assert.equal(secondResult, "alpha\nbeta updated\ngamma\n");
    assert.equal(readCount, 2);
  });
});

test("createReadFileTool returns the requested line range when provided", async () => {
  await withTempDir(async (tempDir) => {
    const filePath = path.join(tempDir, "notes.md");
    await writeFile(filePath, "alpha\nbeta\ngamma\ndelta\n", "utf8");

    const tool = createReadFileTool({ workspaceRoot: tempDir, cache: new Map<string, string>() });
    const result = await tool.execute?.({ filePath: "notes.md", startLine: 2, endLine: 3 });

    assert.equal(result, "beta\ngamma\n");
  });
});

test("createReadFileTool truncates oversized reads with a clear notice", async () => {
  await withTempDir(async (tempDir) => {
    const filePath = path.join(tempDir, "large.json");
    const content = `{\"items\":[\"${"x".repeat(64)}\"]}`;
    await writeFile(filePath, content, "utf8");

    const tool = createReadFileTool({
      workspaceRoot: tempDir,
      cache: new Map<string, string>(),
      maxReturnCharacters: 24
    });
    const result = await tool.execute?.({ filePath: "large.json" });

    assert.equal(
      result,
      [
        "[workspace_read_file truncated large.json: the full file is 78 characters; returning the first 24 characters to stay within the token budget. Re-run with a narrower startLine/endLine range if needed.]",
        content.slice(0, 24)
      ].join("\n\n")
    );
  });
});

test("createReadFileTool rejects paths outside the workspace root", async () => {
  await withTempDir(async (tempDir) => {
    const outsideFilePath = path.join(os.tmpdir(), `outside-${Date.now()}.md`);
    await writeFile(outsideFilePath, "secret\n", "utf8");

    const tool = createReadFileTool({ workspaceRoot: tempDir, cache: new Map<string, string>() });

    await assert.rejects(
      async () => await tool.execute?.({ filePath: outsideFilePath }),
      /read_file path must stay within the workspace root/
    );

    await rm(outsideFilePath, { force: true });
  });
});

test("createReadFileTool reports missing files with a clear error", async () => {
  await withTempDir(async (tempDir) => {
    const tool = createReadFileTool({ workspaceRoot: tempDir, cache: new Map<string, string>() });

    await assert.rejects(
      async () => await tool.execute?.({ filePath: "missing.md" }),
      /read_file could not find missing\.md/
    );
  });
});