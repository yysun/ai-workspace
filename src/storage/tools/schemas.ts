import { z } from "zod";

const readCacheControlFields = {
  cacheTtlMs: z.number().int().positive().optional(),
  bypassCache: z.boolean().optional()
};

export const resolveObjectSchema = z.object({
  query: z.string().min(1),
  objectType: z.string().optional(),
  limit: z.number().int().positive().max(50).optional(),
  ...readCacheControlFields
});

export const searchContentSchema = z.object({
  query: z.string().min(1),
  pathPrefix: z.string().optional(),
  objectType: z.string().optional(),
  objectId: z.string().optional(),
  layer: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
  ...readCacheControlFields
});

export const listContentSchema = z.object({
  path: z.string().default(""),
  limit: z.number().int().positive().max(500).optional(),
  ...readCacheControlFields
});

export const readContentSchema = z.object({
  path: z.string().min(1),
  ...readCacheControlFields
});

export const writeContentSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  contentType: z.string().optional(),
  contentEncoding: z.enum(["utf8", "base64"]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export const createContentSchema = writeContentSchema;

export const deleteContentSchema = z.object({
  path: z.string().min(1),
  reason: z.string().optional()
});
