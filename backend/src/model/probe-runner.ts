import { randomUUID } from 'node:crypto';
import { createModelClient, ModelFailure } from './client.js';
import type { Usage } from './client.js';
import { readModelConfig } from './config.js';
import { ModelError, safeModelError } from './errors.js';
import type { SafeModelError } from './errors.js';
import { caseNames, runCase } from './probe-cases.js';
import type { CaseName } from './probe-cases.js';

export type ProbeCaseResult = {
  name: CaseName;
  status: 'passed' | 'failed' | 'not-run';
  durationMs: number | null;
  requestCount: number;
  usage: Usage | null;
  error: SafeModelError | null;
  summary: Awaited<ReturnType<typeof runCase>> | null;
};
export type ProbeReport = {
  runId: string;
  source: 'live' | 'fixture' | 'not-run';
  provider: 'openai';
  model: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: 'passed' | 'failed' | 'cancelled';
  requestCount: number;
  error: SafeModelError | null;
  cases: ProbeCaseResult[];
};

export async function runProbe(selected: CaseName | 'all', options: {
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  // Explicit module-level injection only; unavailable as an env or CLI flag.
  transport?: typeof fetch;
}): Promise<ProbeReport> {
  const start = performance.now();
  const report: ProbeReport = {
    runId: randomUUID(), source: 'not-run', provider: 'openai', model: null,
    startedAt: new Date().toISOString(), finishedAt: '', durationMs: 0,
    status: 'failed', requestCount: 0, error: null,
    cases: caseNames.map(name => ({ name, status: 'not-run', durationMs: null,
      requestCount: 0, usage: null, error: null, summary: null })),
  };
  try {
    const config = readModelConfig(options.env);
    report.model = config.modelId;
    const client = createModelClient(config, options.transport);
    for (const item of report.cases) {
      if (selected !== 'all' && item.name !== selected) continue;
      if (options.signal?.aborted) throw new ModelError('cancelled');
      const caseStart = performance.now();
      try {
        const { value, metrics } = await client.run(item.name === 'tools' ? 2 : 1,
          session => runCase(item.name, session), options.signal);
        item.status = 'passed'; item.summary = value;
        item.requestCount = metrics.requestCount; item.usage = metrics.usage;
      } catch (error) {
        item.status = 'failed';
        item.error = safeModelError(error).safe;
        if (error instanceof ModelFailure) {
          item.requestCount = error.metrics.requestCount; item.usage = error.metrics.usage;
        }
      }
      item.durationMs = Math.round(performance.now() - caseStart);
      report.requestCount += item.requestCount;
      if (item.error && !['refusal', 'invalid_output', 'truncated'].includes(item.error.code)) {
        report.error = item.error;
        break;
      }
    }
    const required = report.cases.filter(item => selected === 'all' || item.name === selected);
    report.status = required.every(item => item.status === 'passed') ? 'passed' : 'failed';
    if (report.error?.code === 'cancelled') report.status = 'cancelled';
  } catch (error) {
    report.error = safeModelError(error).safe;
    if (report.error.code === 'cancelled') report.status = 'cancelled';
  }
  report.source = report.requestCount === 0 ? 'not-run' : options.transport ? 'fixture' : 'live';
  report.finishedAt = new Date().toISOString();
  report.durationMs = Math.round(performance.now() - start);
  return report;
}
