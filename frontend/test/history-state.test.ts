import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { ProjectDetail, VersionHistory, VersionReview } from '@atoms/contracts';
import { WorkspaceController } from '../src/workspace/controller';
import { mergeHistory } from '../src/workspace/history-state';
import { initialPreview, previewTransition } from '../src/preview/state';
import { routeFor } from '../src/workspace/routing';
import { workspaceFixture, jsonResponse, safeErrorResponse } from './helpers/workspace';
import { memoryStorage, workspaceServer } from './helpers/workspace-server';

const until = async (check: () => boolean) => { for (let n = 0; n < 200; n++) { if (check()) return; await delay(2); } assert.fail('History fixture did not settle'); };
function deferred<T>() { let resolve: (value: T) => void = () => {}; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function historyServer() {
  const f = workspaceFixture(); const reviews = new Map<string, VersionReview>([[f.baseId, f.currentReview], [f.versionId, f.review]]);
  const items: VersionHistory['items'] = [];
  for (let sequence = 61; sequence >= 0; sequence--) {
    const id = sequence === 0 ? f.baseId : sequence === 1 ? f.versionId : crypto.randomUUID();
    const review: VersionReview = sequence === 0 ? f.currentReview : { ...f.review, version: { ...f.review.version, id, sequence }, successfulRun: f.review.successfulRun ? { ...f.review.successfulRun, id: crypto.randomUUID(), resultVersionId: id } : null };
    reviews.set(id, review);
    items.push({ id, sequence, parentVersionId: review.version.parentVersionId, kind: review.version.kind, createdAt: f.at, isCurrent: id === f.baseId,
      runId: review.successfulRun?.id ?? null, request: sequence ? { messageId: crypto.randomUUID(), excerpt: '<img src=x> 中文'.repeat(8), truncated: true } : null,
      summary: { source: sequence ? 'stored' : 'fallback', text: sequence ? 'Actual stored summary' : 'Template baseline' }, changedFiles: sequence ? ['/src/index.tsx'] : [] });
  }
  let current = f.project;
  const calls: { url: string; method: string; body: unknown }[] = [];
  type Handler = (url: string, init?: RequestInit) => Promise<Response>;
  let history: Handler | undefined; let detail: Handler | undefined; let project: Handler | undefined; let post: Handler | undefined;
  const transport: typeof fetch = async (input, init) => {
    const url = String(input); const method = init?.method ?? 'GET'; const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });
    if (method === 'POST') {
      if (post) return post(url, init);
      const target = url.split('/').at(-2); assert.ok(target); const review = reviews.get(target); assert.ok(review);
      current = { ...current, project: { ...current.project, currentVersionId: target, updatedAt: new Date(Date.parse(f.at) + 100).toISOString() }, currentVersion: review.version };
      return jsonResponse({ projectId: f.projectId, currentVersionId: target, updatedAt: current.project.updatedAt, alreadyCurrent: false });
    }
    if (url.includes('/versions?')) {
      if (history) return history(url, init);
      const before = new URL(url, 'http://fixture').searchParams.get('beforeSequence');
      const available = items.filter(item => before === null || item.sequence < Number(before)); const page = available.slice(0, 20);
      return jsonResponse({ projectId: f.projectId, currentVersionId: current.project.currentVersionId,
        items: page.map(item => ({ ...item, isCurrent: item.id === current.project.currentVersionId })), nextBeforeSequence: available.length > 20 ? page.at(-1)?.sequence : null });
    }
    if (url.includes('/versions/')) {
      if (detail) return detail(url, init);
      const review = reviews.get(url.split('/').at(-1) ?? ''); assert.ok(review);
      return jsonResponse({ ...review, currentVersionId: current.project.currentVersionId, adoptionAvailability: review.version.id === current.project.currentVersionId ? 'already-current' : review.version.kind === 'template' ? 'not-candidate' : review.version.parentVersionId === current.project.currentVersionId ? 'eligible' : 'stale' });
    }
    if (url === `/api/projects/${f.projectId}`) return project ? project(url, init) : jsonResponse(current);
    if (url.includes('/messages?')) return jsonResponse({ items: [], nextBeforeSequence: null, latestSequence: 0 });
    if (url.startsWith('/api/projects?')) return jsonResponse({ items: [current.project], nextCursor: null });
    assert.fail(`Unexpected fixture route ${url}`);
  };
  const setCurrent = (id: string) => { const review = reviews.get(id); assert.ok(review); current = { ...current, project: { ...current.project, currentVersionId: id }, currentVersion: review.version }; };
  return { f, items, reviews, calls, transport, setCurrent, current: () => current,
    history: (handler?: Handler) => { history = handler; }, detail: (handler?: Handler) => { detail = handler; }, project: (handler?: Handler) => { project = handler; }, post: (handler?: Handler) => { post = handler; } };
}
async function mount(server: ReturnType<typeof historyServer>) {
  const app = new WorkspaceController({ transport: server.transport, storage: memoryStorage() });
  app.activate(routeFor(`/projects/${server.f.projectId}`)); await until(() => !app.snapshot().loading); assert.ok(app.snapshot().project); return app;
}
function compiled(app: WorkspaceController) { const key = app.previewIdentity(); assert.ok(key); app.previewState(previewTransition(initialPreview(key), { key, type: 'done', compilationError: false }), app.snapshot().activation); }
const posts = (server: ReturnType<typeof historyServer>) => server.calls.filter(call => call.method === 'POST');

