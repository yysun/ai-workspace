/*
 * Feature: unit coverage for AIW file storage provider and tool wrappers.
 * Notes: verifies durable content operations and filesystem boundary checks without external services.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileWorkspaceProvider } from "../../src/storage/providers/fileProvider.js";
import { createAiwTools } from "../../src/storage/tools/aiwTools.js";
import { createWorkspaceContext } from "../../src/storage/utils/config.js";

async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
    assert.equal(write?.ok, true);
    assert.equal(write?.data?.created, true);

    const read = await tools.read_content?.execute({ path: "data/accounts/a123/memory.md" });
    assert.equal(read?.ok, true);
    assert.equal(read?.data?.content, "Jazz Gill prefers quarterly planning notes.");
    assert.equal(read?.data?.metadata.objectType, "account");
    assert.equal(read?.data?.metadata.objectId, "a123");
    assert.equal(read?.data?.metadata.layer, "memory");
    assert.equal(read?.data?.metadata.title, "Jazz account memory");

    const list = await tools.list_content?.execute({ path: "data/accounts/a123" });
    assert.equal(list?.ok, true);
    assert.deepEqual(list?.data?.map((entry) => entry.path), ["data/accounts/a123/memory.md"]);

    const search = await tools.search_content?.execute({ query: "quarterly", pathPrefix: "data/" });
    assert.equal(search?.ok, true);
    assert.equal(search?.data?.[0]?.path, "data/accounts/a123/memory.md");

    const deleted = await tools.delete_content?.execute({ path: "data/accounts/a123/memory.md" });
    assert.equal(deleted?.ok, true);
    assert.equal(deleted?.data?.deleted, true);

    const missing = await tools.read_content?.execute({ path: "data/accounts/a123/memory.md" });
    assert.equal(missing?.ok, false);
    assert.equal(missing?.error?.code, "NOT_FOUND");
  });
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
