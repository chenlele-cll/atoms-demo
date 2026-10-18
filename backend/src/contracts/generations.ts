import { z } from 'zod';
import { idSchema, runErrorSchema, runSchema } from './projects.js';
import { activitySchema, generationInputSchema, virtualPathSchema } from '../generation/contracts.js';

export const generationBodySchema = generationInputSchema.pick({ requestId: true, baseVersionId: true, prompt: true });
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
