/*
 * Feature: placeholder request verification middleware.
 * Notes: intentionally permissive in v1 and reserved for future authentication or authorization checks.
 * Recent changes: initial scaffold implementation.
 */

import type { RequestHandler } from "express";
import type { EnvConfig } from "../config/env.js";

export function verifyRequest(_env: EnvConfig): RequestHandler {
  return (_req, _res, next) => {
    next();
  };
}