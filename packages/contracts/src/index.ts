import { z } from 'zod';
export type { z } from 'zod';
import { sha256 } from '@noble/hashes/sha2.js';
import { canonicalJSON, parseTemplateBundle, validateVirtualPath } from './template-assets/bundle.mjs';

export { canonicalJSON } from './template-assets/bundle.mjs';
export const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength;
export function snapshotDigest(content: unknown): string {
  return Array.from(sha256(new TextEncoder().encode(canonicalJSON(content))), byte => byte.toString(16).padStart(2, '0')).join('');
}

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
    if (snapshotDigest(content) !== digest) throw new Error();
  } catch { context.addIssue({ code: 'custom', message: 'Invalid snapshot' }); }
});
export type Snapshot = z.infer<typeof snapshotSchema>;

export const templateSchema = z.object({
  id: z.string(), version: z.number().int().positive(), name: z.string(), category: z.string(),
  source: sourceSchema, digest: digestSchema,
});
export const templateListSchema = z.object({ items: z.array(templateSchema) });
export const projectSchema = z.object({
  id: idSchema, title: titleSchema, templateId: z.string(), templateVersion: z.number().int().positive(),
  templateDigest: digestSchema, currentVersionId: idSchema, createdAt: timeSchema, updatedAt: timeSchema,
});
export const versionSchema = z.object({
  id: idSchema, projectId: idSchema, sequence: z.number().int().nonnegative(), parentVersionId: idSchema.nullable(),
  kind: z.enum(['template', 'generated']), snapshot: snapshotSchema, createdAt: timeSchema,
}).superRefine((version, ctx) => {
  if ((version.kind === 'template' && (version.sequence !== 0 || version.parentVersionId !== null)) ||
    (version.kind === 'generated' && (version.sequence === 0 || version.parentVersionId === null || version.parentVersionId === version.id))) {
    ctx.addIssue({ code: 'custom', message: 'Invalid version ancestry' });
  }
});
export const runStatusSchema = z.enum(['running', 'succeeded', 'failed', 'cancelled', 'interrupted']);
export const runErrorSchema = z.enum([
  'USER_CANCELLED', 'CLIENT_DISCONNECTED', 'SERVER_SHUTDOWN', 'PROCESS_RESTARTED', 'SLOW_CONSUMER', 'STREAM_WRITE_FAILED',
  'MODEL_ERROR', 'INVALID_OUTPUT', 'TIMEOUT', 'CANCELLED', 'INTERRUPTED', 'INTERNAL_ERROR',
  'INVALID_INPUT', 'SESSION_REQUIRED', 'NOT_FOUND', 'REQUEST_CONFLICT', 'BASE_VERSION_CHANGED',
  'UNSUPPORTED_TEMPLATE', 'FILE_POLICY', 'TOOL_ERROR', 'NO_SUBMISSION', 'STEP_LIMIT', 'CONTEXT_LIMIT',
  'GENERATION_TIMEOUT', 'STORAGE_UNAVAILABLE', 'DATA_CORRUPT', 'MODEL_CONFIGURATION', 'MODEL_AUTHENTICATION',
  'MODEL_ACCESS', 'MODEL_QUOTA_RATE_LIMIT', 'MODEL_UPSTREAM', 'MODEL_NETWORK', 'MODEL_REFUSAL', 'MODEL_TRUNCATED',
]);
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

export const projectDetailSchema = z.object({ project: projectSchema, currentVersion: versionSchema, latestRun: runSchema.nullable() });

export const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }), requestId: z.string() });

export type Project = z.infer<typeof projectSchema>;
export type ProjectDetail = z.infer<typeof projectDetailSchema>;
export type Version = z.infer<typeof versionSchema>;
export type Run = z.infer<typeof runSchema>;

export const virtualPathSchema = z.string().max(240).refine(value => { try { validateVirtualPath(value); return true; } catch { return false; } });
export const versionParamsSchema = z.strictObject({ projectId: idSchema, versionId: idSchema });
export const adoptionAvailabilitySchema = z.enum(['eligible', 'already-current', 'stale', 'busy', 'unconfirmed', 'not-candidate']);
export const versionReviewSchema = z.object({
  version: versionSchema, successfulRun: runSchema.nullable(), changedFiles: z.array(virtualPathSchema).max(128),
  currentVersionId: idSchema, adoptionAvailability: adoptionAvailabilitySchema,
}).superRefine((value, ctx) => {
  if (value.successfulRun && (value.successfulRun.status !== 'succeeded' || value.successfulRun.projectId !== value.version.projectId ||
    value.successfulRun.resultVersionId !== value.version.id || value.successfulRun.baseVersionId !== value.version.parentVersionId)) {
    ctx.addIssue({ code: 'custom', message: 'Invalid candidate association' });
  }
});
export const adoptRequestSchema = z.strictObject({ expectedCurrentVersionId: idSchema });
export const adoptResponseSchema = z.object({ projectId: idSchema, currentVersionId: idSchema, updatedAt: timeSchema, alreadyCurrent: z.boolean() });
export type VersionReview = z.infer<typeof versionReviewSchema>;
export type Adoption = z.infer<typeof adoptResponseSchema>;
export const restoreRequestSchema = adoptRequestSchema;
export const restoreResponseSchema = adoptResponseSchema;
export type Restoration = z.infer<typeof restoreResponseSchema>;

