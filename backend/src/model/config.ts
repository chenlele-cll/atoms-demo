import { ModelError } from './errors.js';

export type ModelConfig = {
  readonly apiKey: string;
  readonly modelId: string;
  readonly timeoutMs: number;
  readonly maxOutputTokens: number;
};

function integer(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new ModelError('configuration');
  }
  return parsed;
}

// Called only at the explicit probe/generation boundary, never during health/startup.
export function readModelConfig(env: NodeJS.ProcessEnv): ModelConfig {
  const apiKey = env['OPENAI_API_KEY']?.trim();
  const modelId = env['MODEL_ID']?.trim();
  if (!apiKey || /\s/.test(apiKey) || !modelId ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(modelId) || modelId.includes(apiKey)) {
    throw new ModelError('configuration');
  }
  return {
    apiKey, modelId,
    timeoutMs: integer(env['MODEL_TIMEOUT_MS'], 60_000, 1000, 120_000),
    maxOutputTokens: integer(env['MODEL_MAX_OUTPUT_TOKENS'], 4096, 256, 8192),
  };
}