test('history merge deduplicates both identities, preserves immutable metadata and recalibrates every badge without sequence guesses', () => {
  const s = historyServer(); const first = s.items.slice(0, 50); const duplicate = first[0]; assert.ok(duplicate);
  const result = mergeHistory(first, [{ ...duplicate, summary: { source: 'fallback', text: 'Must not replace' } }, ...s.items.slice(49)], s.f.versionId);
  assert.equal(result.length, 62); assert.equal(result[0]?.summary.text, duplicate.summary.text);
  assert.deepEqual(result.map(item => item.sequence), Array.from({ length: 62 }, (_, i) => 61 - i));
  assert.deepEqual(result.filter(item => item.isCurrent).map(item => item.id), [s.f.versionId]);
  const collision = { ...duplicate, id: crypto.randomUUID() };
  assert.equal(mergeHistory(result, [collision], s.f.baseId).length, 62);
});

test('history is lazy, manual and single flight; failures keep cursor, records and reading position; null stops pages', async t => {
  const s = historyServer(); const app = await mount(s); t.after(() => app.leave());
  assert.equal(s.calls.filter(call => call.url.includes('/versions?')).length, 0);
  app.setView('history'); await until(() => app.snapshot().history.loaded); assert.equal(app.snapshot().history.items.length, 20);
  const before = app.snapshot().history.before; app.historyPosition(247);
  const gate = deferred<Response>(); s.history(() => gate.promise);
  const more = app.loadHistory(true); await app.loadHistory(true); gate.resolve(safeErrorResponse(503, 'STORAGE_UNAVAILABLE')); await more;
  assert.equal(app.snapshot().history.items.length, 20); assert.equal(app.snapshot().history.before, before); assert.equal(app.snapshot().history.scrollTop, 247);
  s.history(); await app.loadHistory(true); await app.loadHistory(true); await app.loadHistory(true); await app.loadHistory(true);
  assert.equal(app.snapshot().history.items.length, 62); assert.equal(app.snapshot().history.before, null);
  assert.equal(s.calls.filter(call => call.url.includes('/versions?')).length, 5);
  assert.equal(posts(s).length, 0);
});

test('refresh resets paging epoch and fences a late earlier page while keeping selected snapshot', async t => {
  const s = historyServer(); const app = await mount(s); t.after(() => app.leave());
  await app.loadHistory(); await app.viewVersion('history', s.f.versionId); app.historyPosition(90);
  const gate = deferred<Response>(); s.history(() => gate.promise); const old = app.loadHistory(true); const epoch = app.snapshot().history.epoch;
  s.history(); await app.loadHistory(false, true); gate.resolve(jsonResponse({})); await old;
  assert.equal(app.snapshot().history.epoch, epoch + 1); assert.equal(app.snapshot().history.items.length, 20);
  assert.equal(app.snapshot().history.scrollTop, 0); assert.equal(app.snapshot().selected?.id, s.f.versionId); assert.equal(app.snapshot().history.error, '');
});

