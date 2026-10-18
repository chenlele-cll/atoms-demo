import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { generationEventSchema, projectDetailSchema, restoreRequestSchema, restoreResponseSchema,
  snapshotSchema, versionReviewSchema } from '@atoms/contracts';
import { buildApp } from '../src/app.js';
import { GenerationManager } from '../src/generation/manager.js';
import { ProjectError } from '../src/projects/errors.js';
import { openStore } from '../src/storage/store.js';
import { createCatalog } from '../src/templates/catalog.js';
import { changedSnapshot } from './helpers/projects.js';
import { successfulGeneration } from './helpers/generation.js';
import { fixtureEnv, startFixture } from './helpers/model-fixture.js';

const origin = 'http://restoration-fixture.invalid';
const budget = 5000;
async function until(condition: () => boolean, message: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (condition()) return;
    await delay(10);
  }
  assert.fail(message);
}
function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture(t: TestContext, gated = false) {
  const directory = await mkdtemp(join(tmpdir(), 'atoms restoration network '));
  const filename = join(directory, 'fixture.sqlite');
  let store = openStore(filename);
  const bundle = snapshotSchema.parse(JSON.parse(await readFile(
    new URL('../src/template-assets/company-landing.bundle.json', import.meta.url), 'utf8')) as unknown);
  const catalog = createCatalog([bundle]);
  const session = store.createSession();
  const detail = store.createProject(session.id, 'Explicit restoration network fixture', bundle);
  const projectId = detail.project.id;
  const templateId = detail.currentVersion.id;
  const candidate = () => {
    const run = store.createRun({ projectId, requestId: randomUUID(), baseVersionId: templateId,
      messages: [{ role: 'user', content: 'Explicit stored fixture; no model generation claim.' }] });
    return store.saveCandidate({ projectId, runId: run.id, snapshot: changedSnapshot(bundle),
      messages: [{ role: 'assistant', content: 'Stored restoration fixture.' }] }).version;
  };
  const first = candidate(); const second = candidate();
  const gate = deferred();
  const upstream = await startFixture((body, response, index) => {
    void (async () => {
      if (gated) await gate.promise;
      if (!response.destroyed) response.end(JSON.stringify(successfulGeneration(body, index)));
    })();
  });
  const ownership = new AbortController();
  const makeApp = () => buildApp({ logger: false, forceCloseConnections: true }, {
    store, catalog, origins: [origin], secureCookies: false, ownershipSignal: ownership.signal,
    generation: { env: { ...fixtureEnv, MODEL_TIMEOUT_MS: '4000' }, transport: upstream.transport,
      shutdownMs: 500, limits: { postPerMinute: 100, queryPerMinute: 100, cancelPerMinute: 100 } },
  });
  let app = makeApp(); let base = '';
  const headers = { origin, 'content-type': 'application/json', cookie: `atoms_session=${session.token}` };
  const path = `/api/projects/${projectId}`;
  const send = (suffix: string, body?: unknown) => fetch(base + path + suffix, {
    headers, signal: AbortSignal.timeout(budget), ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
  });
  const restore = (target: string, expected = templateId) => send(`/versions/${target}/restore`,
    restoreRequestSchema.parse({ expectedCurrentVersionId: expected }));
  const current = async () => {
    const response = await send(''); assert.equal(response.status, 200);
    return projectDetailSchema.parse(await response.json());
  };
  const history = () => {
    const sql = new Database(filename, { readonly: true });
    try {
      return {
        versions: sql.prepare('SELECT * FROM versions ORDER BY id').all(),
        messages: sql.prepare('SELECT * FROM messages ORDER BY id').all(),
        runs: sql.prepare('SELECT * FROM generation_runs ORDER BY id').all(),
        projects: sql.prepare('SELECT * FROM projects ORDER BY id').all().map(row => {
          const { current_version_id, updated_at, ...rest } = row as Record<string, unknown>;
          void current_version_id; void updated_at; return rest;
        }),
      };
    } finally { sql.close(); }
  };
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true; gate.resolve();
    try { await app.close(); } finally { await upstream.close(); store.close(); }
  };
  t.after(async () => { try { await close(); } finally { await rm(directory, { recursive: true, force: true }); } });
  return { filename, session, projectId, templateId, first, second, upstream, ownership, headers, path,
    get store() { return store; }, get app() { return app; }, get base() { return base; },
    listen: async () => { base = await app.listen({ host: '127.0.0.1', port: 0 }); },
    reopen: async () => {
      await app.close(); store = openStore(filename); app = makeApp();
      base = await app.listen({ host: '127.0.0.1', port: 0 });
    },
    release: gate.resolve, restore, send, current, history, close,
    input: { sessionId: session.id, projectId, baseVersionId: templateId, requestId: randomUUID(),
      prompt: 'Explicit SDK fixture request, no external model.' },
  };
}

