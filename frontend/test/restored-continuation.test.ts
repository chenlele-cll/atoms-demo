import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { generationBodySchema } from '@atoms/contracts';
import type { ProjectDetail, Version, VersionReview } from '@atoms/contracts';
import type { GenerationBody } from '../src/api/generation-stream';
import { WorkspaceController } from '../src/workspace/controller';
import { routeFor } from '../src/workspace/routing';
import { PendingRequests } from '../src/workspace/pending';
import { memoryStorage } from './helpers/workspace-server';
import { jsonResponse, safeErrorResponse, workspaceFixture } from './helpers/workspace';

const until = async (ready: () => boolean) => {
  for (let i = 0; i < 200; i++) { if (ready()) return; await delay(5); }
  assert.fail('Restored continuation fixture did not settle');
};
function gate() {
  let release = () => {};
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
function continuationServer() {
  const f = workspaceFixture(); const target = f.project.currentVersion; const old = f.review.version;
  const candidate: Version = { ...old, id: crypto.randomUUID(), sequence: 2, parentVersionId: target.id };
  let detail: ProjectDetail = { ...f.project, project: { ...f.project.project, currentVersionId: old.id }, currentVersion: old };
  const calls: { url: string; method: string; body: unknown }[] = [];
  let projectGate: ReturnType<typeof gate> | undefined; let restoreGate: ReturnType<typeof gate> | undefined;
  let projectFails = false; let restoreUnknown = false; let adoptionUnknown = false; let generationUnknown = false; let statusFails = false;
  let payload: GenerationBody = f.body;
  const setCurrent = (version: Version) => { detail = { ...detail, project: { ...detail.project, currentVersionId: version.id }, currentVersion: version }; };
  const review = (version: Version): VersionReview => ({ version, currentVersionId: detail.project.currentVersionId,
    successfulRun: version.kind === 'generated' ? { ...f.review.successfulRun, id: f.runId, projectId: f.projectId,
      requestId: payload.requestId, baseVersionId: target.id, resultVersionId: version.id, status: 'succeeded', errorCode: null, startedAt: f.at, finishedAt: f.at } : null,
    changedFiles: version.kind === 'generated' ? ['/src/index.tsx'] : [],
    adoptionAvailability: version.kind === 'template' ? 'not-candidate' : version.id === detail.project.currentVersionId ? 'already-current' : 'eligible' });
  const transport: typeof fetch = async (input, init) => {
    const url = String(input); const method = init?.method ?? 'GET';
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });
    if (url === `/api/projects/${f.projectId}`) {
      if (projectGate) await projectGate.promise;
      return projectFails ? safeErrorResponse(503, 'STORAGE_UNAVAILABLE') : jsonResponse(detail);
    }
    if (url.startsWith('/api/projects?')) return jsonResponse({ items: [detail.project], nextCursor: null });
    if (url.includes('/messages?')) return jsonResponse({ items: [], nextBeforeSequence: null, latestSequence: 0 });
    if (url.includes('/versions?')) return jsonResponse({ projectId: f.projectId, currentVersionId: detail.project.currentVersionId, items: [], nextBeforeSequence: null });
    if (url.endsWith('/restore') || url.endsWith('/adopt')) {
      if (url.endsWith('/restore') && restoreGate) await restoreGate.promise;
      if (url.endsWith('/restore') && restoreUnknown) throw new Error('Fixture lost restore response');
      if (url.endsWith('/adopt') && adoptionUnknown) throw new Error('Fixture lost adoption response');
      const version = url.endsWith('/restore') ? target : candidate; setCurrent(version);
      return jsonResponse({ projectId: f.projectId, currentVersionId: version.id, updatedAt: f.at, alreadyCurrent: false });
    }
    const version = [target, old, candidate].find(item => url === `/api/projects/${f.projectId}/versions/${item.id}`);
    if (version) return jsonResponse(review(version));
    if (url.endsWith('/generations')) {
      payload = generationBodySchema.parse(body);
      if (generationUnknown) return new Response('', { headers: { 'content-type': 'text/event-stream' } });
      return jsonResponse({ ...f.succeeded, requestId: payload.requestId, baseVersionId: payload.baseVersionId, candidateVersionId: candidate.id });
    }
    if (url.includes('/generations/by-request/')) {
      return statusFails ? safeErrorResponse(503, 'RUN_STATE_UNCONFIRMED')
        : jsonResponse({ ...f.succeeded, requestId: payload.requestId, baseVersionId: payload.baseVersionId, candidateVersionId: candidate.id });
    }
    throw new Error(`Unexpected fixture route: ${url}`);
  };
  return { f, target, old, candidate, calls, transport, setCurrent, detail: () => detail,
    posts: () => calls.filter(call => call.method === 'POST' && call.url.endsWith('/generations')),
    setProjectGate: (value?: ReturnType<typeof gate>) => { projectGate = value; },
    setRestoreGate: (value: ReturnType<typeof gate>) => { restoreGate = value; },
    failProject: (value: boolean) => { projectFails = value; },
    loseRestore: () => { restoreUnknown = true; },
    loseAdoption: () => { adoptionUnknown = true; },
    loseGeneration: (failQuery = false) => { generationUnknown = true; statusFails = failQuery; },
  };
}
function compiled(app: WorkspaceController) {
  const key = app.previewIdentity(); assert.ok(key);
  app.previewState({ key, status: 'compiled', message: 'Controlled state fixture, no browser compilation' }, app.snapshot().activation);
}
async function openRestore(app: WorkspaceController, target: Version) {
  await app.viewVersion('history', target.id); compiled(app); app.openRestore();
  assert.equal(app.snapshot().operation.status, 'confirming');
}

