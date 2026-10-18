import { z } from 'zod';
import { idSchema, runErrorSchema, runStatusSchema } from '../contracts/projects.js';
import { virtualPathSchema, promptSchema, toolNameSchema } from '@atoms/contracts';
export { activitySchema, toolNameSchema } from '@atoms/contracts';
export type { GenerationActivity } from '@atoms/contracts';
export { virtualPathSchema } from '@atoms/contracts';

export const generationInputSchema = z.strictObject({
  sessionId: idSchema, projectId: idSchema, baseVersionId: idSchema, requestId: idSchema,
  prompt: promptSchema,
});
export type GenerationInput = z.infer<typeof generationInputSchema>;
export const listFilesSchema = z.strictObject({});
export const readFilesSchema = z.strictObject({ paths: z.array(virtualPathSchema).min(1).max(8).refine(paths => new Set(paths).size === paths.length) });
export const submitFilesSchema = z.strictObject({
  files: z.array(z.strictObject({ path: virtualPathSchema, content: z.string().min(1) })).min(1).max(8)
    .refine(files => new Set(files.map(file => file.path)).size === files.length),
});
export const toolNames = toolNameSchema.options;
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