test('cross-page current observations are calibrated through project GET and yield one authoritative badge', async t => {
  const s = historyServer(); const app = await mount(s); t.after(() => app.leave()); await app.loadHistory();
  const target = s.items[22]?.id; assert.ok(target); s.setCurrent(target); await app.loadHistory(true);
  await until(() => app.snapshot().project?.project.currentVersionId === target && !app.snapshot().operation.querying);
  assert.deepEqual(app.snapshot().history.items.filter(item => item.isCurrent).map(item => item.id), [target]);
  assert.equal(app.snapshot().selected?.id, target); assert.equal(posts(s).length, 0);
});

test('A to B to A detail requests clear old bodies and reject aborted late reads; internal views preserve preview identity', async t => {
  const s = historyServer(); const app = await mount(s); t.after(() => app.leave());
  const gate = deferred<Response>(); const a = s.items[0]?.id; const b = s.items[1]?.id; assert.ok(a && b);
  s.detail(() => gate.promise); const old = app.viewVersion('history', a); assert.equal(app.snapshot().selected, null);
  s.detail(); await app.viewVersion('history', b); await app.viewVersion('history', a);
  const key = app.previewIdentity(); gate.resolve(jsonResponse(s.reviews.get(b))); await old;
  assert.equal(app.snapshot().selected?.id, a); assert.equal(app.snapshot().detailError, '');
  app.setView('code'); app.setView('preview'); assert.equal(app.previewIdentity(), key); assert.equal(posts(s).length, 0);
});

test('new candidate completion preserves active historical viewing and candidate remains reachable', async t => {
  const s = workspaceServer(); s.setMode('hold');
  const app = new WorkspaceController({ transport: s.transport, storage: memoryStorage() }); t.after(() => app.leave());
  app.activate(routeFor(`/projects/${s.f.projectId}`)); await until(() => app.snapshot().review !== null);
  const generation = app.start('Generate a candidate'); await until(() => app.snapshot().task?.phase === 'active');
  await app.viewVersion('history', s.f.baseId); const key = app.previewIdentity(); s.success(); await generation;
  await until(() => app.snapshot().review?.version.id === s.f.versionId);
  assert.equal(app.snapshot().intent, 'history'); assert.equal(app.snapshot().selected?.id, s.f.baseId); assert.equal(app.previewIdentity(), key);
  await app.viewVersion('candidate'); assert.equal(app.snapshot().selected?.id, s.f.versionId);
});

test('restore gate consumes only current actual compiled identity, locks failures, and invalidates frozen confirmation', async t => {
  const s = historyServer(); const app = await mount(s); t.after(() => app.leave()); await app.viewVersion('history', s.f.versionId);
  assert.equal(app.versionWriteAvailable('restore'), false); app.openRestore(); assert.equal(app.snapshot().operation.status, 'idle');
  const key = app.previewIdentity(); assert.ok(key);
  for (const type of ['load', 'connected'] as const) app.previewState(previewTransition(initialPreview(key), { key, type }), app.snapshot().activation);
  assert.equal(app.versionWriteAvailable('restore'), false);
  compiled(app); app.openRestore(); const frozen = app.snapshot().operation.frozen; assert.ok(frozen); assert.equal(frozen.expected, s.f.baseId);
  assert.equal(frozen.digest, s.f.snapshot.digest); assert.equal(frozen.target, s.f.versionId);
  app.previewState({ key, status: 'runtimeError', message: 'Actual failure' }, app.snapshot().activation);
  assert.equal(app.snapshot().operation.status, 'idle'); compiled(app); assert.equal(app.versionWriteAvailable('restore'), false);
  app.retryPreview(); app.previewState({ key, status: 'compiled', message: 'Old done' }, app.snapshot().activation);
  assert.equal(app.versionWriteAvailable('restore'), false); compiled(app); app.openRestore(); app.cancelRestore(); await app.submitRestore(); assert.equal(posts(s).length, 0);
  app.openRestore(); await app.viewVersion('current'); assert.equal(app.snapshot().operation.status, 'idle');
  compiled(app); app.openRestore(); assert.equal(app.snapshot().operation.status, 'idle', 'Current version cannot be restored');
  await app.viewVersion('history', s.f.versionId); compiled(app); app.openRestore();
  const target = s.items[4]?.id; assert.ok(target); s.setCurrent(target); app.facts(s.current(), app.snapshot().activation);
  await app.submitRestore(); assert.equal(posts(s).length, 0); assert.equal(app.snapshot().operation.status, 'idle');
});

