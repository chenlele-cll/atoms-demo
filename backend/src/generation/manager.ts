import type { GenerationObservation } from '../model/observation.js';
import { generationStatusSchema } from '../contracts/generations.js';
import type { GenerationStatus, GenerationEvent } from '../contracts/generations.js';
import type { GenerationInput, GenerationActivity } from './contracts.js';
import { acceptPreparedGeneration, generateProject, prepareGeneration } from './service.js';
import type { AcceptedGeneration } from './service.js';
import { GenerationStream } from './stream.js';
import type { StreamLimits } from './stream.js';
import { changedPaths } from './policy.js';
import { generationError } from './errors.js';
import { ProjectError } from '../projects/errors.js';
import type { ProjectStore } from '../storage/store.js';

type RunState = ReturnType<ProjectStore['generationState']>;
type Active = { accepted: AcceptedGeneration; controller: AbortController; stream: GenerationStream;
  promise?: Promise<void>; seq: number; finalized: boolean; canWrite: boolean };
export type GenerationOptions = {
  env?: NodeJS.ProcessEnv; transport?: typeof fetch; now?: () => number;
  limits?: { global?: number; daily?: number; postPerMinute?: number; queryPerMinute?: number; cancelPerMinute?: number };
  streamLimits?: Partial<StreamLimits>;
  shutdownMs?: number;
  audit?: (event: GenerationObservation) => void;
};
export class GenerationManager {
  private readonly active = new Map<string, Active>();
  private readonly streams = new Set<GenerationStream>();
  private stopping = false;
  private shutdownPromise: Promise<void> | undefined;
  constructor(private readonly store: ProjectStore, readonly options: GenerationOptions = {}) {}
  private dto(value: RunState, cancellationRequested = false): GenerationStatus {
    const { run, baseVersion, candidateVersion } = value;
    return generationStatusSchema.parse({ projectId: run.projectId, requestId: run.requestId, runId: run.id,
      baseVersionId: run.baseVersionId, status: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt,
      errorCode: run.errorCode, cancellationRequested, terminalStatePersisted: run.status !== 'running',
      candidateVersionId: run.resultVersionId, changedFiles: candidateVersion ? changedPaths(baseVersion.snapshot, candidateVersion.snapshot) : [],
      previewStatus: 'unverified', usage: null });
  }
  status(ownerId: string, projectId: string, requestId: string): GenerationStatus {
    const state = this.store.generationState(ownerId, projectId, requestId);
    const active = this.active.get(state.run.id);
    if (state.run.status === 'running' && (!active || active.finalized)) throw new ProjectError('RUN_STATE_UNCONFIRMED');
    return this.dto(state, active?.controller.signal.aborted ?? false);
  }
  cancel(ownerId: string, projectId: string, requestId: string) {
    const state = this.status(ownerId, projectId, requestId);
    if (state.status !== 'running') return state;
    this.active.get(state.runId)?.controller.abort('USER_CANCELLED');
    return generationStatusSchema.parse({ ...state, cancellationRequested: true });
  }
  accept(input: GenerationInput): { fresh: false; state: GenerationStatus } | { fresh: true; stream: GenerationStream; start: () => void } {
    let transport: GenerationStream | undefined;
    try {
      // All admission/acceptance operations are synchronous: no competing request can cross a reserved slot.
      const prepared = prepareGeneration(input, { store: this.store, env: this.options.env ?? process.env,
        ...(this.options.now ? { now: this.options.now } : {}) });
      if (prepared.existing) return { fresh: false, state: this.status(input.sessionId, input.projectId, input.requestId) };
      if (this.stopping) throw new ProjectError('GENERATION_UNAVAILABLE', 5);
      if ([...this.active.values()].some(item => item.accepted.request.projectId === input.projectId)) throw new ProjectError('PROJECT_BUSY');
      if (this.store.hasRunning(input.projectId)) throw new ProjectError('RUN_STATE_UNCONFIRMED');
      if ([...this.active.values()].some(item => item.accepted.request.sessionId === input.sessionId)) throw new ProjectError('SESSION_BUSY', 5);
      if (this.active.size >= (this.options.limits?.global ?? 2)) throw new ProjectError('GENERATION_CAPACITY', 5);
      const controller = new AbortController();
      const stream = new GenerationStream(code => controller.abort(code), this.options.streamLimits);
      transport = stream;
      const accepted = acceptPreparedGeneration(prepared, this.store, () => {
        if (this.stopping) throw new ProjectError('GENERATION_UNAVAILABLE');
      }, this.options.now, this.options.limits?.daily ?? 20);
      if (!accepted.accepted) { stream.fail(); return { fresh: false, state: this.status(input.sessionId, input.projectId, input.requestId) }; }
      const active: Active = { accepted, controller, stream, seq: 0, finalized: false, canWrite: true };
      this.active.set(accepted.run.id, active); this.streams.add(stream);
      // Release transport ownership even when its final send times out after execution is complete.
      stream.completion.then(() => this.streams.delete(stream));
      return { fresh: true, stream, start: () => this.start(active) };
    } catch (error) {
      transport?.fail();
      if (error instanceof ProjectError) throw error;
      const safe = generationError(error);
      if (safe.code === 'BASE_VERSION_CHANGED' || safe.code === 'REQUEST_CONFLICT' || safe.code === 'INVALID_INPUT') throw new ProjectError(safe.code);
      throw new ProjectError(safe.code === 'MODEL_CONFIGURATION' ? 'MODEL_CONFIGURATION' : 'GENERATION_UNAVAILABLE');
    }
  }
  private frame(active: Active) {
    const { request, run } = active.accepted;
    return { projectId: request.projectId, requestId: request.requestId, runId: run.id,
      baseVersionId: request.baseVersionId, seq: ++active.seq, at: new Date().toISOString() };
  }
  private start(active: Active) {
    if (active.promise || active.finalized) return;
    active.stream.send({ ...this.frame(active), event: 'accepted', seq: 1 });
    const observe = (event: GenerationActivity) => {
      if (active.finalized || event.type === 'ended') return;
      const { runId, sequence, at, ...activity } = event; void runId; void sequence; void at;
      const frame: GenerationEvent = { ...this.frame(active), event: 'activity', activity: { ...activity, type: event.type } };
      active.stream.send(frame);
    };
    const { request } = active.accepted;
    active.promise = generateProject(request, { store: this.store, env: this.options.env ?? process.env,
      accepted: active.accepted, signal: active.controller.signal, observe, canWrite: () => active.canWrite,
      ...(this.options.audit ? { audit: this.options.audit } : {}),
      ...(this.options.transport ? { transport: this.options.transport } : {}),
      ...(this.options.now ? { now: this.options.now } : {}) }).then(result => {
      if (active.finalized) return;
      let state: GenerationStatus;
      try {
        if (!active.canWrite || !result.terminalStatePersisted) throw new Error('unconfirmed');
        state = this.dto(this.store.generationState(request.sessionId, request.projectId, request.requestId));
        if (state.status === 'running') throw new Error('unconfirmed');
      } catch {
        state = generationStatusSchema.parse({ projectId: request.projectId, requestId: request.requestId,
          runId: active.accepted.run.id, baseVersionId: request.baseVersionId, status: 'unknown',
          startedAt: active.accepted.run.startedAt, finishedAt: null, errorCode: 'STORAGE_UNAVAILABLE',
          cancellationRequested: active.controller.signal.aborted, terminalStatePersisted: false,
          candidateVersionId: null, changedFiles: [], previewStatus: 'unverified', usage: null });
      }
      active.finalized = true;
      active.stream.send({ ...this.frame(active), event: 'terminal', state }); active.stream.end();
    }).catch(() => { active.stream.fail(); }).finally(() => {
      active.canWrite = false; active.finalized = true; this.active.delete(active.accepted.run.id);
    });
  }
  shutdown() {
    return this.shutdownPromise ??= this.stop();
  }
  revokeOwnership() {
    this.stopping = true;
    for (const active of this.active.values()) { active.canWrite = false; active.controller.abort('SERVER_SHUTDOWN'); }
  }
  private async stop() {
    this.stopping = true;
    const budget = this.options.shutdownMs ?? 5000;
    const deadline = performance.now() + budget;
    // SQLite lock waits are part of the same shutdown budget.
    if (this.active.size) {
      try { this.store.setBusyTimeout(Math.min(100, budget)); } catch { this.revokeOwnership(); }
    }
    for (const active of this.active.values()) {
      active.controller.abort('SERVER_SHUTDOWN'); this.start(active);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([Promise.allSettled([...this.active.values()].map(item => item.promise)),
      new Promise<void>(resolve => { timer = setTimeout(resolve, Math.max(0, deadline - performance.now())); })]);
    clearTimeout(timer);
    for (const active of this.active.values()) {
      const permitted = active.canWrite;
      active.canWrite = false; active.finalized = true;
      if (permitted && performance.now() < deadline) {
        try {
          this.store.setBusyTimeout(Math.max(0, Math.floor(deadline - performance.now())));
          this.store.finishRun({ projectId: active.accepted.request.projectId, runId: active.accepted.run.id,
            status: 'interrupted', errorCode: 'SERVER_SHUTDOWN' });
        } catch { /* A later owned startup recovers an unconfirmed running record. */ }
      }
    }
    this.active.clear();
    // Fastify preClose must not wait for an SSE reader to close voluntarily.
    for (const stream of this.streams) stream.fail();
    this.streams.clear();
  }
  get activeCount() { return this.active.size; }
  assertWritable() {
    if (this.stopping) throw new ProjectError('GENERATION_UNAVAILABLE');
  }
  projectActivity(projectId: string): 'busy' | 'unconfirmed' | null {
    if ([...this.active.values()].some(item => item.accepted.request.projectId === projectId)) return 'busy';
    return this.store.hasRunning(projectId) ? 'unconfirmed' : null;
  }
}
