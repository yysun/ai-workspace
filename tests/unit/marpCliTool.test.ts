/*
 * Feature: unit coverage for the host-owned Marp CLI rendering tool.
 * Notes: verifies workspace-bound path guards and deterministic CLI invocation without depending on a live browser.
 * Recent changes: adds focused coverage for Marp rendering registration and output handling.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MARP_CLI_TOOL_NAME, createMarpCliTool } from "../../src/tools/marpCliTool.js";

async function withTempDir(run: (tempDir: string) => Promise<void>): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ai-workspace-marp-cli-tool-"));
  try {
    await run(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

test("createMarpCliTool exposes the expected host-owned tool name", () => {
  const tool = createMarpCliTool({ workspaceRoot: "/workspace", binaryPath: "/mock/marp-cli.js", execFileImpl: async () => ({ stdout: "", stderr: "" }) });
  assert.equal(tool.name, MARP_CLI_TOOL_NAME);
});

test("createMarpCliTool renders markdown into the requested workspace output path", async () => {
  await withTempDir(async (tempDir) => {
    const realTempDir = await realpath(tempDir);
    const deckPath = path.join(tempDir, "slides", "deck.md");
    await mkdir(path.dirname(deckPath), { recursive: true });
    await writeFile(deckPath, "# Demo\n\n---\n\n## Slide\n", "utf8");

    let capturedCommand = "";
    let capturedArgs: string[] = [];
    let capturedCwd = "";

    const tool = createMarpCliTool({
      workspaceRoot: tempDir,
      binaryPath: "/mock/marp-cli.js",
      execFileImpl: async (command, args, options) => {
        capturedCommand = command;
        capturedArgs = args;
        capturedCwd = options.cwd;
        const outputIndex = args.indexOf("--output");
        await writeFile(args[outputIndex + 1] as string, "<html><body>deck</body></html>", "utf8");
        return { stdout: "", stderr: "" };
      }
    });

    const result = await tool.execute?.({
      markdownPath: "slides/deck.md",
      outputFilePath: "output/deck.html"
    }, {});

    assert.equal(capturedCommand, process.execPath);
    assert.equal(capturedCwd, tempDir);
    assert.deepEqual(capturedArgs, [
      "/mock/marp-cli.js",
      "--no-config-file",
      "--output",
      path.join(tempDir, "output", "deck.html"),
      path.join(realTempDir, "slides", "deck.md")
    ]);
    assert.deepEqual(result, {
      ok: true,
      format: "html",
      markdownPath: "slides/deck.md",
      outputFilePath: "output/deck.html",
      bytesWritten: Buffer.byteLength("<html><body>deck</body></html>", "utf8"),
      message: "rendered html to output/deck.html"
    });
    assert.equal(await readFile(path.join(tempDir, "output", "deck.html"), "utf8"), "<html><body>deck</body></html>");
  });
});

test("createMarpCliTool passes format, config, and local-file flags when requested", async () => {
  await withTempDir(async (tempDir) => {
    const realTempDir = await realpath(tempDir);
    const deckPath = path.join(tempDir, "deck.md");
    const configPath = path.join(tempDir, "marp.config.js");
    await writeFile(deckPath, "# Demo\n", "utf8");
    await writeFile(configPath, "export default {};\n", "utf8");

    let capturedArgs: string[] = [];
    const tool = createMarpCliTool({
      workspaceRoot: tempDir,
      binaryPath: "/mock/marp-cli.js",
      execFileImpl: async (_command, args) => {
        capturedArgs = args;
        const outputIndex = args.indexOf("--output");
        await writeFile(args[outputIndex + 1] as string, "pptx-bytes", "utf8");
        return { stdout: "generated", stderr: "" };
      }
    });

    const result = await tool.execute?.({
      markdownPath: "deck.md",
      outputFilePath: "rendered/deck.pptx",
      format: "pptx",
      configFilePath: "marp.config.js",
      allowLocalFiles: true
    }, {});

    assert.deepEqual(capturedArgs, [
      "/mock/marp-cli.js",
      "--config-file",
      path.join(realTempDir, "marp.config.js"),
      "--pptx",
      "--allow-local-files",
      "--output",
      path.join(tempDir, "rendered", "deck.pptx"),
      path.join(realTempDir, "deck.md")
    ]);
    assert.equal((result as { stdout?: string }).stdout, "generated");
  });
});

test("createMarpCliTool rejects markdown paths outside the workspace root", async () => {
  await withTempDir(async (tempDir) => {
    const outsideFilePath = path.join(os.tmpdir(), `outside-${Date.now()}.md`);
    await writeFile(outsideFilePath, "# Secret\n", "utf8");

    try {
      const tool = createMarpCliTool({
        workspaceRoot: tempDir,
        binaryPath: "/mock/marp-cli.js",
        execFileImpl: async () => ({ stdout: "", stderr: "" })
      });

      await assert.rejects(
        async () => await tool.execute?.({
          markdownPath: outsideFilePath,
          outputFilePath: "output/deck.html"
        }, {}),
        /marp_cli markdownPath must stay within the workspace root/
      );
    } finally {
      await rm(outsideFilePath, { force: true });
    }
  });
});

test("createMarpCliTool rejects format and output extension mismatches", async () => {
  await withTempDir(async (tempDir) => {
    const deckPath = path.join(tempDir, "deck.md");
    await writeFile(deckPath, "# Demo\n", "utf8");

    const tool = createMarpCliTool({
      workspaceRoot: tempDir,
      binaryPath: "/mock/marp-cli.js",
      execFileImpl: async () => ({ stdout: "", stderr: "" })
    });

    await assert.rejects(
      async () => await tool.execute?.({
        markdownPath: "deck.md",
        outputFilePath: "output/deck.pdf",
        format: "html"
      }, {}),
      /marp_cli outputFilePath extension must match format html/
    );
  });
});