test('restore sends frozen CAS once, shares generation/adoption lock and preserves acknowledged success and draft when calibration fails', async t => {
  const s = historyServer(); const app = await mount(s); t.after(() => app.leave()); await app.viewVersion('history', s.f.versionId); compiled(app); app.setDraft('Unsent draft');
  app.openRestore(); await app.start(); await app.submitAdoption(); assert.equal(posts(s).length, 0);
  const gate = deferred<Response>(); s.post(() => gate.promise); const restore = app.submitRestore(); await app.submitRestore(); await app.start();
  s.project(async () => safeErrorResponse(503, 'STORAGE_UNAVAILABLE'));
  gate.resolve(jsonResponse({ projectId: s.f.projectId, currentVersionId: s.f.versionId, updatedAt: s.f.at, alreadyCurrent: false })); await restore;
  assert.equal(posts(s).length, 1); assert.deepEqual(posts(s)[0]?.body, { expectedCurrentVersionId: s.f.baseId }); assert.ok(posts(s)[0]?.url.endsWith('/restore'));
  assert.equal(app.snapshot().operation.status, 'confirmed'); assert.match(app.snapshot().operation.refreshError, /已确认/);
  assert.equal(app.snapshot().project?.project.currentVersionId, s.f.versionId); assert.equal(app.snapshot().project?.currentVersion.id, s.f.versionId);
  assert.equal(app.snapshot().draft, 'Unsent draft'); assert.equal(app.snapshot().selected?.id, s.f.versionId);
});

test('restoring template or stale branch uses restore eligibility independently of adopt parent rules', async t => {
  const s = historyServer(); const app = await mount(s); t.after(() => app.leave());
  const current = s.items[0]?.id; assert.ok(current); s.setCurrent(current); await app.refreshCurrent();
  for (const target of [s.f.versionId, s.f.baseId]) {
    await app.viewVersion('history', target); compiled(app); assert.equal(app.versionWriteAvailable('restore'), true); assert.equal(app.versionWriteAvailable('adopt'), false);
    app.openRestore(); await app.submitRestore(); assert.equal(app.snapshot().project?.project.currentVersionId, target); assert.equal(app.snapshot().operation.status, 'confirmed');
  }
  assert.equal(posts(s).length, 2); assert.equal(s.items.length, 62);
});

test('unknown restore performs one GET, remains blocked on different current and failed query, and manual target query confirms without repost', async t => {
  const s = historyServer(); const app = await mount(s); t.after(() => app.leave()); await app.viewVersion('history', s.f.versionId); compiled(app);
  s.post(async () => { throw new Error('PRIVATE_NETWORK_SENTINEL'); }); app.openRestore(); const count = s.calls.filter(call => call.url === `/api/projects/${s.f.projectId}`).length;
  await app.submitRestore(); assert.equal(app.snapshot().operation.status, 'unknown');
  assert.equal(s.calls.filter(call => call.url === `/api/projects/${s.f.projectId}`).length, count + 1);
  app.setDraft('Blocked draft'); await app.viewVersion('current'); compiled(app); await app.start(); await app.submitAdoption(); app.openRestore(); await app.submitRestore();
  assert.equal(posts(s).length, 1); assert.equal(app.snapshot().draft, 'Blocked draft');
  s.project(async () => safeErrorResponse(503, 'STORAGE_UNAVAILABLE')); await app.refreshCurrent(); assert.equal(app.snapshot().operation.status, 'unknown');
  assert.match(app.snapshot().operation.refreshError, /查询失败/);
  s.project(); s.setCurrent(s.f.versionId); await app.refreshCurrent(); assert.equal(app.snapshot().operation.status, 'confirmed');
  assert.equal(app.snapshot().project?.project.currentVersionId, s.f.versionId); assert.equal(posts(s).length, 1);
});