export const VERSION_HISTORY_MAX_BYTES = 1024 * 1024;
const historyIntegerQuery = z.string().regex(/^(0|[1-9]\d*)$/).transform(Number).pipe(z.number().int().min(0).max(Number.MAX_SAFE_INTEGER));
export const versionHistoryQuerySchema = z.strictObject({
  limit: historyIntegerQuery.default(20).pipe(z.number().min(1).max(50)),
  beforeSequence: historyIntegerQuery.optional(),
});
const historyTextSchema = z.string().min(1).max(480).refine(value => Array.from(value).length <= 240);
export const versionHistoryItemSchema = z.object({
  id: idSchema, sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  parentVersionId: idSchema.nullable(), kind: z.enum(['template', 'generated']), createdAt: timeSchema,
  isCurrent: z.boolean(), runId: idSchema.nullable(),
  request: z.object({ messageId: idSchema, excerpt: historyTextSchema, truncated: z.boolean() }).nullable(),
  summary: z.object({ source: z.enum(['stored', 'fallback']), text: historyTextSchema }),
  changedFiles: z.array(virtualPathSchema).max(128),
}).superRefine((item, ctx) => {
  if ((item.kind === 'template' && (item.sequence !== 0 || item.parentVersionId !== null || item.runId !== null || item.request !== null || item.changedFiles.length !== 0)) ||
    (item.kind === 'generated' && (item.sequence === 0 || item.parentVersionId === null || item.parentVersionId === item.id)) ||
    (item.runId === null && (item.request !== null || item.summary.source === 'stored')) ||
    item.changedFiles.some((path, index) => index > 0 && (item.changedFiles[index - 1] ?? '') >= path)) {
    ctx.addIssue({ code: 'custom', message: 'Invalid history association' });
  }
});
export const versionHistorySchema = z.object({
  projectId: idSchema, currentVersionId: idSchema, items: z.array(versionHistoryItemSchema).max(50),
  nextBeforeSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
}).superRefine((value, ctx) => {
  const ids = new Set<string>();
  const sequences = new Map(value.items.map(item => [item.id, item.sequence]));
  if (value.items.some((item, index) => {
    const duplicate = ids.has(item.id); ids.add(item.id);
    const parentSequence = item.parentVersionId ? sequences.get(item.parentVersionId) : undefined;
    return duplicate || item.isCurrent !== (item.id === value.currentVersionId) ||
      (parentSequence !== undefined && parentSequence >= item.sequence) ||
      (index > 0 && (value.items[index - 1]?.sequence ?? 0) <= item.sequence);
  }) || (value.nextBeforeSequence !== null && (value.nextBeforeSequence === 0 || value.items.at(-1)?.sequence !== value.nextBeforeSequence))) {
    ctx.addIssue({ code: 'custom', message: 'Invalid history page' });
  }
  if (utf8Bytes(JSON.stringify(value)) > VERSION_HISTORY_MAX_BYTES) ctx.addIssue({ code: 'custom', message: 'History response exceeds limit' });
});
export type VersionHistory = z.infer<typeof versionHistorySchema>;

export const sessionRequestSchema = z.strictObject({});
export const sessionResponseSchema = z.object({ expiresAt: timeSchema });

