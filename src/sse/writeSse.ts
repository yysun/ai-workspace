/*
 * Feature: SSE writer helpers for runtime event streaming.
 * Notes: centralizes headers and event framing for chat completion responses.
 * Recent changes: initial scaffold implementation.
 */

import type { Response } from "express";

export type SseEvent = {
  event: string;
  data: string;
};

export function writeSseHeaders(res: Response): void {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
}

export function writeSseEvent(res: Response, event: SseEvent): void {
  res.write(`event: ${event.event}\n`);
  res.write(`data: ${event.data}\n\n`);
}

export function writeSseDone(res: Response): void {
  writeSseEvent(res, {
    event: "done",
    data: "{}"
  });
  res.end();
}