test('late list current fields and stale project reads cannot roll back write acknowledgements or newer project facts', async t => {
  const s = historyServer(); const app = await mount(s); t.after(() => app.leave());
  const gate = deferred<Response>(); s.history(() => gate.promise); const list = app.loadHistory();
  await app.viewVersion('history', s.f.versionId); compiled(app); app.openRestore(); await app.submitRestore();
  gate.resolve(jsonResponse({ projectId: s.f.projectId, currentVersionId: s.f.baseId, items: [s.items.at(-1)], nextBeforeSequence: null })); await list;
  assert.equal(app.snapshot().project?.project.currentVersionId, s.f.versionId); assert.equal(app.snapshot().history.items[0]?.isCurrent, false);
  const stale = deferred<Response>(); s.project(() => stale.promise); const query = app.refreshCurrent();
  const next = s.items[2]?.id; assert.ok(next); s.setCurrent(next); app.facts(s.current(), app.snapshot().activation);
  stale.resolve(jsonResponse(s.f.project)); await query; assert.equal(app.snapshot().project?.project.currentVersionId, next);
});

test('successful POST followed by a different current keeps acknowledgement while calibrating latest facts and selection', async t => {
  const s = historyServer(); const app = await mount(s); t.after(() => app.leave()); await app.viewVersion('history', s.f.versionId); compiled(app);
  const other = s.items[0]?.id; assert.ok(other);
  s.project(async () => { s.setCurrent(other); return jsonResponse(s.current()); }); app.openRestore(); await app.submitRestore();
  assert.equal(app.snapshot().operation.status, 'confirmed'); assert.match(app.snapshot().operation.message, /其他操作/);
  assert.equal(app.snapshot().project?.project.currentVersionId, other); assert.equal(app.snapshot().selected?.id, s.f.versionId);
});

test('conflict, busy, unconfirmed and definite failure have distinct states with no automatic write retries', async t => {
  for (const [code, status, http] of [['CURRENT_VERSION_CONFLICT', 'conflict', 409], ['PROJECT_BUSY', 'busy', 409], ['RUN_STATE_UNCONFIRMED', 'unconfirmed', 503], ['STORAGE_UNAVAILABLE', 'error', 503]] as const) {
    const s = historyServer(); const app = await mount(s); t.after(() => app.leave()); await app.viewVersion('history', s.f.versionId); compiled(app);
    s.post(async () => safeErrorResponse(http, code)); app.openRestore(); await app.submitRestore();
    assert.equal(app.snapshot().operation.status, status); assert.equal(posts(s).length, 1); assert.equal(app.snapshot().selected?.id, s.f.versionId);
    if (status === 'busy' || status === 'unconfirmed') { await app.start(); assert.equal(posts(s).length, 1); await app.refreshCurrent(); assert.equal(app.snapshot().operation.status, 'error'); assert.equal(app.versionWriteAvailable('restore'), false); }
  }
});

test('401 erases private history, selected code, drafts and caches; 404 clears invalid target and keeps current and draft', async t => {
  for (const status of [401, 404]) {
    const s = historyServer(); const app = await mount(s); t.after(() => app.leave()); await app.loadHistory(); app.setDraft('Private draft');
    await app.viewVersion('history', s.f.versionId); compiled(app); s.post(async () => safeErrorResponse(status, status === 401 ? 'SESSION_REQUIRED' : 'NOT_FOUND'));
    app.openRestore(); await app.submitRestore();
    assert.equal(app.snapshot().selected, null); assert.equal(app.snapshot().viewedVersionId, null);
    if (status === 401) { assert.equal(app.snapshot().project, null); assert.equal(app.snapshot().draft, ''); assert.equal(app.snapshot().history.items.length, 0); }
    else { assert.equal(app.snapshot().project?.project.currentVersionId, s.f.baseId); assert.equal(app.snapshot().draft, 'Private draft'); assert.ok(!app.snapshot().history.items.some(item => item.id === s.f.versionId)); }
    assert.equal(posts(s).length, 1); assert.ok(!s.calls.some(call => call.url === '/api/session'));
  }
});

