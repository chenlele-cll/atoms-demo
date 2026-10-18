import type { z } from 'zod';
import { runErrorSchema } from '../contracts/projects.js';
import { ModelError } from '../model/errors.js';
import { ProjectError } from '../projects/errors.js';

export type GenerationCode = z.infer<typeof runErrorSchema>;
export class GenerationError extends Error {
  constructor(readonly code: GenerationCode) { super(`Generation failed: ${code}`); this.name = 'GenerationError'; }
}
export function generationError(error: unknown): GenerationError {
  if (error instanceof GenerationError) return error;
  if (error instanceof ModelError) {
    const codes = { configuration: 'MODEL_CONFIGURATION', authentication: 'MODEL_AUTHENTICATION', model_access: 'MODEL_ACCESS',
      quota_rate_limit: 'MODEL_QUOTA_RATE_LIMIT', upstream: 'MODEL_UPSTREAM', network: 'MODEL_NETWORK', refusal: 'MODEL_REFUSAL',
      invalid_output: 'INVALID_OUTPUT', truncated: 'MODEL_TRUNCATED', timeout: 'GENERATION_TIMEOUT', cancelled: 'CANCELLED' } as const;
    return new GenerationError(codes[error.safe.code]);
  }
  if (error instanceof ProjectError) {
    const parsed = runErrorSchema.safeParse(error.code);
    return new GenerationError(parsed.success ? parsed.data : 'INTERNAL_ERROR');
  }
  return new GenerationError('INTERNAL_ERROR');
}