async function success(response: Response) {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return restoreResponseSchema.parse(await response.json());
}
async function failure(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json() as { error: { code: string } }).error.code, code);
}

test('same-target network restores commit once and concurrent retries preserve timestamp and history', { timeout: 15000 }, async t => {
  const f = await fixture(t); await f.listen(); const before = f.history();
  const original = await f.current();
  const responses = await Promise.all([f.restore(f.first.id), f.restore(f.first.id)]);
  const results = await Promise.all(responses.map(success));
  assert.deepEqual(results.map(item => item.alreadyCurrent).sort(), [false, true]);
  assert.equal(results[0]?.updatedAt, results[1]?.updatedAt);
  const detail = await f.current(); assert.equal(detail.currentVersion.id, f.first.id);
  assert.notEqual(detail.project.updatedAt, original.project.updatedAt);
  const retry = await success(await f.restore(f.first.id));
  assert.equal(retry.updatedAt, detail.project.updatedAt); assert.equal(retry.alreadyCurrent, true);
  assert.deepEqual(f.history(), before); assert.equal(f.upstream.requests.length, 0);
});

test('different restore targets with one expected current have exactly one network winner', { timeout: 15000 }, async t => {
  const f = await fixture(t); await f.listen(); const before = f.history();
  const responses = await Promise.all([f.restore(f.first.id), f.restore(f.second.id)]);
  assert.deepEqual(responses.map(item => item.status).sort(), [200, 409]);
  const won = responses.find(item => item.status === 200); const lost = responses.find(item => item.status === 409);
  assert.ok(won && lost);
  const winner = await success(won);
  await failure(lost, 409, 'CURRENT_VERSION_CONFLICT');
  assert.equal((await f.current()).currentVersion.id, winner.currentVersionId);
  assert.deepEqual(f.history(), before); assert.equal(f.upstream.requests.length, 0);
});

test('adopt and restore race on the same persisted current CAS', { timeout: 15000 }, async t => {
  const f = await fixture(t); await f.listen(); const before = f.history();
  const responses = await Promise.all([f.restore(f.first.id), f.send(`/versions/${f.second.id}/adopt`,
    { expectedCurrentVersionId: f.templateId })]);
  assert.deepEqual(responses.map(item => item.status).sort(), [200, 409]);
  const won = responses.find(item => item.status === 200); const lost = responses.find(item => item.status === 409);
  assert.ok(won && lost);
  const winner = restoreResponseSchema.parse(await won.json());
  await failure(lost, 409, 'CURRENT_VERSION_CONFLICT');
  assert.equal((await f.current()).currentVersion.id, winner.currentVersionId);
  assert.deepEqual(f.history(), before); assert.equal(f.upstream.requests.length, 0);
});

