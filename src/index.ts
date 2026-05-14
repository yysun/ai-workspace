/*
 * Feature: application entrypoint for the ai-workspace server.
 * Notes: loads optional local .env values, starts the HTTP server, and handles shutdown signals.
 * Recent changes: added dotenv bootstrap for local development while keeping process.env as the only runtime config source.
 */

import "dotenv/config";
import { createServer } from "./server.js";
import { loadEnv } from "./config/env.js";

async function main(): Promise<void> {
  const env = loadEnv(process.env);
  const app = createServer(env);
  const server = app.listen(env.port, () => {
    console.log(`ai-workspace listening on port ${env.port}`);
    console.log(`workspace root: ${env.workspaceRoot}`);
  });

  const shutdown = (signal: NodeJS.Signals) => {
    console.log(`received ${signal}, shutting down`);
    server.close((error?: Error) => {
      if (error) {
        console.error(error);
        process.exitCode = 1;
      }
      process.exit();
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});