export const messageContentSchema = z.string().refine(value => value.trim().length > 0 && utf8Bytes(value) <= 16 * 1024, 'Invalid message content');
export const messageInputSchema = z.strictObject({ role: z.enum(['user', 'assistant']), content: messageContentSchema, runId: idSchema.nullable().default(null) });
export const messageSchema = z.object({
  id: idSchema, projectId: idSchema, sequence: z.number().int().positive(),
  role: z.enum(['user', 'assistant']), content: messageContentSchema, runId: idSchema.nullable(), createdAt: timeSchema,
});
export const cursorValueSchema = z.tuple([timeSchema, idSchema]);
export function encodeCursor(value: z.infer<typeof cursorValueSchema>): string {
  return btoa(JSON.stringify(cursorValueSchema.parse(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeCursor(value: string): z.infer<typeof cursorValueSchema> {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(value)) throw new Error('Invalid cursor');
  const parsed = cursorValueSchema.parse(JSON.parse(atob(value.replace(/-/g, '+').replace(/_/g, '/'))) as unknown);
  if (encodeCursor(parsed) !== value) throw new Error('Invalid cursor');
  return parsed;
}
const integerQuery = (fallback: string, max: number, min: number) => z.string().regex(/^(0|[1-9]\d*)$/).default(fallback)
  .transform(Number).pipe(z.number().int().min(min).max(max));
const cursorSchema = z.string().max(256).refine(value => { try { decodeCursor(value); return true; } catch { return false; } }, 'Invalid cursor');
export const listQuerySchema = z.strictObject({ limit: integerQuery('20', 50, 1), cursor: cursorSchema.optional() });
export const messageQuerySchema = z.union([
  z.strictObject({ direction: z.literal('backward'), limit: integerQuery('50', 50, 1), beforeSequence: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)).optional() }),
  z.strictObject({ limit: integerQuery('20', 50, 1), afterSequence: integerQuery('0', Number.MAX_SAFE_INTEGER, 0) }),
]);
export const projectParamsSchema = z.strictObject({ projectId: idSchema });
export const projectListSchema = z.object({ items: z.array(projectSchema), nextCursor: cursorSchema.nullable() });
export const messageListSchema = z.object({ items: z.array(messageSchema), nextAfterSequence: z.number().int().nonnegative().nullable() });

export type Message = z.infer<typeof messageSchema>;
export type MessageInput = z.input<typeof messageInputSchema>;

export const backwardMessageListSchema = z.object({ items: z.array(messageSchema).max(50), nextBeforeSequence: z.number().int().positive().nullable(), latestSequence: z.number().int().nonnegative() });
export const messagePageSchema = z.union([backwardMessageListSchema, messageListSchema]);
export const projectRequestSchema = z.strictObject({ templateId: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/), templateVersion: z.number().int().positive(), templateDigest: digestSchema, title: titleSchema });
export const promptSchema = z.string().trim().min(1).max(4000).refine(value => utf8Bytes(value) <= 16 * 1024);
export const generationBodySchema = z.strictObject({ requestId: idSchema, baseVersionId: idSchema, prompt: promptSchema });
export const toolNameSchema = z.enum(['list_files', 'read_files', 'submit_files']);
export const activitySchema = z.strictObject({
  runId: idSchema, sequence: z.number().int().positive(), at: z.iso.datetime(),
  type: z.enum(['request-started', 'request-finished', 'tool-started', 'tool-finished', 'agent-started', 'agent-finished', 'agent-tool-finished', 'validated', 'saved', 'ended']),
  step: z.number().int().nonnegative(), tool: toolNameSchema.optional(), bytes: z.number().int().nonnegative().optional(),
  agentTool: z.enum(['read', 'glob', 'grep', 'edit', 'write', 'apply_patch']).optional(),
  changedFiles: z.array(virtualPathSchema).optional(), candidateVersionId: idSchema.optional(),
  status: runStatusSchema.optional(), errorCode: runErrorSchema.optional(),
});
export type GenerationActivity = z.infer<typeof activitySchema>;
export const generationParamsSchema = z.strictObject({ projectId: idSchema, requestId: idSchema });
export const generationStatusSchema = z.strictObject({
  projectId: idSchema, requestId: idSchema, runId: idSchema, baseVersionId: idSchema,
  status: z.enum([...runSchema.shape.status.options, 'unknown']), startedAt: z.iso.datetime(), finishedAt: z.iso.datetime().nullable(),
  errorCode: runErrorSchema.nullable(), cancellationRequested: z.boolean(), terminalStatePersisted: z.boolean(),
  candidateVersionId: idSchema.nullable(), changedFiles: z.array(virtualPathSchema).max(8),
  previewStatus: z.literal('unverified'), usage: z.null(),
}).superRefine((value, ctx) => {
  const terminal = value.status !== 'running' && value.status !== 'unknown';
  if (value.terminalStatePersisted !== terminal || (value.finishedAt !== null) !== terminal ||
    (value.status === 'succeeded') !== (value.candidateVersionId !== null) ||
    (value.status !== 'succeeded' && value.changedFiles.length > 0) ||
    (['running', 'succeeded'].includes(value.status) ? value.errorCode !== null : value.errorCode === null)) {
    ctx.addIssue({ code: 'custom', message: 'Inconsistent generation state' });
  }
});
export type GenerationStatus = z.infer<typeof generationStatusSchema>;
const association = { projectId: idSchema, requestId: idSchema, runId: idSchema, baseVersionId: idSchema };
const frame = { ...association, seq: z.number().int().positive(), at: z.iso.datetime() };
export const generationEventSchema = z.discriminatedUnion('event', [
  z.strictObject({ ...frame, event: z.literal('accepted'), seq: z.literal(1) }),
  z.strictObject({ ...frame, event: z.literal('activity'), activity: activitySchema.omit({ runId: true, sequence: true, at: true })
    .extend({ type: activitySchema.shape.type.exclude(['ended']) }) }),
  z.strictObject({ ...frame, event: z.literal('terminal'), state: generationStatusSchema.refine(state => state.status !== 'running') }),
]).superRefine((value, ctx) => {
  if (value.event !== 'accepted' && value.seq < 2) ctx.addIssue({ code: 'custom', message: 'Invalid sequence' });
  if (value.event === 'terminal' && Object.keys(association).some(key =>
    Reflect.get(value, key) !== Reflect.get(value.state, key))) ctx.addIssue({ code: 'custom', message: 'Invalid association' });
});
export type GenerationEvent = z.infer<typeof generationEventSchema>;