test('real accepted SSE frame reserves project before gated SDK work and restore stays busy until cancellation releases it', { timeout: 15000 }, async t => {
  const f = await fixture(t, true); await f.listen();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), budget);
  t.after(() => { clearTimeout(timeout); controller.abort(); });
  const response = await fetch(f.base + f.path + '/generations', { method: 'POST', signal: controller.signal,
    headers: { ...f.headers, accept: 'text/event-stream' }, body: JSON.stringify({ requestId: f.input.requestId,
      baseVersionId: f.templateId, prompt: f.input.prompt }) });
  assert.equal(response.status, 200); assert.ok(response.body); const reader = response.body.getReader();
  t.after(async () => { await reader.cancel().catch(() => {}); });
  let frame = '';
  while (!frame.includes('\n\n')) {
    const chunk = await reader.read(); assert.equal(chunk.done, false);
    frame += new TextDecoder().decode(chunk.value);
  }
  const first = frame.split('\n\n')[0]; assert.ok(first);
  const data = first.split('\n').find(line => line.startsWith('data: ')); assert.ok(data);
  assert.equal(generationEventSchema.parse(JSON.parse(data.slice(6)) as unknown).event, 'accepted');
  await until(() => f.upstream.requests.length === 1, 'SDK never reached controlled upstream');
  await failure(await f.restore(f.first.id), 409, 'PROJECT_BUSY');
  const beforeRetry = f.store.getProject(f.session.id, f.projectId);
  assert.equal((await success(await f.restore(f.templateId, randomUUID()))).alreadyCurrent, true);
  assert.deepEqual(f.store.getProject(f.session.id, f.projectId), beforeRetry);
  const cancel = await f.send(`/generations/by-request/${f.input.requestId}/cancel`, {});
  assert.ok([200, 202].includes(cancel.status)); await cancel.json();
  controller.abort(); await reader.cancel().catch(() => {}); f.release();
  await until(() => !f.store.hasRunning(f.projectId), 'Cancellation did not persist terminal state');
  await success(await f.restore(f.first.id));
  assert.equal((await f.current()).currentVersion.id, f.first.id);
});

test('real manager keeps cancelled terminal executor busy until its Map entry is released', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const manager = new GenerationManager(f.store, { env: fixtureEnv, transport: f.upstream.transport, shutdownMs: 500 });
  t.after(() => manager.shutdown());
  const accepted = manager.accept(f.input); assert.ok(accepted.fresh);
  manager.cancel(f.session.id, f.projectId, f.input.requestId);
  const run = f.store.generationState(f.session.id, f.projectId, f.input.requestId).run;
  // Deliberately persist terminal before starting the cancelled executor: the real Map still owns its slot.
  f.store.finishRun({ projectId: f.projectId, runId: run.id, status: 'cancelled', errorCode: 'USER_CANCELLED' });
  assert.equal(f.store.hasRunning(f.projectId), false); assert.equal(manager.activeCount, 1);
  assert.equal(manager.projectActivity(f.projectId), 'busy');
  const activity = () => { manager.assertWritable(); return manager.projectActivity(f.projectId); };
  assert.throws(() => f.store.restoreVersion(f.session.id, f.projectId, f.first.id, f.templateId, activity),
    error => error instanceof ProjectError && error.code === 'PROJECT_BUSY');
  accepted.start();
  await until(() => manager.activeCount === 0, 'Cancelled executor did not release Map entry');
  f.store.restoreVersion(f.session.id, f.projectId, f.first.id, f.templateId, activity);
  assert.equal(f.store.getProject(f.session.id, f.projectId).currentVersion.id, f.first.id);
  assert.equal(f.upstream.requests.length, 0);
});

test('restore committed first rejects old-base generation before acceptance or any model call', { timeout: 15000 }, async t => {
  const f = await fixture(t); await f.listen(); await success(await f.restore(f.first.id));
  const before = f.history();
  const response = await fetch(f.base + f.path + '/generations', { method: 'POST', signal: AbortSignal.timeout(budget),
    headers: { ...f.headers, accept: 'text/event-stream' }, body: JSON.stringify({ requestId: f.input.requestId,
      baseVersionId: f.templateId, prompt: f.input.prompt }) });
  await failure(response, 409, 'BASE_VERSION_CHANGED');
  assert.deepEqual(f.history(), before); assert.equal(f.upstream.requests.length, 0);
});

test('orphan DB running blocks switching while current-target retry remains a no-write operation', { timeout: 15000 }, async t => {
  const f = await fixture(t); await f.listen();
  f.store.createRun({ projectId: f.projectId, requestId: randomUUID(), baseVersionId: f.templateId });
  const before = f.history(); const current = await f.current();
  await failure(await f.restore(f.first.id), 503, 'RUN_STATE_UNCONFIRMED');
  const retry = await success(await f.restore(f.templateId, randomUUID())); assert.equal(retry.alreadyCurrent, true);
  assert.equal(retry.updatedAt, current.project.updatedAt);
  assert.deepEqual(await f.current(), current); assert.deepEqual(f.history(), before);
  assert.equal(f.upstream.requests.length, 0);
});

