import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, readFile, symlink, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { buildApp } from '../src/app.js';
import { acquireOwnership } from '../src/storage/ownership.js';
import { openStore } from '../src/storage/store.js';
import { loadCatalog } from '../src/templates/catalog.js';
import { generationStatusSchema } from '../src/contracts/generations.js';
import { generationFixture } from './helpers/generation.js';
import { changedSnapshot } from './helpers/projects.js';
import { fixtureEnv, startFixture } from './helpers/model-fixture.js';
import { randomUUID } from 'node:crypto';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
let temporary = ''; let compiled = '';
before(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'atoms generation lifecycle '));
  compiled = await mkdtemp(join(root, 'backend/node_modules/.generation-stream-build-'));
  const compiler = spawn(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(root, 'backend/tsconfig.build.json'), '--outDir', compiled]);
  assert.equal(await new Promise<number | null>(r => compiler.once('close', r)), 0);
  await cp(join(root, 'backend/src/template-assets'), join(compiled, 'template-assets'), { recursive: true });
});
after(async () => { await rm(temporary, { recursive: true, force: true }); await rm(compiled, { recursive: true, force: true }); });
function launch(database: string, upstream: string) {
  const child = spawn(process.execPath, [join(root, 'scripts/generation-stream-server.mjs'), compiled, database, '0', upstream],
    { cwd: temporary, env: { PATH: process.env['PATH'] ?? '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; let address = '';
  child.stdout.on('data', (bytes: Buffer) => { output += bytes.toString(); const match = output.match(/"address":"(http:\/\/127\.0\.0\.1:\d+)"/); address = match?.[1] ?? ''; });
  child.stderr.on('data', (bytes: Buffer) => { output += bytes.toString(); });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 12_000);
  const finished = new Promise<number | null>((r, reject) => { child.once('error', reject); child.once('close', code => { clearTimeout(timeout); r(code); }); });
  const ready = async () => { for (let i = 0; i < 150; i++) {
    if (address) return address; if (child.exitCode !== null || child.signalCode !== null) throw new Error(output);
    await delay(10);
  } throw new Error('Fixture readiness timed out'); };
  return { child, finished, ready, stop: async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await finished; } };
}
const query = (projectId: string, requestId: string) => `/api/projects/${projectId}/generations/by-request/${requestId}`;

test('canonical service ownership preserves files, refuses same-db competitor and allows independent database', async t => {
  const directory = join(temporary, 'ownership'); await mkdir(directory);
  const database = join(directory, 'preserve.sqlite');
  const store = openStore(database); store.createSession(); store.close(); const before = await readFile(database);
  const first = launch(database, 'http://127.0.0.1:1'); t.after(first.stop); await first.ready();
  const alias = join(directory, 'alias.sqlite'); await symlink(database, alias);
  const second = launch(alias, 'http://127.0.0.1:1'); assert.equal(await second.finished, 1);
  const third = launch(join(directory, 'independent.sqlite'), 'http://127.0.0.1:1'); t.after(third.stop); await third.ready();
  assert.equal(first.child.exitCode, null);
  await first.stop(); await third.stop(); assert.deepEqual(await readFile(database), before);
  const ownership = await acquireOwnership(database, () => assert.fail('unexpected compromise')); await ownership.release();
});

test('SIGTERM with active SSE aborts upstream and exits within shutdown budget, retained run is queryable after restart', async t => {
  const f = await generationFixture(t);
  const upstream = await startFixture(() => {}); t.after(upstream.close);
  f.store.close();
  const first = launch(f.filename, upstream.origin); t.after(first.stop); const address = await first.ready();
  const headers = { origin: 'http://127.0.0.1:5173', cookie: `atoms_session=${f.session.token}`, accept: 'text/event-stream', 'content-type': 'application/json' };
  const response = await fetch(address + `/api/projects/${f.input.projectId}/generations`, { method: 'POST', headers,
    body: JSON.stringify({ requestId: f.input.requestId, baseVersionId: f.input.baseVersionId, prompt: f.input.prompt }) });
  const reader = response.body?.getReader(); assert.ok(reader); assert.match(new TextDecoder().decode((await reader.read()).value), /accepted/);
  for (let i = 0; i < 100 && !upstream.requests.length; i++) await delay(10);
  assert.equal(upstream.requests.length, 1);
  const started = performance.now(); first.child.kill('SIGTERM'); assert.equal(await first.finished, 0);
  assert.ok(performance.now() - started < 5500); await reader.cancel().catch(() => {});
  for (let i = 0; i < 100 && !upstream.aborted(); i++) await delay(10); assert.equal(upstream.aborted(), 1);
  const second = launch(f.filename, upstream.origin); t.after(second.stop); const restarted = await second.ready();
  const state = generationStatusSchema.parse(await (await fetch(restarted + query(f.input.projectId, f.input.requestId), { headers })).json());
  assert.equal(state.status, 'cancelled'); assert.equal(state.errorCode, 'SERVER_SHUTDOWN'); assert.equal(upstream.requests.length, 1);
  await second.stop();
});

test('actual SIGKILL respects 30-second stale ownership then recovers running without changing prior success/current/messages', { timeout: 45_000 }, async t => {
  const f = await generationFixture(t);
  const upstream = await startFixture(() => {}); t.after(upstream.close);
  const previous = f.store.createRun({ projectId: f.input.projectId, requestId: randomUUID(), baseVersionId: f.input.baseVersionId });
  const saved = f.store.saveCandidate({ projectId: f.input.projectId, runId: previous.id, snapshot: changedSnapshot(f.bundle) });
  f.store.close();
  const first = launch(f.filename, upstream.origin); t.after(first.stop); const firstAddress = await first.ready();
  const responseStream = await fetch(firstAddress + `/api/projects/${f.input.projectId}/generations`, { method: 'POST',
    headers: { origin: 'http://127.0.0.1:5173', cookie: `atoms_session=${f.session.token}`, accept: 'text/event-stream', 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: f.input.requestId, baseVersionId: f.input.baseVersionId, prompt: f.input.prompt }) });
  const streamReader = responseStream.body?.getReader(); assert.ok(streamReader); await streamReader.read();
  for (let i = 0; i < 100 && !upstream.requests.length; i++) await delay(10); assert.equal(upstream.requests.length, 1);
  const writer = openStore(f.filename);
  const messages = writer.listMessages(f.session.id, f.input.projectId, 0, 20); const current = writer.getProject(f.session.id, f.input.projectId).currentVersion;
  writer.close(); first.child.kill('SIGKILL'); await first.finished; await streamReader.cancel().catch(() => {});
  const immediate = launch(f.filename, upstream.origin); assert.equal(await immediate.finished, 1);
  await delay(31_100); // Use the library's actual stale rule; never remove its lock by hand.
  const restarted = launch(f.filename, upstream.origin); t.after(restarted.stop); const address = await restarted.ready();
  const response = await fetch(address + query(f.input.projectId, f.input.requestId), { headers: { cookie: `atoms_session=${f.session.token}` } });
  const state = generationStatusSchema.parse(await response.json()); assert.equal(state.status, 'interrupted'); assert.equal(state.errorCode, 'PROCESS_RESTARTED');
  assert.equal(upstream.requests.length, 1); await restarted.stop();
  const reader = openStore(f.filename); try {
    assert.deepEqual(reader.getProject(f.session.id, f.input.projectId).currentVersion, current);
    assert.deepEqual(reader.listMessages(f.session.id, f.input.projectId, 0, 20), messages);
    assert.deepEqual(reader.generationState(f.session.id, f.input.projectId, previous.requestId).candidateVersion, saved.version);
  } finally { reader.close(); }
});