test('restore POST and subsequent current GET must finish before an explicit new generation', async t => {
  const server = continuationServer(); const app = new WorkspaceController({ transport: server.transport, storage: memoryStorage() });
  t.after(() => app.leave()); app.activate(routeFor(`/projects/${server.f.projectId}`)); await until(() => !app.snapshot().loading);
  app.setDraft('Continue the restored template'); await openRestore(app, server.target);
  const write = gate(); server.setRestoreGate(write); const restoring = app.submitRestore();
  await app.start(); assert.equal(server.posts().length, 0);
  const read = gate(); server.setProjectGate(read); write.release();
  await until(() => app.snapshot().operation.status === 'confirmed' && app.snapshot().operation.querying);
  await app.start(); assert.equal(server.posts().length, 0);
  read.release(); await restoring; server.setProjectGate();
  await app.loadHistory(); await app.viewVersion('current'); compiled(app); await app.refreshCurrent();
  assert.equal(server.posts().length, 0); assert.equal(app.snapshot().draft, 'Continue the restored template');
  await app.start(); assert.equal(server.posts().length, 1);
  const payload = app.snapshot().task?.payload; assert.ok(payload);
  assert.deepEqual(server.posts()[0]?.body, payload); assert.equal(payload.baseVersionId, server.target.id);
  assert.equal(payload.prompt, 'Continue the restored template'); assert.notEqual(payload.requestId, server.f.requestId);
});

test('acknowledged restore with a failed GET stays blocked through view changes until a successful current query', async t => {
  const server = continuationServer(); const app = new WorkspaceController({ transport: server.transport, storage: memoryStorage() });
  t.after(() => app.leave()); app.activate(routeFor(`/projects/${server.f.projectId}`)); await until(() => !app.snapshot().loading);
  app.setDraft('Keep this draft'); await openRestore(app, server.target); server.failProject(true); await app.submitRestore();
  assert.equal(app.snapshot().operation.status, 'confirmed'); assert.ok(app.snapshot().operation.refreshError);
  await app.viewVersion('current'); await app.start();
  assert.equal(server.posts().length, 0); assert.equal(app.snapshot().task, null); assert.equal(app.pending.get(server.f.projectId), undefined);
  assert.equal(app.snapshot().draft, 'Keep this draft');
  server.failProject(false); await app.refreshCurrent(); assert.equal(server.posts().length, 0);
  await app.start(); assert.equal(server.posts().length, 1);
});