test('ownership abort rejects real route writes and real manager shutdown rejects writes before and after completion', { timeout: 15000 }, async t => {
  const f = await fixture(t); await f.listen(); const before = await f.current(); const history = f.history();
  f.ownership.abort();
  await failure(await f.restore(f.first.id), 503, 'GENERATION_UNAVAILABLE');
  assert.equal((await success(await f.restore(f.templateId, randomUUID()))).alreadyCurrent, true);
  assert.deepEqual(await f.current(), before); assert.deepEqual(f.history(), history);
  const manager = new GenerationManager(f.store, { env: fixtureEnv });
  manager.assertWritable(); const stopping = manager.shutdown();
  const unavailable = (error: unknown) => error instanceof ProjectError && error.code === 'GENERATION_UNAVAILABLE';
  assert.throws(() => manager.assertWritable(), unavailable);
  assert.throws(() => f.store.restoreVersion(f.session.id, f.projectId, f.first.id, f.templateId,
    () => { manager.assertWritable(); return manager.projectActivity(f.projectId); }), unavailable);
  await stopping; assert.throws(() => manager.assertWritable(), unavailable);
  assert.deepEqual(await f.current(), before); assert.equal(f.upstream.requests.length, 0);
});

test('socket loss after actual commit is confirmed by GET and same-payload retry preserves committed time', { timeout: 15000 }, async t => {
  const f = await fixture(t); let drop = true; let committed: ReturnType<typeof f.store.getProject> | undefined;
  f.app.addHook('onSend', async (request, reply, payload) => {
    if (drop && request.method === 'POST' && request.url.endsWith('/restore') && reply.statusCode === 200) {
      // Capture the committed fact before destroying transport; error-handler behavior cannot prove rollback.
      committed = f.store.getProject(f.session.id, f.projectId); drop = false;
      reply.raw.destroy();
    }
    return payload;
  });
  await f.listen(); const before = f.history();
  await assert.rejects(async () => { const response = await f.restore(f.first.id); await response.json(); });
  assert.ok(committed); assert.equal(committed.currentVersion.id, f.first.id);
  assert.deepEqual(await f.current(), committed);
  const retry = await success(await f.restore(f.first.id));
  assert.equal(retry.alreadyCurrent, true); assert.equal(retry.updatedAt, committed.project.updatedAt);
  assert.deepEqual(f.history(), before); assert.equal(f.upstream.requests.length, 0);
});

test('GET before the last restore body byte sees old current but the pending request can still commit', { timeout: 15000 }, async t => {
  const f = await fixture(t); let entered = false;
  f.app.addHook('onRequest', async request => { if (request.url.endsWith('/restore')) entered = true; });
  await f.listen();
  const body = JSON.stringify({ expectedCurrentVersionId: f.templateId });
  const request = httpRequest(f.base + f.path + `/versions/${f.first.id}/restore`, { method: 'POST',
    headers: { ...f.headers, 'content-length': Buffer.byteLength(body) } });
  request.setTimeout(budget, () => request.destroy(new Error('Delayed body timed out')));
  t.after(() => request.destroy());
  const result = new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
    request.on('error', reject);
    request.on('response', response => {
      let text = ''; response.setTimeout(budget, () => response.destroy(new Error('Response timed out')));
      response.on('data', chunk => { text += String(chunk); }); response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode, body: text }));
    });
  });
  // Attach rejection handling before awaiting other network work.
  void result.catch(() => {});
  request.write(body.slice(0, -1));
  await until(() => entered, 'Restore request never reached server');
  assert.equal((await f.current()).currentVersion.id, f.templateId);
  request.end(body.slice(-1)); const response = await result;
  assert.equal(response.status, 200); assert.equal(restoreResponseSchema.parse(JSON.parse(response.body) as unknown).alreadyCurrent, false);
  assert.equal((await f.current()).currentVersion.id, f.first.id); assert.equal(f.upstream.requests.length, 0);
});

