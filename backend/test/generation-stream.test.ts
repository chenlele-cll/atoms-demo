import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { request as httpRequest } from 'node:http';
import Database from 'better-sqlite3';
import { buildApp } from '../src/app.js';
import { generationEventSchema, generationStatusSchema } from '../src/contracts/generations.js';
import type { GenerationEvent } from '../src/contracts/generations.js';
import { errorSchema } from '../src/contracts/projects.js';
import { GenerationManager } from '../src/generation/manager.js';
import type { GenerationOptions } from '../src/generation/manager.js';
import { openStore } from '../src/storage/store.js';
import { ProjectError } from '../src/projects/errors.js';
import { generationFixture, successfulGeneration } from './helpers/generation.js';
import { fixtureEnv, startFixture } from './helpers/model-fixture.js';

const origin = 'http://127.0.0.1:5173';
async function fixture(t: TestContext, options: GenerationOptions = {}, gated = false) {
  const f = await generationFixture(t);
  let release: () => void = () => {}; const gate = new Promise<void>(r => { release = r; });
  const upstream = await startFixture((body, res, index) => {
    void (async () => {
      if (gated && index === 1) await gate;
      res.end(JSON.stringify(successfulGeneration(body, ((index - 1) % 3) + 1)));
    })();
  });
  const app = buildApp({ logger: false }, { store: f.store, catalog: f.catalog, origins: [origin], secureCookies: false,
    generation: { env: { ...fixtureEnv, MODEL_TIMEOUT_MS: '5000' }, transport: upstream.transport,
      limits: { postPerMinute: 1000, queryPerMinute: 1000, cancelPerMinute: 1000 }, ...options } });
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  const headers = { origin, 'content-type': 'application/json', accept: 'text/event-stream', cookie: `atoms_session=${f.session.token}` };
  const body = { requestId: f.input.requestId, baseVersionId: f.input.baseVersionId, prompt: f.input.prompt };
  const path = `/api/projects/${f.input.projectId}/generations`;
  const query = `${path}/by-request/${body.requestId}`;
  const post = (extra: Record<string, unknown> = {}, signal?: AbortSignal) => fetch(base + path,
    { method: 'POST', headers, body: JSON.stringify({ ...body, ...extra }), ...(signal ? { signal } : {}) });
  const status = async () => { const response = await fetch(base + query, { headers }); return { code: response.status, body: await response.json() as unknown }; };
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => { release(); await app.close(); await upstream.close(); })();
  t.after(close);
  return { ...f, app, upstream, release, base, headers, body, path, query, post, status, close };
}
function frames(response: Response) {
  const body = response.body; if (!body) throw new Error('Missing stream body'); const reader = body.getReader();
  const decoder = new TextDecoder(); let pending = ''; const comments: string[] = [];
  const events: GenerationEvent[] = [];
  async function next(): Promise<GenerationEvent | null> {
    for (;;) {
      const end = pending.indexOf('\n\n');
      if (end >= 0) {
        const frame = pending.slice(0, end); pending = pending.slice(end + 2);
        if (frame.startsWith(':')) { comments.push(frame); continue; }
        const data = frame.split('\n').find(line => line.startsWith('data: ')); assert.ok(data);
        const event = generationEventSchema.parse(JSON.parse(data.slice(6)) as unknown);
        assert.equal(frame.split('\n')[0], `event: ${event.event}`); events.push(event); return event;
      }
      const chunk = await reader.read();
      if (chunk.done) { pending += decoder.decode(); assert.equal(pending, ''); return null; }
      pending += decoder.decode(chunk.value, { stream: true });
    }
  }
  return { reader, next, events, comments, all: async () => { while (await next()) { /* parse every frame */ } return events; } };
}
async function until(work: () => boolean | Promise<boolean>, message = 'Condition did not complete') {
  for (let i = 0; i < 200; i++) { if (await work()) return; await delay(10); }
  assert.fail(message);
}