test('unknown restore remains blocked for old, other and failed observations, resolving only at the target', async t => {
  const server = continuationServer(); const app = new WorkspaceController({ transport: server.transport, storage: memoryStorage() });
  t.after(() => app.leave()); app.activate(routeFor(`/projects/${server.f.projectId}`)); await until(() => !app.snapshot().loading);
  app.setDraft('Unsent continuation'); await openRestore(app, server.target); server.loseRestore(); await app.submitRestore();
  for (const current of [server.old, server.candidate]) {
    server.setCurrent(current); await app.refreshCurrent(); await app.start();
    assert.equal(app.snapshot().operation.status, 'unknown'); assert.equal(server.posts().length, 0);
  }
  server.failProject(true); await app.refreshCurrent(); await app.start(); assert.equal(server.posts().length, 0);
  assert.equal(app.snapshot().draft, 'Unsent continuation'); assert.equal(app.snapshot().selected?.id, server.target.id);
  server.failProject(false); server.setCurrent(server.target); await app.refreshCurrent();
  assert.equal(app.snapshot().operation.status, 'confirmed'); assert.equal(server.posts().length, 0);
  await app.start(); assert.equal(server.posts().length, 1);
  assert.equal(server.calls.filter(call => call.url.endsWith('/restore')).length, 1);
});

test('a superseded reconciliation GET cannot release the restore generation guard', async t => {
  const server = continuationServer(); const app = new WorkspaceController({ transport: server.transport, storage: memoryStorage() });
  t.after(() => app.leave()); app.activate(routeFor(`/projects/${server.f.projectId}`)); await until(() => !app.snapshot().loading);
  app.setDraft('Wait for authoritative current'); await openRestore(app, server.target);
  const read = gate(); server.setProjectGate(read); const restoring = app.submitRestore();
  await until(() => app.snapshot().operation.querying);
  app.facts(server.detail(), app.snapshot().activation); read.release(); await restoring; server.setProjectGate();
  assert.equal(app.snapshot().operation.refreshError, ''); await app.start();
  assert.equal(server.posts().length, 0); assert.equal(app.snapshot().task, null);
  await app.refreshCurrent(); await app.start(); assert.equal(server.posts().length, 1);
});

test('manual query after a committed restore loses its reply and first GET confirms without reloading or replaying writes', async t => {
  const server = continuationServer(); const app = new WorkspaceController({ transport: server.transport, storage: memoryStorage() });
  t.after(() => app.leave()); app.activate(routeFor(`/projects/${server.f.projectId}`)); await until(() => !app.snapshot().loading);
  app.setDraft('Continue only after querying the committed restore'); await openRestore(app, server.target);
  server.setCurrent(server.target); server.loseRestore(); server.failProject(true); await app.submitRestore();
  assert.equal(app.snapshot().operation.status, 'unknown'); assert.ok(app.snapshot().operation.refreshError);
  await app.start(); assert.equal(server.posts().length, 0);
  const before = server.calls.length; const attempt = app.snapshot().previewAttempt;
  server.failProject(false); await app.refreshCurrent();
  assert.deepEqual(server.calls.slice(before).map(call => [call.method, call.url]), [['GET', `/api/projects/${server.f.projectId}`]]);
  assert.equal(app.snapshot().operation.status, 'confirmed'); assert.equal(app.snapshot().operation.refreshError, '');
  assert.equal(app.snapshot().project?.project.currentVersionId, server.target.id);
  assert.equal(app.snapshot().selected?.id, server.target.id); assert.equal(app.snapshot().previewAttempt, attempt + 1);
  assert.equal(app.snapshot().draft, 'Continue only after querying the committed restore');
  assert.equal(server.calls.filter(call => call.method === 'POST').length, 1); assert.equal(server.posts().length, 0);
  await app.start(); assert.equal(server.posts().length, 1); assert.equal(app.snapshot().task?.payload.baseVersionId, server.target.id);
});

