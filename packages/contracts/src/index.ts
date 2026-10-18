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
  'GENERATION_TIMEOUT', 'STORAGE_UNAVAILABLE', 'MODEL_CONFIGURATION', 'MODEL_AUTHENTICATION',
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
