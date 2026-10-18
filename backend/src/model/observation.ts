import { z } from 'zod';
const usage = z.strictObject({ inputTokens: z.number().int().nonnegative().nullable(), outputTokens: z.number().int().nonnegative().nullable(), totalTokens: z.number().int().nonnegative().nullable() });
export const modelObservationSchema = z.strictObject({
  event: z.enum(['dispatch', 'response', 'step-finished']), requestAttemptId: z.uuid(), step: z.number().int().min(1).max(6),
  configuredModel: z.string().max(128), responseModel: z.string().max(128).nullable(), providerRequestId: z.string().max(128).nullable(),
  httpStatus: z.number().int().min(100).max(599).nullable(), durationMs: z.number().int().nonnegative(), usage: usage.nullable(),
  errorCode: z.enum(['configuration', 'authentication', 'model_access', 'quota_rate_limit', 'upstream', 'network', 'refusal', 'invalid_output', 'truncated', 'timeout', 'cancelled']).nullable(),
});
export type ModelObservation = z.infer<typeof modelObservationSchema>;
export type GenerationObservation = ModelObservation & { runId: string; projectId: string; requestId: string };
export function safeModelIdentifier(value: unknown, secret: string): string | null {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._:/-]{0,127}$/.test(value) && !value.includes(secret) && !value.startsWith('sk-') ? value : null;
}
export function safeProviderRequestId(value: unknown, secret: string): string | null {
  return typeof value === 'string' && /^req_[a-zA-Z0-9_-]{4,120}$/.test(value) && !value.includes(secret) ? value : null;
}
