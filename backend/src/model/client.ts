import { createOpenAI } from '@ai-sdk/openai';
import { generateText, Output, stepCountIs, wrapLanguageModel } from 'ai';
import type { ModelMessage, ToolSet } from 'ai';
import type { z } from 'zod';
import type { ModelConfig } from './config.js';
import { inspectResponse, ModelError, safeModelError } from './errors.js';

export type Usage = { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };
export type CallMetrics = { requestCount: number; usage: Usage | null; requests: (Usage | null)[] };
export type ModelRequestEvent = { type: 'request-started' | 'request-finished'; step: number };
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
    async run<T>(maxRequests: number, work: (session: ModelSession) => Promise<T>, external?: AbortSignal, observe?: (event: ModelRequestEvent) => void)
      : Promise<{ value: T; metrics: CallMetrics }> {
      const controller = new AbortController();
      let ended: 'timeout' | 'cancelled' | undefined;
      let closed = false;
      const metrics: CallMetrics = { requestCount: 0, usage: null, requests: [] };
      const deadline = performance.now() + config.timeoutMs;
      let steps = 0;
      const notify = (event: ModelRequestEvent) => { if (!closed) { try { observe?.(event); } catch { /* Observers never control transport outcomes. */ } } };
      const measured = (): CallMetrics => ({
        requestCount: metrics.requestCount,
        usage: metrics.requests.reduce<Usage | null>((sum, usage, index) => addUsage(sum, usage, index === 0), null),
        requests: metrics.requests.map(usage => usage ? { ...usage } : null),
      });
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
        baseURL: config.baseURL,
        fetch: async (url, init) => {
          check();
          if (metrics.requestCount >= maxRequests) throw new ModelError('invalid_output');
          metrics.requestCount++;
          metrics.requests.push(null);
          try {
            // Suppress redirect replay, including credential forwarding and hidden requests.
            const pending = transport(url, { ...init, redirect: 'error', signal: controller.signal });
            notify({ type: 'request-started', step: metrics.requestCount });
            return await pending;
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
            metrics.requests[metrics.requestCount - 1] = usage;
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
          const before = metrics.requestCount;
          try {
          const result = await generateText({
            model, messages: input.messages,
            allowSystemInMessages: true,
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
          } finally {
            if (metrics.requestCount > before) notify({ type: 'request-finished', step: metrics.requestCount });
          }
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
        return { value, metrics: measured() };
      } catch (error) {
        throw new ModelFailure(ended ? new ModelError(ended) : safeModelError(error), measured());
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