test('navigation fences late POST and query results; returning reads facts without replay and retains project draft', async t => {
  const s = historyServer(); const app = await mount(s); t.after(() => app.leave()); await app.viewVersion('history', s.f.versionId); compiled(app); app.setDraft('Keep draft');
  const gate = deferred<Response>(); s.post(() => gate.promise); app.openRestore(); const restore = app.submitRestore();
  app.activate(routeFor('/diagnostics/connection')); s.setCurrent(s.f.versionId);
  gate.resolve(jsonResponse({ projectId: s.f.projectId, currentVersionId: s.f.versionId, updatedAt: s.f.at, alreadyCurrent: false })); await restore;
  assert.equal(app.snapshot().project, null); assert.equal(app.snapshot().operation.status, 'idle');
  app.activate(routeFor(`/projects/${s.f.projectId}`)); await until(() => !app.snapshot().loading);
  assert.equal(app.snapshot().project?.project.currentVersionId, s.f.versionId); assert.equal(app.snapshot().draft, 'Keep draft'); assert.equal(app.snapshot().preview, null);
  assert.equal(posts(s).length, 1);
});

test('a known active or unknown generation excludes restore even when history preview is compiled', async t => {
  const s = historyServer(); const app = await mount(s); t.after(() => app.leave()); await app.viewVersion('history', s.f.versionId); compiled(app);
  const run = s.f.review.successfulRun; assert.ok(run);
  const detail: ProjectDetail = { ...s.current(), latestRun: { ...run, status: 'running', resultVersionId: null, finishedAt: null } };
  app.facts(detail, app.snapshot().activation); assert.equal(app.versionWriteAvailable('restore'), false); app.openRestore(); await app.submitRestore(); assert.equal(posts(s).length, 0);
});

test('compile errors, runtime errors, timeout and feedback from old activations cannot open restore', async t => {
  const s = historyServer(); const app = await mount(s); t.after(() => app.leave()); await app.viewVersion('history', s.f.versionId);
  for (const status of ['compileError', 'runtimeError', 'timeout'] as const) {
    app.retryPreview(); const key = app.previewIdentity(); assert.ok(key); const activation = app.snapshot().activation;
    app.previewState({ key, status: 'compiled', message: 'Wrong activation' }, activation - 1); assert.equal(app.versionWriteAvailable('restore'), false);
    app.previewState({ key, status, message: 'Observed failure' }, activation); compiled(app); app.openRestore();
    assert.equal(app.snapshot().preview?.status, status); assert.equal(app.snapshot().operation.status, 'idle');
  }
  app.retryPreview(); compiled(app); assert.equal(app.versionWriteAvailable('restore'), true);
});

test('invalid historical snapshot clears inspected body and gate while retaining authoritative current, candidate and draft', async t => {
  const s = historyServer(); const app = await mount(s); t.after(() => app.leave()); await app.viewVersion('candidate', s.f.versionId); compiled(app); app.setDraft('Keep unsent text');
  const current = app.snapshot().project; const candidate = app.snapshot().review;
  s.detail(async () => jsonResponse({ ...s.f.review, version: { ...s.f.review.version, snapshot: { ...s.f.snapshot, digest: '0'.repeat(64) } } }));
  await app.viewVersion('history', s.f.versionId);
  assert.equal(app.snapshot().selected, null); assert.equal(app.snapshot().selectedReview, null); assert.equal(app.snapshot().preview, null);
  assert.ok(app.snapshot().detailError); assert.equal(app.snapshot().project, current); assert.equal(app.snapshot().review, candidate); assert.equal(app.snapshot().draft, 'Keep unsent text');
  app.openRestore(); await app.submitRestore(); assert.equal(posts(s).length, 0);
});

