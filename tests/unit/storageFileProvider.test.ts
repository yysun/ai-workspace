/*
 * Feature: unit coverage for AIW file storage provider and tool wrappers.
 * Notes: verifies durable content operations and filesystem boundary checks without external services.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileWorkspaceProvider } from "../../src/storage/providers/fileProvider.js";
import { createAiwTools, type AiwToolResult } from "../../src/storage/tools/aiwTools.js";
import {
  createWorkspaceContext,
  formatStorageTypeForLog,
  resolveStorageType
} from "../../src/storage/utils/config.js";
import type {
  ContentSearchInput,
  ContentSearchResult,
  CreateContentInput,
  CreateContentResult,
  DeleteContentInput,
  DeleteContentResult,
  ListContentInput,
  ListContentResult,
  ReadContentInput,
  ReadContentResult,
  ResolveObjectInput,
  ResolvedObject,
  WorkspaceProvider,
  WriteContentInput,
  WriteContentResult
} from "../../src/storage/types.js";

async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function expectOk<T>(result: AiwToolResult<unknown> | undefined): T {
  assert.equal(result?.ok, true);
  return result?.data as T;
}

test("AIW storage context requires a host-provided userId", () => {
  assert.throws(
    () => createWorkspaceContext({
      envSource: {},
      storage: "file",
      fileRoot: "/tmp/aiw-storage"
    }),
    /userId is required/
  );
});

test("AIW storage context falls back to WORKSPACE_ROOT for file storage", () => {
  const context = createWorkspaceContext({
    envSource: {
      AIW_STORAGE: "file",
      AIW_USER_ID: "user-1",
      WORKSPACE_ROOT: "/tmp/workspace"
    }
  });

  assert.equal(context.fileRoot, "/tmp/workspace/users/user-1");
});

test("AIW storage context scopes an explicit fileRoot by userId", () => {
  const context = createWorkspaceContext({
    envSource: {
      AIW_STORAGE: "file",
      AIW_USER_ID: "user-1"
    },
    fileRoot: "/tmp/workspace"
  });

  assert.equal(context.fileRoot, "/tmp/workspace/users/user-1");
});

test("AIW storage log labels match configured storage type", () => {
  assert.equal(formatStorageTypeForLog(resolveStorageType(undefined)), "file");
  assert.equal(formatStorageTypeForLog(resolveStorageType("file")), "file");
  assert.equal(formatStorageTypeForLog(resolveStorageType("mssql")), "sql server");
});

test("AIW file tools write, read, list, search, and delete content", async () => {
  await withTempDir("ai-workspace-storage-", async (root) => {
    const provider = new FileWorkspaceProvider({
      storage: "file",
      workspaceId: "workspace-1",
      userId: "user-1",
      fileRoot: root
    });
    const tools = Object.fromEntries(createAiwTools(provider).map((tool) => [tool.name, tool]));

    const write = await tools.write_content?.execute({
      path: "data/accounts/a123/memory.md",
      content: "Jazz Gill prefers quarterly planning notes.",
      metadata: { title: "Jazz account memory" }
    });
    const writeData = expectOk<{ created: boolean }>(write);
    assert.equal(writeData.created, true);

    const read = await tools.read_content?.execute({ path: "data/accounts/a123/memory.md" });
    const readData = expectOk<{ content: string; metadata: { objectType?: string; objectId?: string; layer?: string; title?: string } }>(read);
    assert.equal(readData.content, "Jazz Gill prefers quarterly planning notes.");
    assert.equal(readData.metadata.objectType, "account");
    assert.equal(readData.metadata.objectId, "a123");
    assert.equal(readData.metadata.layer, "memory");
    assert.equal(readData.metadata.title, undefined);

    await assert.rejects(
      async () => await readFile(path.join(root, "data/accounts/a123/memory.md.metadata.json"), "utf8"),
      /ENOENT/
    );

    const list = await tools.list_content?.execute({ path: "data/accounts/a123" });
    const listData = expectOk<Array<{ path: string }>>(list);
    assert.deepEqual(listData.map((entry) => entry.path), ["data/accounts/a123/memory.md"]);

    const search = await tools.search_content?.execute({ query: "quarterly", pathPrefix: "data/" });
    const searchData = expectOk<Array<{ path: string }>>(search);
    assert.equal(searchData[0]?.path, "data/accounts/a123/memory.md");

    const deleted = await tools.delete_content?.execute({ path: "data/accounts/a123/memory.md" });
    const deletedData = expectOk<{ deleted: boolean }>(deleted);
    assert.equal(deletedData.deleted, true);

    const missing = await tools.read_content?.execute({ path: "data/accounts/a123/memory.md" });
    assert.equal(missing?.ok, false);
    assert.equal(missing?.error?.code, "NOT_FOUND");
  });
});

test("AIW read tools support TTL cache, bypass, expiry, and write invalidation", async () => {
  let now = 10_000;
  let searchCalls = 0;
  let readCalls = 0;

  const provider: WorkspaceProvider = {
    async searchContent(_input: ContentSearchInput): Promise<ContentSearchResult[]> {
      searchCalls += 1;
      return [{ path: `data/accounts/a123/search-${searchCalls}.md` }];
    },
    async listContent(_input: ListContentInput): Promise<ListContentResult[]> {
      return [];
    },
    async readContent(input: ReadContentInput): Promise<ReadContentResult> {
      readCalls += 1;
      return {
        path: input.path,
        content: `content-${readCalls}`,
        contentType: "text/plain",
        contentEncoding: "utf8",
        metadata: {},
        updatedAt: null
      };
    },
    async writeContent(_input: WriteContentInput): Promise<WriteContentResult> {
      return {
        path: "data/accounts/a123/memory.md",
        created: false,
        updatedAt: new Date(now).toISOString()
      };
    },
    async createContent(_input: CreateContentInput): Promise<CreateContentResult> {
      return {
        path: "data/accounts/a123/memory.md",
        created: true,
        updatedAt: new Date(now).toISOString()
      };
    },
    async deleteContent(_input: DeleteContentInput): Promise<DeleteContentResult> {
      return {
        path: "data/accounts/a123/memory.md",
        deleted: true,
        deletedAt: new Date(now).toISOString()
      };
    },
    async resolveObject(_input: ResolveObjectInput): Promise<ResolvedObject[]> {
      return [];
    },
    async doctor(): Promise<Record<string, unknown>> {
      return { ok: true };
    }
  };

  const tools = Object.fromEntries(
    createAiwTools(provider, {
      cacheNamespace: `test-cache-${Date.now()}`,
      now: () => now
    }).map((tool) => [tool.name, tool])
  );

  const firstSearch = expectOk<Array<{ path: string }>>(
    await tools.search_content?.execute({ query: "quarterly", cacheTtlMs: 500 })
  );
  const cachedSearch = expectOk<Array<{ path: string }>>(
    await tools.search_content?.execute({ query: "quarterly", cacheTtlMs: 500 })
  );
  assert.deepEqual(cachedSearch, firstSearch);
  assert.equal(searchCalls, 1);

  const bypassedSearch = expectOk<Array<{ path: string }>>(
    await tools.search_content?.execute({ query: "quarterly", cacheTtlMs: 500, bypassCache: true })
  );
  assert.equal(bypassedSearch[0]?.path, "data/accounts/a123/search-2.md");
  assert.equal(searchCalls, 2);

  now += 501;
  const expiredSearch = expectOk<Array<{ path: string }>>(
    await tools.search_content?.execute({ query: "quarterly", cacheTtlMs: 500 })
  );
  assert.equal(expiredSearch[0]?.path, "data/accounts/a123/search-3.md");
  assert.equal(searchCalls, 3);

  const firstRead = expectOk<{ content: string }>(
    await tools.read_content?.execute({ path: "data/accounts/a123/memory.md", cacheTtlMs: 500 })
  );
  const cachedRead = expectOk<{ content: string }>(
    await tools.read_content?.execute({ path: "data/accounts/a123/memory.md", cacheTtlMs: 500 })
  );
  assert.equal(firstRead.content, "content-1");
  assert.equal(cachedRead.content, "content-1");
  assert.equal(readCalls, 1);

  const write = await tools.write_content?.execute({
    path: "data/accounts/a123/memory.md",
    content: "updated"
  });
  assert.equal(write?.ok, true);

  const refreshedRead = expectOk<{ content: string }>(
    await tools.read_content?.execute({ path: "data/accounts/a123/memory.md", cacheTtlMs: 500 })
  );
  assert.equal(refreshedRead.content, "content-2");
  assert.equal(readCalls, 2);
});

test("AIW file provider rejects writes through symlinked directories outside the workspace", async () => {
  await withTempDir("ai-workspace-storage-root-", async (root) => {
    await withTempDir("ai-workspace-storage-outside-", async (outside) => {
      await symlink(outside, path.join(root, "linked"), "dir");
      const provider = new FileWorkspaceProvider({
        storage: "file",
        workspaceId: "workspace-1",
        userId: "user-1",
        fileRoot: root
      });

      await assert.rejects(
        async () => await provider.writeContent({
          path: "linked/escape.md",
          content: "outside"
        }),
        /Path escapes workspace/
      );
    });
  });
});

test("AIW file tools round-trip binary content as base64 with MIME type", async () => {
  await withTempDir("ai-workspace-storage-", async (root) => {
    const provider = new FileWorkspaceProvider({
      storage: "file",
      workspaceId: "workspace-1",
      userId: "user-1",
      fileRoot: root
    });
    const tools = Object.fromEntries(createAiwTools(provider).map((tool) => [tool.name, tool]));
    const pdfBytes = Buffer.from("%PDF-1.7\nBinary payload\u0000", "utf8");
    const pdfBase64 = pdfBytes.toString("base64");

    const write = await tools.write_content?.execute({
      path: "outputs/presentations/2026/05/17/daily-triage-2026-05-17.pdf",
      content: pdfBase64,
      metadata: { title: "Daily triage PDF" }
    });

    assert.equal(write?.ok, true);

    const read = await tools.read_content?.execute({
      path: "outputs/presentations/2026/05/17/daily-triage-2026-05-17.pdf"
    });

    const readData = expectOk<{
      content: string;
      contentType: string;
      contentEncoding: string;
      metadata: { objectType?: string; layer?: string; title?: string };
    }>(read);
    assert.equal(readData.content, pdfBase64);
    assert.equal(readData.contentType, "application/pdf");
    assert.equal(readData.contentEncoding, "base64");
    assert.equal(readData.metadata.objectType, "output");
    assert.equal(readData.metadata.layer, "output");
    assert.equal(readData.metadata.title, undefined);

    const stored = await readFile(path.join(root, "outputs/presentations/2026/05/17/daily-triage-2026-05-17.pdf"));
    assert.deepEqual(stored, pdfBytes);

    const search = await tools.search_content?.execute({ query: "JVBER", pathPrefix: "outputs/" });
    const searchData = expectOk<Array<{ path: string }>>(search);
    assert.deepEqual(searchData, []);
  });
});

test("AIW file tools auto-detect common binary and text file types", async () => {
  await withTempDir("ai-workspace-storage-", async (root) => {
    const provider = new FileWorkspaceProvider({
      storage: "file",
      workspaceId: "workspace-1",
      userId: "user-1",
      fileRoot: root
    });
    const tools = Object.fromEntries(createAiwTools(provider).map((tool) => [tool.name, tool]));

    const pptxBase64 = Buffer.from("PK\u0003\u0004pptx-bytes", "utf8").toString("base64");
    const writeDeck = await tools.write_content?.execute({
      path: "outputs/presentations/2026/05/17/account-review.pptx",
      content: pptxBase64
    });
    assert.equal(writeDeck?.ok, true);

    const readDeck = expectOk<{
      contentType: string;
      contentEncoding: string;
      content: string;
    }>(await tools.read_content?.execute({ path: "outputs/presentations/2026/05/17/account-review.pptx" }));
    assert.equal(readDeck.contentEncoding, "base64");
    assert.equal(readDeck.contentType, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    assert.equal(readDeck.content, pptxBase64);

    const writeJson = await tools.write_content?.execute({
      path: "outputs/scratch/report.json",
      content: '{"ok":true}'
    });
    assert.equal(writeJson?.ok, true);

    const readJson = expectOk<{
      contentType: string;
      contentEncoding: string;
      content: string;
    }>(await tools.read_content?.execute({ path: "outputs/scratch/report.json" }));
    assert.equal(readJson.contentEncoding, "utf8");
    assert.equal(readJson.contentType, "application/json");
    assert.equal(readJson.content, '{"ok":true}');

    const writeHtml = await tools.write_content?.execute({
      path: "outputs/scratch/preview.html",
      content: "<html><body>preview</body></html>"
    });
    assert.equal(writeHtml?.ok, true);

    const readHtml = expectOk<{
      contentType: string;
      contentEncoding: string;
    }>(await tools.read_content?.execute({ path: "outputs/scratch/preview.html" }));
    assert.equal(readHtml.contentEncoding, "utf8");
    assert.equal(readHtml.contentType, "text/html");
  });
});

test("AIW file provider rejects reads through symlinked files outside the workspace", async () => {
  await withTempDir("ai-workspace-storage-root-", async (root) => {
    await withTempDir("ai-workspace-storage-outside-", async (outside) => {
      const outsideFile = path.join(outside, "secret.md");
      await writeFile(outsideFile, "secret", "utf8");
      await symlink(outsideFile, path.join(root, "secret-link.md"));
      const provider = new FileWorkspaceProvider({
        storage: "file",
        workspaceId: "workspace-1",
        userId: "user-1",
        fileRoot: root
      });

      await assert.rejects(
        async () => await provider.readContent({ path: "secret-link.md" }),
        /Path escapes workspace/
      );
    });
  });
});

test("AIW file provider rejects searches that encounter symlinked files outside the workspace", async () => {
  await withTempDir("ai-workspace-storage-root-", async (root) => {
    await withTempDir("ai-workspace-storage-outside-", async (outside) => {
      const outsideFile = path.join(outside, "secret.md");
      await writeFile(outsideFile, "secret", "utf8");
      await symlink(outsideFile, path.join(root, "secret-link.md"));
      const provider = new FileWorkspaceProvider({
        storage: "file",
        workspaceId: "workspace-1",
        userId: "user-1",
        fileRoot: root
      });

      await assert.rejects(
        async () => await provider.searchContent({ query: "secret" }),
        /Path escapes workspace/
      );
    });
  });
});
