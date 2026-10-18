import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalJSON, companyTemplateIdentity, parseTemplateBundle } from '../template-assets/bundle.mjs';

export const idSchema = z.uuid();
export const timeSchema = z.iso.datetime({ precision: 3 });
export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const titleSchema = z.string().trim().min(1).max(120);
const sourceSchema = z.strictObject({ repository: z.url(), commit: z.string().regex(/^[a-f0-9]{40}$/), license: z.literal('MIT') });

export const snapshotSchema = z.strictObject({
  id: z.string(), version: z.number().int().positive(), name: z.string(), category: z.string(),
  entry: z.string(), source: sourceSchema,
  dependencies: z.record(z.string().regex(/^(?:@[a-z0-9-]+\/)?[a-z0-9][a-z0-9._-]*$/), z.string()).refine(value => Object.keys(value).length <= 64),
  files: z.record(z.string(), z.string()), digest: digestSchema,
}).superRefine((value, context) => {
  try {
    // Historical snapshots validate their own pinned identity, not today's catalog.
    parseTemplateBundle(value, value);
    const { digest, ...content } = value;
    if (createHash('sha256').update(canonicalJSON(content)).digest('hex') !== digest) throw new Error();
  } catch { context.addIssue({ code: 'custom', message: 'Invalid snapshot' }); }
});
export type Snapshot = z.infer<typeof snapshotSchema>;

export const templateSchema = z.object({
  id: z.string(), version: z.number().int().positive(), name: z.string(), category: z.string(),
  source: sourceSchema, digest: digestSchema,
});
export const templateListSchema = z.object({ items: z.array(templateSchema) });
export const createProjectSchema = z.strictObject({
  templateId: z.literal(companyTemplateIdentity.id), templateVersion: z.number().int().positive(),
  templateDigest: digestSchema, title: titleSchema,
});
// A syntactically valid unknown template must reach the catalog and return 404.
export const projectRequestSchema = createProjectSchema.extend({ templateId: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/) });
export const sessionRequestSchema = z.strictObject({});
export const sessionResponseSchema = z.object({ expiresAt: timeSchema });
export const projectSchema = z.object({
  id: idSchema, title: titleSchema, templateId: z.string(), templateVersion: z.number().int().positive(),
  templateDigest: digestSchema, currentVersionId: idSchema, createdAt: timeSchema, updatedAt: timeSchema,
});
export const versionSchema = z.object({
  id: idSchema, projectId: idSchema, sequence: z.number().int().nonnegative(), parentVersionId: idSchema.nullable(),
  kind: z.enum(['template', 'generated']), snapshot: snapshotSchema, createdAt: timeSchema,
});
export const runStatusSchema = z.enum(['running', 'succeeded', 'failed', 'cancelled', 'interrupted']);
export const runErrorSchema = z.enum(['MODEL_ERROR', 'INVALID_OUTPUT', 'TIMEOUT', 'CANCELLED', 'INTERRUPTED', 'INTERNAL_ERROR']);
export const runSchema = z.object({
  id: idSchema, projectId: idSchema, requestId: idSchema, baseVersionId: idSchema,
  resultVersionId: idSchema.nullable(), status: runStatusSchema, errorCode: runErrorSchema.nullable(),
  startedAt: timeSchema, finishedAt: timeSchema.nullable(),
}).superRefine((run, context) => {
  const running = run.status === 'running';
  const success = run.status === 'succeeded';
  if ((running && (run.finishedAt !== null || run.errorCode !== null || run.resultVersionId !== null)) ||
      (!running && (!run.finishedAt || run.finishedAt < run.startedAt)) ||
      (success && (!run.resultVersionId || run.errorCode !== null)) ||
      (!running && !success && (run.resultVersionId !== null || run.errorCode === null))) {
    context.addIssue({ code: 'custom', message: 'Invalid run state' });
  }
});
export const messageContentSchema = z.string().refine(value => value.trim().length > 0 && Buffer.byteLength(value, 'utf8') <= 16 * 1024, 'Invalid message content');
export const messageInputSchema = z.strictObject({ role: z.enum(['user', 'assistant']), content: messageContentSchema, runId: idSchema.nullable().default(null) });
export const messageSchema = z.object({
  id: idSchema, projectId: idSchema, sequence: z.number().int().positive(),
  role: z.enum(['user', 'assistant']), content: messageContentSchema, runId: idSchema.nullable(), createdAt: timeSchema,
});
export const projectDetailSchema = z.object({ project: projectSchema, currentVersion: versionSchema, latestRun: runSchema.nullable() });
export const cursorValueSchema = z.tuple([timeSchema, idSchema]);
export function encodeCursor(value: z.infer<typeof cursorValueSchema>): string {
  return Buffer.from(JSON.stringify(cursorValueSchema.parse(value))).toString('base64url');
}
export function decodeCursor(value: string): z.infer<typeof cursorValueSchema> {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(value)) throw new Error('Invalid cursor');
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value) throw new Error('Invalid cursor');
  return cursorValueSchema.parse(JSON.parse(bytes.toString('utf8')) as unknown);
}
const integerQuery = (fallback: string, max: number, min: number) => z.string().regex(/^(0|[1-9]\d*)$/).default(fallback)
  .transform(Number).pipe(z.number().int().min(min).max(max));
const cursorSchema = z.string().max(256).refine(value => { try { decodeCursor(value); return true; } catch { return false; } }, 'Invalid cursor');
export const listQuerySchema = z.strictObject({ limit: integerQuery('20', 50, 1), cursor: cursorSchema.optional() });
export const messageQuerySchema = z.strictObject({ limit: integerQuery('20', 50, 1), afterSequence: integerQuery('0', Number.MAX_SAFE_INTEGER, 0) });
export const projectParamsSchema = z.strictObject({ projectId: idSchema });
export const projectListSchema = z.object({ items: z.array(projectSchema), nextCursor: cursorSchema.nullable() });
export const messageListSchema = z.object({ items: z.array(messageSchema), nextAfterSequence: z.number().int().nonnegative().nullable() });
export const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }), requestId: z.string() });

export type Project = z.infer<typeof projectSchema>;
export type ProjectDetail = z.infer<typeof projectDetailSchema>;
export type Version = z.infer<typeof versionSchema>;
export type Run = z.infer<typeof runSchema>;
export type Message = z.infer<typeof messageSchema>;
export type MessageInput = z.input<typeof messageInputSchema>;