test('adoption holds the same operation lock as restore and generation, including manual unknown retry during refresh', async t => {
  const s = historyServer(); const app = await mount(s); t.after(() => app.leave()); await app.viewVersion('candidate', s.f.versionId); compiled(app);
  const gate = deferred<Response>(); s.post(() => gate.promise); const adoption = app.submitAdoption();
  await app.submitAdoption(); await app.start('Blocked generation'); await app.viewVersion('history', s.items[0]?.id); compiled(app); app.openRestore();
  assert.equal(posts(s).length, 1); assert.equal(app.snapshot().operation.status, 'submitting'); assert.ok(posts(s)[0]?.url.endsWith('/adopt'));
  gate.resolve(new Response('Bad JSON')); await adoption; assert.equal(app.snapshot().operation.status, 'unknown');
  await app.viewVersion('candidate', s.f.versionId); compiled(app); const query = deferred<Response>(); s.project(() => query.promise);
  const refresh = app.refreshCurrent(); await app.submitAdoption(true); assert.equal(posts(s).length, 1);
  query.resolve(jsonResponse(s.current())); await refresh;
  s.project(); s.post(); await app.submitAdoption(true); assert.equal(posts(s).length, 2); assert.deepEqual(posts(s)[1]?.body, posts(s)[0]?.body);
  assert.equal(app.snapshot().operation.status, 'confirmed');
});

test('history 401 and unknown-result query 401 clear all private ownership data without session creation', async t => {
  for (const stage of ['history', 'query'] as const) {
    const s = historyServer(); const app = await mount(s); t.after(() => app.leave()); app.setDraft('Private draft');
    if (stage === 'history') { s.history(async () => safeErrorResponse(401, 'SESSION_REQUIRED')); await app.loadHistory(); }
    else {
      await app.viewVersion('history', s.f.versionId); compiled(app); s.post(async () => new Response('{}'));
      s.project(async () => safeErrorResponse(401, 'SESSION_REQUIRED')); app.openRestore(); await app.submitRestore();
    }
    assert.equal(app.snapshot().project, null); assert.equal(app.snapshot().selected, null); assert.equal(app.snapshot().draft, '');
    assert.equal(app.snapshot().history.items.length, 0); assert.ok(!s.calls.some(call => call.url === '/api/session'));
  }
});

test('late detail current fields are fenced by the project fact epoch without discarding the immutable snapshot', async t => {
  const s = historyServer(); const app = await mount(s); t.after(() => app.leave());
  const other = s.items[0]?.id; assert.ok(other); s.setCurrent(other); await app.refreshCurrent();
  const gate = deferred<Response>(); s.detail(() => gate.promise); const read = app.viewVersion('candidate', s.f.versionId);
  s.setCurrent(s.f.baseId); await app.refreshCurrent();
  gate.resolve(jsonResponse({ ...s.f.review, currentVersionId: other, adoptionAvailability: 'stale' })); await read; compiled(app);
  assert.equal(app.snapshot().selected?.id, s.f.versionId); assert.equal(app.snapshot().project?.project.currentVersionId, s.f.baseId);
  assert.equal(app.versionWriteAvailable('adopt'), true, 'Old detail availability cannot replace fresh project facts');
});

test('project 404 after acknowledged restore removes inaccessible content but preserves acknowledgement and unsent draft', async t => {
  const s = historyServer(); const app = await mount(s); t.after(() => app.leave()); await app.viewVersion('history', s.f.versionId); compiled(app); app.setDraft('Unsent draft');
  s.project(async () => safeErrorResponse(404)); app.openRestore(); await app.submitRestore();
  assert.equal(app.snapshot().project, null); assert.equal(app.snapshot().selected, null); assert.equal(app.snapshot().history.items.length, 0);
  assert.equal(app.snapshot().operation.status, 'confirmed'); assert.match(app.snapshot().operation.message, /服务端已确认/); assert.equal(app.snapshot().draft, 'Unsent draft');
  assert.equal(posts(s).length, 1);
});
