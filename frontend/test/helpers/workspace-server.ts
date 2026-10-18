import { generationBodySchema, generationStatusSchema, messageSchema, projectDetailSchema, versionReviewSchema } from '@atoms/contracts';
import type { GenerationStatus } from '@atoms/contracts';
import { workspaceFixture, jsonResponse, safeErrorResponse } from './workspace';
export function workspaceServer() {
  const f = workspaceFixture(); const other = workspaceFixture(); const projects = new Map([[f.projectId,f.project],[other.projectId,other.project]]);
  const records: { url: string; method: string; body: unknown }[] = [];
  let messages: ReturnType<typeof messageSchema.parse>[] = []; let state: GenerationStatus | undefined;
  let output: ReadableStreamDefaultController<Uint8Array> | undefined; let generationSignal: AbortSignal | null | undefined;
  let mode: 'success' | 'hold' | 'eof' | 'unconfigured' = 'success';
  let queryStatus: number | undefined; let createGate: Promise<void> | undefined;
  let cancelGate: Promise<void> | undefined; let sessionStatus = 200; let unauthorized = false;
  const frame = (event: unknown) => new TextEncoder().encode(`event: ${typeof event === 'object' && event !== null && 'event' in event ? event.event : ''}\ndata: ${JSON.stringify(event)}\n\n`);
  function success(deliver = true) {
    if (!state) throw new Error('No active fixture');
    state = generationStatusSchema.parse({ ...state, status: 'succeeded', finishedAt: f.at, terminalStatePersisted: true, candidateVersionId: f.versionId, changedFiles: ['/src/index.tsx'] });
    messages = [...messages, messageSchema.parse({ id: crypto.randomUUID(), projectId: f.projectId, sequence: 2, role: 'assistant', content: 'Candidate saved; explicit fixture', runId: state.runId, createdAt: f.at })];
    const association = { projectId: f.projectId, requestId: state.requestId, baseVersionId: state.baseVersionId, runId: state.runId, at: f.at };
    if (deliver) {
      output?.enqueue(frame({ ...association, seq: 2, event: 'activity', activity: { type: 'saved', step: 3, candidateVersionId: f.versionId } }));
      output?.enqueue(frame({ ...association, seq: 3, event: 'terminal', state }));
    }
    output?.close(); output = undefined;
  }
  const transport: typeof fetch = async (input, init) => {
    const url = String(input); const method = init?.method ?? 'GET'; let body: unknown;
    if (typeof init?.body === 'string') body = JSON.parse(init.body) as unknown;
    records.push({ url, method, body });
    if (url === '/api/session') return jsonResponse({ expiresAt: '2026-12-01T00:00:00.000Z' },sessionStatus);
    if (url === '/api/templates') return jsonResponse({ items: [{ id: f.snapshot.id, version: 1, digest: f.snapshot.digest, name: 'Company fixture', category: 'company', source: f.snapshot.source }] });
    if (unauthorized) return safeErrorResponse(401, 'SESSION_REQUIRED');
    if (url.startsWith('/api/projects?')) return jsonResponse({ items: [...projects.values()].map(project => project.project), nextCursor: null });
    if (url === '/api/projects' && method === 'POST') { if (createGate) await createGate; return jsonResponse(f.project,201); }
    if (url === `/api/projects/${other.projectId}`) return jsonResponse(other.project);
    if (url === `/api/projects/${other.projectId}/versions/${other.baseId}`) return jsonResponse(other.currentReview);
    if (url.startsWith(`/api/projects/${other.projectId}/messages`)) return jsonResponse({ items: [], nextBeforeSequence: null, latestSequence: 0 });
    if (url === `/api/projects/${f.projectId}`) return jsonResponse(f.project);
    if (url.includes('/messages?')) return jsonResponse({ items: messages, nextBeforeSequence: null, latestSequence: messages.at(-1)?.sequence ?? 0 });
    if (url.includes(`/versions/${f.baseId}`)) return jsonResponse(f.currentReview);
    if (url.includes(`/versions/${f.versionId}`)) return jsonResponse(versionReviewSchema.parse({ ...f.review, successfulRun: state ? { ...f.review.successfulRun, requestId: state.requestId, baseVersionId: state.baseVersionId } : f.review.successfulRun }));
    if (url.endsWith('/generations')) {
      if (mode === 'unconfigured') return safeErrorResponse(503, 'MODEL_CONFIGURATION');
      const payload = generationBodySchema.parse(body); generationSignal = init?.signal;
      state = generationStatusSchema.parse({ ...f.running, requestId: payload.requestId, baseVersionId: payload.baseVersionId });
      const run = { ...f.review.successfulRun, status: 'running', requestId: payload.requestId, resultVersionId: null, errorCode: null, finishedAt: null };
      f.project = projectDetailSchema.parse({ ...f.project, latestRun: run }); projects.set(f.projectId,f.project);
      messages = [messageSchema.parse({ id: crypto.randomUUID(), projectId: f.projectId, sequence: 1, role: 'user', content: payload.prompt, runId: f.runId, createdAt: f.at })];
      return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        output = controller;
        controller.enqueue(frame({ event: 'accepted', projectId: f.projectId, requestId: payload.requestId, baseVersionId: payload.baseVersionId, runId: f.runId, seq: 1, at: f.at }));
        if (mode === 'success') success();
        if (mode === 'eof') { success(false); }
      }, cancel() { output = undefined; } }), { headers: { 'content-type': 'text/event-stream' } });
    }
    if (url.includes('/generations/by-request/')) {
      if (url.endsWith('/cancel')) { if (cancelGate) await cancelGate; return jsonResponse({ ...state, cancellationRequested: true },202); }
      if (queryStatus) return safeErrorResponse(queryStatus, queryStatus === 503 ? 'RUN_STATE_UNCONFIRMED' : queryStatus === 401 ? 'SESSION_REQUIRED' : 'NOT_FOUND');
      if (!state) return jsonResponse({ ...f.running, requestId: url.split('/').at(-1) },200);
      return jsonResponse(state, state.status === 'running' ? 200 : 200);
    }
    throw new Error(`Unknown explicit fixture route ${url}`);
  };
  return { f, other, records, transport, success, setMode: (value: typeof mode) => { mode = value; }, setQueryStatus: (value: number) => { queryStatus = value; },
    setCreateGate: (value: Promise<void>) => { createGate = value; }, setCancelGate: (value: Promise<void>) => { cancelGate = value; },
    setSessionStatus: (value: number) => { sessionStatus = value; }, setUnauthorized: () => { unauthorized = true; }, generationSignal: () => generationSignal,
    setStoredState: (value: GenerationStatus) => { state = value; },
  };
}
export function memoryStorage() {
  const map = new Map<string,string>();
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key,value); }, removeItem: (key: string) => { map.delete(key); }, map };
}
