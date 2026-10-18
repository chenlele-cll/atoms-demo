import { z } from 'zod';
import { idSchema, runErrorSchema, runStatusSchema } from '../contracts/projects.js';
import { validateVirtualPath } from '../template-assets/bundle.mjs';

export const generationInputSchema = z.strictObject({
  sessionId: idSchema, projectId: idSchema, baseVersionId: idSchema, requestId: idSchema,
  prompt: z.string().trim().min(1).max(4000).refine(value => Buffer.byteLength(value, 'utf8') <= 16 * 1024),
});
export type GenerationInput = z.infer<typeof generationInputSchema>;
export const virtualPathSchema = z.string().max(240).refine(value => { try { validateVirtualPath(value); return true; } catch { return false; } });
export const listFilesSchema = z.strictObject({});
export const readFilesSchema = z.strictObject({ paths: z.array(virtualPathSchema).min(1).max(8).refine(paths => new Set(paths).size === paths.length) });
export const submitFilesSchema = z.strictObject({
  files: z.array(z.strictObject({ path: virtualPathSchema, content: z.string().min(1) })).min(1).max(8)
    .refine(files => new Set(files.map(file => file.path)).size === files.length),
});
export const toolNames = ['list_files', 'read_files', 'submit_files'] as const;
export const toolNameSchema = z.enum(toolNames);
export type ToolName = z.infer<typeof toolNameSchema>;
export const toolSchemas = { list_files: listFilesSchema, read_files: readFilesSchema, submit_files: submitFilesSchema };
export const generationTools = {
  list_files: { description: 'List frozen project paths, UTF-8 sizes and writable flags.', inputSchema: listFilesSchema, strict: true },
  read_files: { description: 'Read 1-8 complete frozen project files before editing them. Maximum 96 KiB per read.', inputSchema: readFilesSchema, strict: true },
  submit_files: { description: 'Terminal: submit 1-8 complete changed files once. No deletes or metadata. Maximum 256 KiB. Save is not preview validation.', inputSchema: submitFilesSchema, strict: true },
};
export const CONTEXT_BYTES = 256 * 1024;
export const MAX_REQUESTS = 6;
const usageSchema = z.strictObject({ inputTokens: z.number().nullable(), outputTokens: z.number().nullable(), totalTokens: z.number().nullable() });
export const metricsSchema = z.strictObject({ requestCount: z.number().int().nonnegative().nullable(), usage: usageSchema.nullable(), requests: z.array(usageSchema.nullable()).nullable() });
export const generationResultSchema = z.strictObject({
  status: runStatusSchema, runId: idSchema.nullable(), baseVersionId: idSchema.nullable(), candidateVersionId: idSchema.nullable(),
  changedFiles: z.array(virtualPathSchema), summary: z.string().nullable(), candidateDigest: z.string().nullable(),
  previewStatus: z.literal('unverified'), errorCode: runErrorSchema.nullable(), terminalStatePersisted: z.boolean(),
  replayed: z.boolean(), metrics: metricsSchema, observerErrors: z.number().int().nonnegative(),
});
export type GenerationResult = z.infer<typeof generationResultSchema>;
export const activitySchema = z.strictObject({
  runId: idSchema, sequence: z.number().int().positive(), at: z.iso.datetime(),
  type: z.enum(['request-started', 'request-finished', 'tool-started', 'tool-finished', 'validated', 'saved', 'ended']),
  step: z.number().int().nonnegative(), tool: toolNameSchema.optional(), bytes: z.number().int().nonnegative().optional(),
  changedFiles: z.array(virtualPathSchema).optional(), candidateVersionId: idSchema.optional(),
  status: runStatusSchema.optional(), errorCode: runErrorSchema.optional(),
});
export type GenerationActivity = z.infer<typeof activitySchema>;