test('application preClose prevents an already-admitted restore body from switching after shutdown starts', { timeout: 15000 }, async t => {
  const f = await fixture(t); let entered = false; let preClosed = false;
  const gate = deferred(); let closing: Promise<void> | undefined;
  f.app.addHook('onRequest', async request => { if (request.url.endsWith('/restore')) entered = true; });
  f.app.addHook('preClose', async () => { preClosed = true; await gate.promise; });
  await f.listen(); const before = f.store.getProject(f.session.id, f.projectId); const history = f.history();
  const body = JSON.stringify({ expectedCurrentVersionId: f.templateId });
  const request = httpRequest(f.base + f.path + `/versions/${f.first.id}/restore`, { method: 'POST',
    headers: { ...f.headers, 'content-length': Buffer.byteLength(body) } });
  request.setTimeout(budget, () => request.destroy(new Error('Shutdown body timed out')));
  const result = new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
    request.on('error', reject);
    request.on('response', response => {
      let text = ''; response.on('data', chunk => { text += String(chunk); });
      response.on('error', reject); response.on('end', () => resolve({ status: response.statusCode, body: text }));
    });
  });
  void result.catch(() => {});
  try {
    request.write(body.slice(0, -1)); await until(() => entered, 'Restore request never entered app');
    closing = f.app.close(); await until(() => preClosed, 'Production preClose hook did not finish');
    request.end(body.slice(-1)); const response = await result;
    assert.equal(response.status, 503);
    const value: unknown = JSON.parse(response.body);
    assert.ok(typeof value === 'object' && value !== null && 'error' in value);
    assert.deepEqual(value.error, { code: 'GENERATION_UNAVAILABLE', message: 'Generation service is unavailable.' });
    assert.deepEqual(f.store.getProject(f.session.id, f.projectId), before);
    assert.deepEqual(f.history(), history); assert.equal(f.upstream.requests.length, 0);
  } finally { request.destroy(); gate.resolve(); await closing; }
});

test('unavailable confirmation never replays POST; later choice defeats old CAS and real reopen preserves all snapshots', { timeout: 15000 }, async t => {
  const f = await fixture(t); let queryUnavailable = false; let posts = 0;
  f.app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'POST' && request.url.endsWith('/restore')) posts++;
    if (queryUnavailable && request.method === 'GET' && request.url === f.path) {
      return reply.header('cache-control', 'no-store').code(503).send({
        error: { code: 'STORAGE_UNAVAILABLE', message: 'Fixture confirmation unavailable.' }, requestId: request.id,
      });
    }
  });
  await f.listen(); const history = f.history();
  await success(await f.restore(f.first.id)); queryUnavailable = true;
  await failure(await f.send(''), 503, 'STORAGE_UNAVAILABLE');
  assert.equal(posts, 1); assert.equal(f.store.getProject(f.session.id, f.projectId).currentVersion.id, f.first.id);
  await success(await f.restore(f.second.id, f.first.id)); queryUnavailable = false;
  assert.equal((await f.current()).currentVersion.id, f.second.id);
  await failure(await f.restore(f.first.id), 409, 'CURRENT_VERSION_CONFLICT'); assert.equal(posts, 3);
  const before = await f.current(); const versions = [];
  for (const id of [f.templateId, f.first.id, f.second.id]) {
    const response = await f.send(`/versions/${id}`); assert.equal(response.status, 200);
    versions.push(versionReviewSchema.parse(await response.json()).version);
  }
  assert.deepEqual(f.history(), history); assert.equal(f.upstream.requests.length, 0);
  // Close the owned listening app and its SQLite handle, then really listen again with the same DB and cookie.
  await f.reopen(); assert.deepEqual(await f.current(), before);
  for (const version of versions) {
    const response = await f.send(`/versions/${version.id}`); assert.equal(response.status, 200);
    assert.deepEqual(versionReviewSchema.parse(await response.json()).version, version);
  }
  assert.deepEqual(f.history(), history); assert.equal(f.upstream.requests.length, 0);
});
