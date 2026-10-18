import { randomUUID, createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readModelConfig } from '../model/config.js';
import { openStore } from '../storage/store.js';
import type { ProjectStore } from '../storage/store.js';
import { loadCatalog } from '../templates/catalog.js';
import { canonicalJSON } from '../template-assets/bundle.mjs';
import { generateProject } from './service.js';
import { generationError, GenerationError } from './errors.js';
import type { GenerationCode } from './errors.js';
import type { GenerationActivity, GenerationResult } from './contracts.js';
import { smokeCases } from './smoke-cases.js';
import type { SmokeCase } from './smoke-cases.js';

export async function runGenerationSmoke(selected: SmokeCase, options: {
  env: NodeJS.ProcessEnv;
  directory: string;
  signal?: AbortSignal;
  transport?: typeof fetch;
}) {
  const started = performance.now();
  const report = {
    id: randomUUID(), source: 'not-run' as 'live' | 'fixture' | 'not-run', case: selected,
    provider: null as 'openai' | 'openai-compatible' | null, baseURL: null as string | null, model: null as string | null,
    startedAt: new Date().toISOString(), finishedAt: '', durationMs: 0,
    status: 'failed' as 'passed' | 'failed' | 'cancelled', generation: null as GenerationResult | null,
    activities: [] as GenerationActivity[], saved: false, reopened: false, unchangedCurrent: false,
    baseDigest: null as string | null, candidateDigest: null as string | null, fileMapDigest: null as string | null,
    previewStatus: 'unverified' as const, errorCode: null as GenerationCode | null,
  };
  let store: ProjectStore | undefined;
  try {
    const config = readModelConfig(options.env);
    report.model = config.modelId; report.baseURL = 'https://api.openai.com/v1';
    report.provider = 'openai';
    const catalog = await loadCatalog();
    const template = catalog.list().items[0];
    if (!template) throw new GenerationError('UNSUPPORTED_TEMPLATE');
    const ownedDirectory = join(options.directory, report.id);
    await mkdir(ownedDirectory, { recursive: true, mode: 0o700 });
    // DATABASE_PATH and existing project IDs are deliberately not consumed.
    const filename = join(ownedDirectory, 'project.sqlite');
    store = openStore(filename);
    const session = store.createSession();
    const project = store.createProject(session.id, `GEN-004 public ${selected} smoke`, catalog.resolve(template.id, template.version, template.digest));
    const input = { sessionId: session.id, projectId: project.project.id, baseVersionId: project.currentVersion.id,
      requestId: randomUUID(), prompt: smokeCases[selected] };
    report.baseDigest = project.currentVersion.snapshot.digest;
    const result = await generateProject(input, { store, env: options.env,
      ...(options.signal ? { signal: options.signal } : {}), ...(options.transport ? { transport: options.transport } : {}),
      observe: activity => report.activities.push(activity) });
    report.generation = result;
    report.source = (result.metrics.requestCount ?? 0) > 0 ? options.transport ? 'fixture' : 'live' : 'not-run';
    report.saved = result.status === 'succeeded';
    report.unchangedCurrent = store.getProject(session.id, input.projectId).project.currentVersionId === input.baseVersionId;
    if (!report.saved) { report.errorCode = result.errorCode; report.status = result.status === 'cancelled' ? 'cancelled' : 'failed'; }
    else {
      const record = store.inspectGeneration(input);
      if (!record?.candidateVersion || record.candidateVersion.id !== result.candidateVersionId || !report.unchangedCurrent) throw new GenerationError('STORAGE_UNAVAILABLE');
      const before = canonicalJSON(record);
      report.candidateDigest = record.candidateVersion.snapshot.digest;
      report.fileMapDigest = createHash('sha256').update(canonicalJSON(record.candidateVersion.snapshot.files)).digest('hex');
      const messages = store.listMessages(session.id, input.projectId, 0, 50);
      if (messages.items.length !== 2 || messages.items[0]?.content !== input.prompt || messages.items[1]?.content !== result.summary) throw new GenerationError('STORAGE_UNAVAILABLE');
      store.close(); store = openStore(filename);
      const reopened = store.inspectGeneration(input);
      report.reopened = canonicalJSON(reopened) === before;
      report.unchangedCurrent = store.getProject(session.id, input.projectId).project.currentVersionId === input.baseVersionId;
      if (!report.reopened || !report.unchangedCurrent) throw new GenerationError('STORAGE_UNAVAILABLE');
      report.status = 'passed';
    }
  } catch (error) {
    report.errorCode = generationError(error).code;
  } finally {
    store?.close(); report.finishedAt = new Date().toISOString(); report.durationMs = Math.round(performance.now() - started);
  }
  return report;
}