test('another tab changing current during restore reconciliation preserves the target and draft', async t => {
  const server = continuationServer(); const app = new WorkspaceController({ transport: server.transport, storage: memoryStorage() });
  t.after(() => app.leave()); app.activate(routeFor(`/projects/${server.f.projectId}`)); await until(() => !app.snapshot().loading);
  app.setDraft('Intended for restored code'); await openRestore(app, server.target);
  const read = gate(); server.setProjectGate(read); const restoring = app.submitRestore();
  await until(() => app.snapshot().operation.querying); server.setCurrent(server.old); read.release(); await restoring;
  await app.start(); assert.equal(server.posts().length, 0); assert.equal(app.snapshot().selected?.id, server.target.id);
  assert.equal(app.snapshot().project?.project.currentVersionId, server.old.id); assert.equal(app.snapshot().draft, 'Intended for restored code');
});

test('current observations never silently select a new baseline; explicit current selection enables it', async t => {
  const server = continuationServer(); const app = new WorkspaceController({ transport: server.transport, storage: memoryStorage() });
  t.after(() => app.leave()); app.activate(routeFor(`/projects/${server.f.projectId}`)); await until(() => !app.snapshot().loading);
  await openRestore(app, server.target); await app.submitRestore(); await app.viewVersion('current'); app.setDraft('Preserve my intent');
  server.setCurrent(server.old); await app.refreshCurrent(); await app.start();
  assert.equal(server.posts().length, 0); assert.equal(app.snapshot().selected?.id, server.target.id);
  assert.equal(app.snapshot().viewedVersionId, server.target.id); assert.equal(app.snapshot().draft, 'Preserve my intent');
  await app.viewVersion('current'); assert.equal(server.posts().length, 0);
  await app.start(); assert.equal(server.posts().length, 1); assert.equal(app.snapshot().task?.payload.baseVersionId, server.old.id);
});

test('saved continuation and preview keep restored current until explicit adoption; candidate blocks a new attempt', async t => {
  const server = continuationServer(); const app = new WorkspaceController({ transport: server.transport, storage: memoryStorage() });
  t.after(() => app.leave()); app.activate(routeFor(`/projects/${server.f.projectId}`)); await until(() => !app.snapshot().loading);
  await openRestore(app, server.target); await app.submitRestore(); app.setDraft('Save a continuation'); await app.start();
  await until(() => app.snapshot().review?.version.id === server.candidate.id); await app.viewVersion('candidate');
  assert.equal(app.snapshot().task?.state?.previewStatus, 'unverified'); assert.equal(app.snapshot().project?.project.currentVersionId, server.target.id);
  compiled(app); app.setView('preview'); app.setDraft('A later change'); await app.start();
  assert.equal(server.posts().length, 1); assert.equal(server.calls.filter(call => call.url.endsWith('/adopt')).length, 0);
  await app.submitAdoption(); assert.equal(app.snapshot().project?.project.currentVersionId, server.candidate.id);
  assert.deepEqual(server.calls.find(call => call.url.endsWith('/adopt'))?.body, { expectedCurrentVersionId: server.target.id });
  assert.equal(server.posts().length, 1); assert.equal(app.snapshot().draft, 'A later change');
});

