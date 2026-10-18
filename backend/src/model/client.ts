import { createOpenAI } from '@ai-sdk/openai';
import { generateText, Output, stepCountIs, wrapLanguageModel } from 'ai';
import type { ModelMessage, ToolSet } from 'ai';
import type { z } from 'zod';
import type { ModelConfig } from './config.js';
import { inspectResponse, ModelError, safeModelError } from './errors.js';

export type Usage = { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };
export type CallMetrics = { requestCount: number; usage: Usage | null };
type StepInput = {
  messages: ModelMessage[];
  tools?: ToolSet;
  toolChoice?: 'auto' | 'none' | 'required';
  schema?: z.ZodType<unknown>;
};
export type ModelSession = {
  check: () => void;
  step: (input: StepInput) => ReturnType<typeof generateText>;
};

export class ModelFailure extends ModelError {
  constructor(error: ModelError, readonly metrics: CallMetrics) {
    super(error.safe.code, error.safe.status);
  }
}

function tokens(value: number | undefined): number | null {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function addUsage(previous: Usage | null, next: Usage | null, first: boolean): Usage | null {
  if (first) return next;
  if (!previous || !next) return null;
  const sum = (a: number | null, b: number | null) => a === null || b === null ? null : a + b;
  return {
    inputTokens: sum(previous.inputTokens, next.inputTokens),
    outputTokens: sum(previous.outputTokens, next.outputTokens),
    totalTokens: sum(previous.totalTokens, next.totalTokens),
  };
}

export function createModelClient(config: ModelConfig, transport: typeof fetch = fetch) {
  return {
    // Each bounded operation owns a deadline shared by all its single-step calls.
    async run<T>(maxRequests: number, work: (session: ModelSession) => Promise<T>, external?: AbortSignal)
      : Promise<{ value: T; metrics: CallMetrics }> {
      const controller = new AbortController();
      let ended: 'timeout' | 'cancelled' | undefined;
      let closed = false;
      const metrics: CallMetrics = { requestCount: 0, usage: null };
      const deadline = performance.now() + config.timeoutMs;
      let observed = 0;
      let steps = 0;
      const abort = (reason: 'timeout' | 'cancelled') => {
        if (!ended) { ended = reason; controller.abort(); }
      };
      const cancel = () => abort('cancelled');
      const timer = setTimeout(() => abort('timeout'), config.timeoutMs);
      external?.addEventListener('abort', cancel, { once: true });
      if (external?.aborted) cancel();
      const check = () => {
        if (closed) throw new ModelError('cancelled');
        if (!ended && performance.now() >= deadline) abort('timeout');
        if (ended) throw new ModelError(ended);
      };
      const provider = createOpenAI({
        apiKey: config.apiKey,
        baseURL: 'https://api.openai.com/v1',
        fetch: async (url, init) => {
          check();
          if (metrics.requestCount >= maxRequests) throw new ModelError('invalid_output');
          metrics.requestCount++;
          try {
            // Suppress redirect replay, including credential forwarding and hidden requests.
            return await transport(url, { ...init, redirect: 'error', signal: controller.signal });
          } catch (error) {
            check();
            if (error instanceof ModelError) throw error;
            throw new ModelError('network');
          }
        },
      });
      const model = wrapLanguageModel({
        model: provider.responses(config.modelId),
        middleware: {
          specificationVersion: 'v4',
          wrapGenerate: async ({ doGenerate }) => {
            const result = await doGenerate();
            check();
            const inputTokens = tokens(result.usage.inputTokens.total);
            const outputTokens = tokens(result.usage.outputTokens.total);
            const usage = inputTokens === null && outputTokens === null ? null : {
              inputTokens, outputTokens,
              totalTokens: inputTokens === null || outputTokens === null ? null : inputTokens + outputTokens,
            };
            metrics.usage = addUsage(metrics.usage, usage, observed++ === 0);
            inspectResponse(result.response?.body);
            // SDK warning strings can contain upstream-controlled details. No raw logs.
            return { ...result, warnings: [] };
          },
        },
      });
      const session: ModelSession = {
        check,
        step: async input => {
          check();
          if (++steps > maxRequests) throw new ModelError('invalid_output');
          const result = await generateText({
            model, messages: input.messages,
            ...(input.tools ? { tools: input.tools } : {}),
            ...(input.toolChoice ? { toolChoice: input.toolChoice } : {}),
            ...(input.schema ? { output: Output.object({ schema: input.schema }) } : {}),
            providerOptions: { openai: { store: false, parallelToolCalls: false } },
            maxRetries: 0,
            maxOutputTokens: config.maxOutputTokens,
            abortSignal: controller.signal,
            stopWhen: stepCountIs(1),
            telemetry: { isEnabled: false },
          });
          check();
          if (result.finishReason === 'length') throw new ModelError('truncated');
          if (!['stop', 'tool-calls'].includes(result.finishReason)) throw new ModelError('invalid_output');
          return result;
        },
      };
      // Racing also rejects a non-cooperative test transport; check() fences late results.
      let rejectAbort: () => void = () => {};
      const aborted = new Promise<never>((_, reject) => {
        rejectAbort = () => reject(new ModelError(ended ?? 'cancelled'));
        controller.signal.addEventListener('abort', rejectAbort, { once: true });
      });
      try {
        check();
        const value = await Promise.race([work(session), aborted]);
        check();
        return { value, metrics: { ...metrics } };
      } catch (error) {
        throw new ModelFailure(ended ? new ModelError(ended) : safeModelError(error), { ...metrics });
      } finally {
        closed = true;
        clearTimeout(timer);
        external?.removeEventListener('abort', cancel);
        controller.signal.removeEventListener('abort', rejectAbort);
        controller.abort();
      }
    },
  };
}