test('recovery failure prevents listen and releases acquired ownership for a corrected restart', async t => {
  const f = await generationFixture(t);
  f.store.createRun({ projectId: f.input.projectId, requestId: f.input.requestId, baseVersionId: f.input.baseVersionId }); f.store.close();
  const sql = new Database(f.filename); sql.exec("CREATE TRIGGER reject_recovery BEFORE UPDATE ON generation_runs BEGIN SELECT RAISE(ABORT,'PRIVATE_TRIGGER'); END"); sql.close();
  const first = launch(f.filename, 'http://127.0.0.1:1'); assert.equal(await first.finished, 1);
  const owner = await acquireOwnership(f.filename, () => {}); await owner.release();
  const repair = new Database(f.filename); repair.exec('DROP TRIGGER reject_recovery'); repair.close();
  const second = launch(f.filename, 'http://127.0.0.1:1'); t.after(second.stop); await second.ready(); await second.stop();
});

test('ownership compromise revokes writes, bounded close releases even when store.close fails', async t => {
  const f = await generationFixture(t); const lost = new AbortController();
  let released = false; const upstream = await startFixture(() => {});
  const app = buildApp({ logger: false }, { store: f.store, catalog: await loadCatalog(), origins: ['http://127.0.0.1:5173'], secureCookies: false,
    ownershipSignal: lost.signal, releaseOwnership: async () => { released = true; }, generation: { env: fixtureEnv, transport: upstream.transport } });
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  const response = await fetch(base + `/api/projects/${f.input.projectId}/generations`, { method: 'POST',
    headers: { origin: 'http://127.0.0.1:5173', 'content-type': 'application/json', accept: 'text/event-stream', cookie: `atoms_session=${f.session.token}` },
    body: JSON.stringify({ requestId: f.input.requestId, baseVersionId: f.input.baseVersionId, prompt: f.input.prompt }) });
  const reader = response.body?.getReader(); assert.ok(reader); await reader.read();
  lost.abort(); await app.close(); await reader.cancel().catch(() => {}); await upstream.close(); assert.equal(released, true);
  assert.equal(f.store.close(), undefined);
  const readerStore = openStore(f.filename); assert.equal(readerStore.generationState(f.session.id, f.input.projectId, f.input.requestId).run.status, 'running');
  readerStore.recoverRunning(); readerStore.close();
  const store = openStore(f.filename); let releasedOnError = false;
  const failing = buildApp({ logger: false }, { store, catalog: f.catalog, origins: [], secureCookies: false, releaseOwnership: async () => { releasedOnError = true; } });
  await failing.ready(); const close = store.close.bind(store);
  const mock = t.mock.method(store, 'close', () => { close(); throw new Error('PRIVATE_CLOSE_FAILURE'); });
  await assert.rejects(failing.close()); assert.equal(releasedOnError, true); mock.mock.restore();
});

test('proper-lockfile detects a changed mtime without deleting an unknown replacement lock', async () => {
  const filename = join(temporary, 'compromise.sqlite'); let compromised = false;
  const owner = await acquireOwnership(filename, () => { compromised = true; });
  await utimes(`${filename}.generation.lock`, new Date(1), new Date(1));
  for (let i = 0; i < 560 && !compromised; i++) await delay(10);
  assert.equal(compromised, true); await owner.release();
  // Test owns this invalidated lock directory; production only ever uses the returned release.
  await rm(`${filename}.generation.lock`, { recursive: true });
});