test('unknown continuation adoption only queries facts and blocks new generation until the candidate is confirmed current', async t => {
  const server = continuationServer(); const app = new WorkspaceController({ transport: server.transport, storage: memoryStorage() });
  t.after(() => app.leave()); app.activate(routeFor(`/projects/${server.f.projectId}`)); await until(() => !app.snapshot().loading);
  await openRestore(app, server.target); await app.submitRestore(); app.setDraft('Generate before adoption'); await app.start();
  await until(() => app.snapshot().review?.version.id === server.candidate.id); await app.viewVersion('candidate'); compiled(app);
  server.loseAdoption(); await app.submitAdoption(); assert.equal(app.snapshot().operation.status, 'unknown');
  app.setDraft('Keep the next draft'); await app.start(); await app.submitAdoption();
  server.failProject(true); await app.refreshCurrent(); await app.start();
  assert.equal(server.posts().length, 1); assert.equal(app.snapshot().draft, 'Keep the next draft');
  assert.equal(server.calls.filter(call => call.url.endsWith('/adopt')).length, 1);
  server.failProject(false); server.setCurrent(server.candidate); await app.refreshCurrent();
  assert.equal(app.snapshot().operation.status, 'confirmed'); assert.equal(app.snapshot().project?.project.currentVersionId, server.candidate.id);
  assert.equal(server.posts().length, 1); assert.equal(server.calls.filter(call => call.url.endsWith('/adopt')).length, 1);
});

test('a lost continuation terminal only queries the original ID and preserves restored current', async t => {
  const server = continuationServer(); const app = new WorkspaceController({ transport: server.transport, storage: memoryStorage() });
  t.after(() => app.leave()); app.activate(routeFor(`/projects/${server.f.projectId}`)); await until(() => !app.snapshot().loading);
  await openRestore(app, server.target); await app.submitRestore(); server.loseGeneration(); app.setDraft('Lost terminal'); await app.start();
  await until(() => app.snapshot().task?.phase === 'terminal');
  const requestId = app.snapshot().task?.payload.requestId; assert.ok(requestId);
  assert.deepEqual(server.calls.filter(call => call.url.includes('/generations/by-request/')).map(call => call.url),
    [`/api/projects/${server.f.projectId}/generations/by-request/${requestId}`]);
  assert.equal(server.posts().length, 1); assert.equal(app.snapshot().project?.project.currentVersionId, server.target.id);
});

test('unknown continuation and reopen never allocate a new request; explicit retry retains the original payload after current changes', async t => {
  const server = continuationServer(); const storage = memoryStorage(); const app = new WorkspaceController({ transport: server.transport, storage });
  t.after(() => app.leave()); app.activate(routeFor(`/projects/${server.f.projectId}`)); await until(() => !app.snapshot().loading);
  await openRestore(app, server.target); await app.submitRestore(); server.loseGeneration(true); app.setDraft('Original continuation'); await app.start();
  await until(() => app.snapshot().task?.phase === 'unknown'); const payload = app.snapshot().task?.payload; assert.ok(payload);
  app.setDraft('Different unsent draft'); await app.start(); assert.equal(server.posts().length, 1);
  server.setCurrent(server.old); await app.refreshCurrent(); await app.query();
  assert.deepEqual(app.snapshot().task?.payload, payload); assert.equal(server.posts().length, 1);
  assert.deepEqual(new PendingRequests(storage).get(server.f.projectId)?.requestId, payload.requestId);
  app.leave(); const reopened = new WorkspaceController({ transport: server.transport, storage }); t.after(() => reopened.leave());
  reopened.activate(routeFor(`/projects/${server.f.projectId}`)); await until(() => reopened.snapshot().task?.phase === 'unknown');
  assert.deepEqual(reopened.snapshot().task?.payload, payload); assert.equal(server.posts().length, 1);
  await reopened.start('Ignored replacement prompt', undefined, true); await until(() => reopened.snapshot().task?.phase === 'unknown');
  assert.equal(server.posts().length, 2); assert.deepEqual(server.posts()[1]?.body, payload);
  assert.ok(server.calls.filter(call => call.url.includes('/generations/by-request/')).every(call => call.url.endsWith(payload.requestId)));
});
