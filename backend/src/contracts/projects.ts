import { digestSchema, idSchema, projectSchema, timeSchema, titleSchema } from '@atoms/contracts';
import { z } from 'zod';
import { companyTemplateIdentity } from '../template-assets/bundle.mjs';

export * from '@atoms/contracts';
const sourceSchema = z.strictObject({ repository: z.url(), commit: z.string().regex(/^[a-f0-9]{40}$/), license: z.literal('MIT') });

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
export const messageContentSchema = z.string().refine(value => value.trim().length > 0 && Buffer.byteLength(value, 'utf8') <= 16 * 1024, 'Invalid message content');
export const messageInputSchema = z.strictObject({ role: z.enum(['user', 'assistant']), content: messageContentSchema, runId: idSchema.nullable().default(null) });
export const messageSchema = z.object({
  id: idSchema, projectId: idSchema, sequence: z.number().int().positive(),
  role: z.enum(['user', 'assistant']), content: messageContentSchema, runId: idSchema.nullable(), createdAt: timeSchema,
});
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

export type Message = z.infer<typeof messageSchema>;
export type MessageInput = z.input<typeof messageInputSchema>;
