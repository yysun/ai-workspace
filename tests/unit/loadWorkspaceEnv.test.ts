import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { applyWorkspaceEnv, loadWorkspaceEnv } from "../../src/workspace/loadWorkspaceEnv.js";

test("loadWorkspaceEnv loads variables from the workspace .env file", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ai-workspace-env-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const target: NodeJS.ProcessEnv = {
    EXISTING_VALUE: "keep"
  };

  await mkdir(workspaceRoot);
  await writeFile(path.join(workspaceRoot, ".env"), "API_BASE_URL=https://api.example.com\nAPI_ACCESS_TOKEN=test-token\n");

  const parsed = await loadWorkspaceEnv(workspaceRoot, {
    target,
    override: true
  });

  assert.equal(parsed.API_BASE_URL, "https://api.example.com");
  assert.equal(target.API_BASE_URL, "https://api.example.com");
  assert.equal(target.API_ACCESS_TOKEN, "test-token");
  assert.equal(target.EXISTING_VALUE, "keep");
});

test("loadWorkspaceEnv ignores a missing workspace .env file", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ai-workspace-env-missing-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const target: NodeJS.ProcessEnv = {};

  await mkdir(workspaceRoot);

  const parsed = await loadWorkspaceEnv(workspaceRoot, {
    target,
    override: true
  });

  assert.deepEqual(parsed, {});
  assert.equal(target.API_BASE_URL, undefined);
});

test("applyWorkspaceEnv restores prior target values after a request completes", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ai-workspace-env-restore-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const target: NodeJS.ProcessEnv = {
    API_ACCESS_TOKEN: "server-token",
    EXISTING_VALUE: "keep"
  };

  await mkdir(workspaceRoot);
  await writeFile(path.join(workspaceRoot, ".env"), "API_BASE_URL=https://api.example.com\nAPI_ACCESS_TOKEN=workspace-token\n");

  const applied = await applyWorkspaceEnv(workspaceRoot, {
    target,
    override: true
  });

  assert.equal(applied.parsed.API_ACCESS_TOKEN, "workspace-token");
  assert.equal(target.API_ACCESS_TOKEN, "workspace-token");
  assert.equal(target.API_BASE_URL, "https://api.example.com");

  applied.restore();

  assert.equal(target.API_ACCESS_TOKEN, "server-token");
  assert.equal(target.API_BASE_URL, undefined);
  assert.equal(target.EXISTING_VALUE, "keep");
});