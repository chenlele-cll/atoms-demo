import { APICallError } from 'ai';

export type ModelErrorCode =
  | 'configuration' | 'authentication' | 'model_access' | 'quota_rate_limit'
  | 'upstream' | 'network' | 'refusal' | 'invalid_output' | 'truncated'
  | 'timeout' | 'cancelled';

export type SafeModelError = {
  code: ModelErrorCode;
  status: number | null;
  retryable: boolean;
};

// These errors deliberately retain neither the provider exception nor its cause.
export class ModelError extends Error {
  readonly safe: SafeModelError;

  constructor(code: ModelErrorCode, status: number | null = null) {
    super(`Model operation failed: ${code}`);
    this.name = 'ModelError';
    this.safe = { code, status, retryable: ['quota_rate_limit', 'upstream', 'network', 'timeout'].includes(code) };
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

export function inspectResponse(body: unknown): void {
  const data = record(body);
  if (!data) return;
  if (Array.isArray(data['output'])) {
    for (const item of data['output']) {
      const output = record(item);
      const status = output?.['status'];
      if (status === 'incomplete') throw new ModelError('truncated');
      if (typeof status === 'string' && status !== 'completed') throw new ModelError('invalid_output');
      const content = output?.['content'];
      if (Array.isArray(content) && content.some(part => record(part)?.['type'] === 'refusal')) {
        throw new ModelError('refusal');
      }
    }
  }
  const status = data['status'];
  if (status === 'incomplete' || data['incomplete_details'] != null) throw new ModelError('truncated');
  if (typeof status === 'string' && status !== 'completed') throw new ModelError('invalid_output');
}

export function safeModelError(error: unknown): ModelError {
  if (error instanceof ModelError) return error;
  if (APICallError.isInstance(error)) {
    const status = error.statusCode ?? null;
    if (status === 401) return new ModelError('authentication', status);
    if (status === 403 || status === 404) return new ModelError('model_access', status);
    if (status === 429) return new ModelError('quota_rate_limit', status);
    if (status !== null && status >= 500) return new ModelError('upstream', status);
    // Some provider versions reject refusal parts before returning a parsed result.
    // Inspect only flags; never copy body, message, headers or SDK cause into errors.
    if (error.responseBody) {
      try {
        const body: unknown = typeof error.responseBody === 'string' ? JSON.parse(error.responseBody) as unknown : error.responseBody;
        // The provider maps a completed HTTP exchange with response.status=failed
        // to an SDK 400 exception. Treat it as upstream failure, not bad file output.
        if (record(body)?.['status'] === 'failed' && record(body)?.['error'] != null) {
          return new ModelError('upstream', status);
        }
        if (status === 200) inspectResponse(body);
      }
      catch (candidate) { if (candidate instanceof ModelError) return candidate; }
    }
    if (status === null) return new ModelError('network');
    return new ModelError('invalid_output', status);
  }
  return new ModelError('invalid_output');
}
