/*
 * Feature: health endpoint reporting server readiness and config-derived state.
 * Notes: keeps responses simple and avoids depending on optional workspace files.
 * Recent changes: report generic LLM_* runtime defaults instead of bespoke env-driven tool toggles.
 */

import type { RequestHandler } from "express";
import type { EnvConfig } from "../config/env.js";
import { describeRuntimeDefaults } from "../runtime/runtimeConfig.js";

export function createHealthHandler(env: EnvConfig): RequestHandler {
  return (_req, res) => {
    res.json({
      status: "ok",
      workspaceRoot: env.workspaceRoot,
      runtime: {
        package: "llm-runtime",
        defaults: describeRuntimeDefaults(env)
      }
    });
  };
}