test('real HTTP accepted arrives before gated SDK response, real activities/one persisted terminal, replay and privacy', async t => {
  const f = await fixture(t, { streamLimits: { heartbeatMs: 15 } }, true);
  const response = await f.post(); assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
  assert.equal(response.headers.get('x-accel-buffering'), 'no'); assert.equal(response.headers.get('content-length'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store, no-transform');
  const stream = frames(response); const first = await stream.next(); assert.equal(first?.event, 'accepted');
  await until(() => f.upstream.requests.length === 1); assert.equal(f.store.getProject(f.session.id, f.input.projectId).latestRun?.status, 'running');
  const duplicateController = new AbortController();
  const duplicate = await f.post({}, duplicateController.signal); assert.equal(duplicate.status, 202); assert.match(duplicate.headers.get('content-type') ?? '', /json/);
  assert.equal(generationStatusSchema.parse(await duplicate.json()).status, 'running');
  duplicateController.abort();
  assert.equal((await f.post({ prompt: 'different' })).status, 409);
  await delay(35); f.release();
  const events = await stream.all(); assert.ok(stream.comments.length > 0);
  assert.deepEqual(events.map(event => event.seq), events.map((_, index) => index + 1));
  for (const event of events) { assert.equal(event.projectId, f.input.projectId); assert.equal(event.requestId, f.body.requestId); assert.equal(event.runId, first?.runId); }
  const terminal = events.filter(event => event.event === 'terminal'); assert.equal(terminal.length, 1);
  assert.equal(terminal[0]?.state.status, 'succeeded'); assert.equal(terminal[0]?.state.previewStatus, 'unverified');
  assert.deepEqual(terminal[0]?.state.changedFiles, ['/src/generated/FixtureQuote.tsx']);
  const wire = JSON.stringify({ events, state: (await f.status()).body });
  for (const secret of [f.input.prompt, f.session.token, 'sk-', 'export default function', 'Explicit test fixture, no real generation claim.']) assert.ok(!wire.includes(secret));
  const replay = await f.post(); assert.equal(replay.status, 200); assert.equal(generationStatusSchema.parse(await replay.json()).status, 'succeeded');
  assert.equal(f.upstream.requests.length, 3); assert.equal(f.store.listMessages(f.session.id, f.input.projectId, 0, 20).items.length, 2);
  assert.equal(f.store.getProject(f.session.id, f.input.projectId).currentVersion.id, f.input.baseVersionId);
  const cancelled = await fetch(f.base + f.query + '/cancel', { method: 'POST', headers: f.headers, body: '{}' });
  assert.equal(cancelled.status, 200); assert.equal(generationStatusSchema.parse(await cancelled.json()).status, 'succeeded');
  // Ownership of a duplicate response never includes the original stream's controller.
  assert.equal(f.upstream.requests.length, 3);
  await f.close();
});

test('public validation and A/B ownership fail before any acceptance/model call', async t => {
  const f = await fixture(t);
  const b = f.store.createSession();
  for (const [suffix, method, payload] of [['', 'POST', f.body], [`/by-request/${f.body.requestId}`, 'GET', undefined], [`/by-request/${f.body.requestId}/cancel`, 'POST', {}]] as const) {
    const denied = await f.app.inject({ method, url: f.path + suffix, headers: { ...f.headers, cookie: `atoms_session=${b.token}` }, ...(payload ? { payload } : {}) });
    const missing = await f.app.inject({ method, url: f.path.replace(f.input.projectId, randomUUID()) + suffix, headers: { ...f.headers, cookie: `atoms_session=${b.token}` }, ...(payload ? { payload } : {}) });
    assert.equal(denied.statusCode, 404); assert.deepEqual(denied.json().error, missing.json().error);
    assert.equal((await f.app.inject({ method, url: f.path + suffix, headers: { ...f.headers, cookie: '' }, ...(payload ? { payload } : {}) })).statusCode, 401);
  }
  for (const [body, headers, status] of [
    [{ ...f.body, model: 'arbitrary' }, {}, 400], [{ ...f.body, prompt: 'x'.repeat(4001) }, {}, 400],
    [f.body, { accept: '*/*' }, 406], [f.body, { accept: 'text/event-stream;q=0' }, 406],
    [f.body, { origin: 'http://foreign.invalid' }, 403], [f.body, { 'content-type': 'text/plain' }, 415],
    [{ ...f.body, prompt: 'x'.repeat(33 * 1024) }, {}, 413],
  ] as const) {
    const result = await f.app.inject({ method: 'POST', url: f.path, headers: { ...f.headers, ...headers }, payload: JSON.stringify(body) });
    assert.equal(result.statusCode, status, result.body); assert.equal(result.headers['cache-control'], 'no-store');
  }
  assert.equal((await f.app.inject({ method: 'POST', url: f.path.replace(f.input.projectId, 'bad'), headers: f.headers, payload: f.body })).statusCode, 400);
  assert.equal((await f.app.inject({ method: 'POST', url: f.query + '/cancel', headers: f.headers, payload: { code: true } })).statusCode, 400);
  assert.equal(f.upstream.requests.length, 0); assert.equal(f.store.getProject(f.session.id, f.input.projectId).latestRun, null);
  await f.close();
});

test('missing configuration is safe JSON 503 without accepting user input', async t => {
  const f = await fixture(t, { env: {} });
  const result = await f.post(); assert.equal(result.status, 503); assert.equal(errorSchema.parse(await result.json()).error.code, 'MODEL_CONFIGURATION');
  assert.equal(f.upstream.requests.length, 0); assert.equal(f.store.getProject(f.session.id, f.input.projectId).latestRun, null); await f.close();
});

test('global admission uses HTTP 503 and Retry-After without acceptance', async t => {
  const f = await fixture(t, { limits: { global: 0 } });
  const response = await f.post(); assert.equal(response.status, 503); assert.equal(response.headers.get('retry-after'), '5');
  assert.equal(errorSchema.parse(await response.json()).error.code, 'GENERATION_CAPACITY');
  assert.equal(f.upstream.requests.length, 0); assert.equal(f.store.getProject(f.session.id, f.input.projectId).latestRun, null); await f.close();
});

test('lost terminal after committed save remains queryable success and is never overwritten by cancel', async t => {
  const f = await fixture(t); const controller = new AbortController();
  const complete = f.store.completeGeneration.bind(f.store);
  t.mock.method(f.store, 'completeGeneration', (...args: Parameters<typeof complete>) => {
    const saved = complete(...args); controller.abort(); return saved;
  });
  const response = await f.post({}, controller.signal); const stream = frames(response); await stream.next();
  await assert.rejects(stream.all());
  await until(async () => generationStatusSchema.parse((await f.status()).body).status === 'succeeded');
  const state = generationStatusSchema.parse((await f.status()).body); assert.ok(state.candidateVersionId); assert.equal(f.upstream.requests.length, 3);
  const cancel = await fetch(f.base + f.query + '/cancel', { method: 'POST', headers: f.headers, body: '{}' });
  assert.equal(cancel.status, 200); assert.equal(generationStatusSchema.parse(await cancel.json()).status, 'succeeded');
  const sql = new Database(f.filename); assert.equal((sql.prepare("SELECT count(*) AS n FROM versions WHERE kind='generated'").get() as { n: number }).n, 1); sql.close();
  await f.close();
});

test('failed accepted-frame transport aborts before model work and releases its accepted run', async t => {
  const f = await generationFixture(t); let calls = 0;
  const manager = new GenerationManager(f.store, { env: fixtureEnv, streamLimits: { frameBytes: 1 }, transport: async () => { calls++; throw new Error(); } });
  const accepted = manager.accept(f.input); assert.ok(accepted.fresh); accepted.start();
  await until(() => manager.activeCount === 0);
  assert.equal(calls, 0); assert.equal(manager.status(f.session.id, f.input.projectId, f.input.requestId).errorCode, 'STREAM_WRITE_FAILED');
  await manager.shutdown();
});

test('late transport resolving after shutdown cannot access closed storage or start another model step', async t => {
  const f = await generationFixture(t); let calls = 0; let release: (response: Response) => void = () => {};
  const manager = new GenerationManager(f.store, { env: fixtureEnv, transport: async () => { calls++; return new Promise<Response>(r => { release = r; }); } });
  const accepted = manager.accept(f.input); assert.ok(accepted.fresh); accepted.start(); await until(() => calls === 1);
  await manager.shutdown(); f.store.close();
  const noAccess = () => { assert.fail('Late access to closed storage'); };
  const complete = t.mock.method(f.store, 'completeGeneration', noAccess);
  const finish = t.mock.method(f.store, 'finishRun', noAccess);
  const inspect = t.mock.method(f.store, 'inspectGeneration', noAccess);
  release(new Response(JSON.stringify(successfulGeneration({ model: 'gpt-6.1-sol', store: false, max_output_tokens: 4096, input: [] }, 1)), { headers: { 'content-type': 'application/json' } }));
  await delay(50); assert.equal(calls, 1); assert.equal(manager.activeCount, 0);
  for (const method of [complete, finish, inspect]) assert.equal(method.mock.callCount(), 0);
});

test('explicit repeated cancellation aborts upstream, confirms cancelled and frees capacity only after finalization', async t => {
  const f = await fixture(t, {}, true);
  const response = await f.post(); const stream = frames(response); await stream.next();
  await until(() => f.upstream.requests.length === 1);
  const cancel = () => fetch(f.base + f.query + '/cancel', { method: 'POST', headers: f.headers, body: '{}' });
  const result = await cancel(); assert.equal(result.status, 202); assert.equal(generationStatusSchema.parse(await result.json()).cancellationRequested, true);
  const repeated = await cancel(); assert.ok([200, 202].includes(repeated.status));
  const events = await stream.all(); const terminal = events.find(event => event.event === 'terminal');
  assert.equal(terminal?.state.status, 'cancelled'); assert.equal(terminal?.state.errorCode, 'USER_CANCELLED');
  await until(() => f.upstream.aborted() > 0);
  assert.equal(generationStatusSchema.parse((await f.status()).body).status, 'cancelled');
  assert.equal(f.store.generationState(f.session.id, f.input.projectId, f.body.requestId).candidateVersion, null);
  f.release(); const next = await f.post({ requestId: randomUUID() }); assert.equal(next.status, 200); await frames(next).all(); await f.close();
});

for (const kind of ['fetch-abort', 'raw-socket'] as const) test(`original ${kind} disconnect cancels the real upstream and preserves current snapshot`, async t => {
  const f = await fixture(t, {}, true);
  const controller = new AbortController();
  if (kind === 'fetch-abort') { const response = await f.post({}, controller.signal); await frames(response).next(); }
  else {
    await new Promise<void>((resolve, reject) => {
      const request = httpRequest(f.base + f.path, { method: 'POST', headers: f.headers }, response => {
        response.once('data', () => { response.destroy(); resolve(); }); response.on('error', () => {});
      }); request.on('error', reject); request.end(JSON.stringify(f.body));
    });
  }
  await until(() => f.upstream.requests.length === 1); controller.abort();
  await until(async () => generationStatusSchema.parse((await f.status()).body).status === 'cancelled');
  const state = generationStatusSchema.parse((await f.status()).body); assert.equal(state.errorCode, 'CLIENT_DISCONNECTED');
  await until(() => f.upstream.aborted() > 0);
  assert.equal(f.store.getProject(f.session.id, f.input.projectId).currentVersion.id, f.input.baseVersionId);
  f.release(); await delay(30); assert.equal(f.upstream.requests.length, 1); await f.close();
});

test('admission project/session/global priorities, Retry-After and capacity restoration', async t => {
  const f = await fixture(t, {}, true);
  const first = await f.post(); const firstStream = frames(first); await firstStream.next();
  const busy = await f.post({ requestId: randomUUID() }); assert.equal(busy.status, 409); assert.equal(errorSchema.parse(await busy.json()).error.code, 'PROJECT_BUSY');
  const secondProject = f.store.createProject(f.session.id, 'same session', f.bundle);
  const blockedSession = await fetch(f.base + f.path.replace(f.input.projectId, secondProject.project.id), { method: 'POST', headers: f.headers,
    body: JSON.stringify({ ...f.body, requestId: randomUUID(), baseVersionId: secondProject.currentVersion.id }) });
  assert.equal(blockedSession.status, 429); assert.equal(blockedSession.headers.get('retry-after'), '5');
  const newOwner = () => {
    const session = f.store.createSession(); const detail = f.store.createProject(session.id, 'other session', f.bundle);
    return { session, detail };
  };
  const b = newOwner(); const c = newOwner();
  // Keep all model calls gated by a separate noncooperative transport until cancellation.
  const manager = new GenerationManager(f.store, { env: fixtureEnv, limits: { global: 2 }, transport: async () => new Promise(() => {}) });
  const input = (item: ReturnType<typeof newOwner>) => ({ ...f.input, sessionId: item.session.id, projectId: item.detail.project.id,
    baseVersionId: item.detail.currentVersion.id, requestId: randomUUID() });
  const b1 = manager.accept(input(b)); assert.ok(b1.fresh); b1.start();
  const c1 = manager.accept(input(c)); assert.ok(c1.fresh); c1.start();
  assert.throws(() => manager.accept({ ...f.input, projectId: secondProject.project.id, baseVersionId: secondProject.currentVersion.id, requestId: randomUUID() }),
    error => error instanceof ProjectError && error.code === 'GENERATION_CAPACITY' && error.retryAfter === 5);
  await manager.shutdown(); assert.equal(manager.activeCount, 0);
  f.release(); await firstStream.all(); await f.close();
});

test('daily quota persists across reopen, duplicate is free, and rolling window expires', async t => {
  const f = await fixture(t, { limits: { daily: 1, postPerMinute: 100 } });
  await frames(await f.post()).all();
  assert.equal((await f.post()).status, 200);
  const limited = await f.post({ requestId: randomUUID() }); assert.equal(limited.status, 429); assert.ok(Number(limited.headers.get('retry-after')) > 0);
  await f.close(); const store = openStore(f.filename); t.after(() => store.close());
  const manager = new GenerationManager(store, { env: fixtureEnv, limits: { daily: 1 } });
  assert.throws(() => manager.accept({ ...f.input, requestId: randomUUID() }), error => error instanceof ProjectError && error.code === 'GENERATION_QUOTA');
  const expired = new GenerationManager(store, { env: fixtureEnv, now: () => Date.now() + 86_400_010, limits: { daily: 1 } });
  const accepted = expired.accept({ ...f.input, requestId: randomUUID() }); assert.ok(accepted.fresh);
  await expired.shutdown(); await manager.shutdown();
});

test('orphan running is unknown/unavailable and cannot be hidden by a new request', async t => {
  const f = await fixture(t);
  f.store.createRun({ projectId: f.input.projectId, requestId: f.body.requestId, baseVersionId: f.input.baseVersionId,
    messages: [{ role: 'user', content: f.input.prompt }] });
  assert.equal((await f.status()).code, 503);
  for (const body of [{}, { requestId: randomUUID() }]) { const result = await f.post(body); assert.equal(result.status, 503); assert.equal(errorSchema.parse(await result.json()).error.code, 'RUN_STATE_UNCONFIRMED'); }
  assert.equal(f.upstream.requests.length, 0); await f.close();
});

test('terminal storage failure emits unknown once, never success or JSON inside SSE', async t => {
  const f = await fixture(t);
  t.mock.method(f.store, 'completeGeneration', () => { throw new ProjectError('STORAGE_UNAVAILABLE'); });
  t.mock.method(f.store, 'finishRun', () => { throw new ProjectError('STORAGE_UNAVAILABLE'); });
  const events = await frames(await f.post()).all(); const terminal = events.filter(event => event.event === 'terminal');
  assert.equal(terminal.length, 1); assert.equal(terminal[0]?.state.status, 'unknown');
  assert.equal(terminal[0]?.state.terminalStatePersisted, false); assert.equal(terminal[0]?.state.candidateVersionId, null);
  assert.equal((await f.status()).code, 503); await f.close();
});

test('admission failure leaks no slot, stop revokes late writes and no unhandled rejection', async t => {
  const f = await generationFixture(t);
  const invalidTransport = new GenerationManager(f.store, { env: fixtureEnv, streamLimits: { highWaterMark: -1 } });
  assert.throws(() => invalidTransport.accept(f.input)); assert.equal(invalidTransport.activeCount, 0);
  assert.equal(f.store.getProject(f.session.id, f.input.projectId).latestRun, null);
  const manager = new GenerationManager(f.store, { env: fixtureEnv, transport: async () => new Promise(() => {}) });
  const mock = t.mock.method(f.store, 'acceptGeneration', () => { throw new ProjectError('STORAGE_UNAVAILABLE'); });
  assert.throws(() => manager.accept(f.input)); assert.equal(manager.activeCount, 0); mock.mock.restore();
  const started = manager.accept(f.input); assert.ok(started.fresh); started.start();
  await manager.shutdown(); assert.equal(manager.activeCount, 0);
  assert.equal(f.store.generationState(f.session.id, f.input.projectId, f.input.requestId).run.status, 'cancelled');
  assert.throws(() => manager.accept({ ...f.input, requestId: randomUUID() }), error => error instanceof ProjectError && error.code === 'GENERATION_UNAVAILABLE');
});

test('independent rate buckets and forged forwarding headers cannot bypass POST rate', async t => {
  const f = await fixture(t, { limits: { postPerMinute: 1, queryPerMinute: 2, cancelPerMinute: 2 } });
  const result = await f.app.inject({ method: 'POST', url: f.path, headers: f.headers, payload: { ...f.body, model: 'bad' } }); assert.equal(result.statusCode, 400);
  const limited = await f.app.inject({ method: 'POST', url: f.path, headers: { ...f.headers, 'x-forwarded-for': '203.0.113.52' }, payload: f.body });
  assert.equal(limited.statusCode, 429); assert.ok(limited.headers['retry-after']);
  assert.equal((await f.app.inject({ method: 'GET', url: f.query, headers: f.headers })).statusCode, 404);
  assert.equal((await f.app.inject({ method: 'POST', url: f.query + '/cancel', headers: f.headers, payload: {} })).statusCode, 404);
  assert.equal(f.upstream.requests.length, 0); await f.close();
});

test('atomic startup recovery preserves candidate/messages/current and does not retry model work', async t => {
  const f = await generationFixture(t);
  const run = f.store.createRun({ projectId: f.input.projectId, requestId: f.input.requestId, baseVersionId: f.input.baseVersionId,
    messages: [{ role: 'user', content: f.input.prompt }] });
  const before = f.store.getProject(f.session.id, f.input.projectId).currentVersion;
  assert.equal(f.store.recoverRunning(), 1); assert.equal(f.store.recoverRunning(), 0);
  const recovered = f.store.generationState(f.session.id, f.input.projectId, f.input.requestId);
  assert.equal(recovered.run.id, run.id); assert.equal(recovered.run.status, 'interrupted'); assert.equal(recovered.run.errorCode, 'PROCESS_RESTARTED');
  assert.deepEqual(f.store.getProject(f.session.id, f.input.projectId).currentVersion, before);
  assert.equal(f.store.listMessages(f.session.id, f.input.projectId, 0, 20).items.length, 1);
  f.store.createRun({ projectId: f.input.projectId, requestId: randomUUID(), baseVersionId: f.input.baseVersionId });
  const sql = new Database(f.filename); sql.exec("CREATE TRIGGER recover_failure BEFORE UPDATE ON generation_runs BEGIN SELECT RAISE(ABORT,'PRIVATE_DB_SENTINEL'); END");
  assert.throws(() => f.store.recoverRunning(), error => error instanceof ProjectError && error.code === 'STORAGE_UNAVAILABLE'); sql.close();
});
