import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { snapshotDigest, snapshotSchema, versionReviewSchema } from '@atoms/contracts';
import { buildApp } from '../src/app.js';
import { openStore } from '../src/storage/store.js';
import { changedSnapshot, projectFixture } from './helpers/projects.js';
import { fixtureEnv, startFixture } from './helpers/model-fixture.js';
const origin = 'http://127.0.0.1:5173';
async function fixture(t: TestContext) {
  const f = await projectFixture(t); const owner = f.store.createSession(); const foreign = f.store.createSession();
  const project = f.store.createProject(owner.id, 'Candidate fixture', f.bundle);
  function candidate() {
    const run = f.store.createRun({ projectId: project.project.id, requestId: randomUUID(), baseVersionId: project.currentVersion.id });
    return f.store.saveCandidate({ projectId: project.project.id, runId: run.id, snapshot: changedSnapshot(f.bundle) });
  }
  const first = candidate(); const second = candidate();
  const app = buildApp({ logger: false }, { store: f.store, catalog: f.catalog, origins: [origin], secureCookies: false });
  t.after(() => app.close()); const path = `/api/projects/${project.project.id}/versions/`;
  const headers = { origin, 'content-type': 'application/json', cookie: `atoms_session=${owner.token}` };
  const adopt = (id: string, expectedCurrentVersionId = project.currentVersion.id) => app.inject({ method: 'POST', url: path + id + '/adopt', headers, payload: { expectedCurrentVersionId } });
  return { ...f, owner, foreign, project, first, second, candidate, app, path, headers, adopt };
}
test('shared snapshot schema/digest agrees with Node SHA-256 and rejects malformed or changed snapshots', async t => {
  const f = await fixture(t); const { digest, ...content } = f.bundle;
  const { canonicalJSON } = await import('../src/template-assets/bundle.mjs');
  assert.equal(snapshotDigest(content), createHash('sha256').update(canonicalJSON(content)).digest('hex')); assert.equal(snapshotDigest(content), digest);
  assert.equal(snapshotSchema.safeParse({ ...f.bundle, files: { ...f.bundle.files, [f.bundle.entry]: 'changed without digest' } }).success, false);
  assert.equal(snapshotSchema.safeParse({ ...f.bundle, ownerSessionId: f.owner.id }).success, false);
});
test('version GET returns immutable stored snapshots, sources and actual paths without changing current', async t => {
  const f = await fixture(t);
  const value = await f.app.inject({ method: 'GET', url: f.path + f.first.version.id, headers: f.headers });
  assert.equal(value.statusCode, 200); assert.equal(value.headers['cache-control'], 'no-store');
  const review = versionReviewSchema.parse(value.json()); assert.deepEqual(review.version, f.first.version);
  assert.equal(review.successfulRun?.id, f.first.run.id); assert.equal(review.adoptionAvailability, 'eligible');
  assert.deepEqual(review.changedFiles, [f.bundle.entry]); assert.ok(!value.body.includes('ownerSessionId')); assert.ok(!value.body.includes(f.owner.token));
  const original = await f.app.inject({ method: 'GET', url: f.path + f.project.currentVersion.id, headers: f.headers });
  assert.equal(versionReviewSchema.parse(original.json()).adoptionAvailability, 'not-candidate');
  assert.deepEqual(versionReviewSchema.parse(original.json()).version.snapshot, f.bundle);
  assert.equal(f.store.getProject(f.owner.id, f.project.project.id).currentVersion.id, f.project.currentVersion.id);
});
test('version endpoints validate sessions/UUID/JSON/Origin and cross-project misses are indistinguishable', async t => {
  const f = await fixture(t); const other = f.store.createProject(f.owner.id, 'same owner other project', f.bundle);
  for (const method of ['GET', 'POST'] as const) {
    const suffix = method === 'POST' ? '/adopt' : ''; const payload = method === 'POST' ? { expectedCurrentVersionId: f.project.currentVersion.id } : undefined;
    const send = (versionId: string, headers = f.headers) => f.app.inject({ method, url: f.path + versionId + suffix, headers, ...(payload ? { payload } : {}) });
    assert.equal((await send(f.first.version.id, { ...f.headers, cookie: '' })).statusCode, 401);
    const denied = await send(f.first.version.id, { ...f.headers, cookie: `atoms_session=${f.foreign.token}` });
    assert.equal(denied.statusCode, 404); assert.deepEqual(denied.json().error, (await send(randomUUID())).json().error);
    assert.equal((await send(other.currentVersion.id)).statusCode, 404); assert.equal((await send('not-an-id')).statusCode, 400);
  }
  for (const [headers, body, expected] of [
    [{ ...f.headers, origin: 'http://foreign.invalid' }, { expectedCurrentVersionId: f.project.currentVersion.id }, 403],
    [f.headers, { expectedCurrentVersionId: f.project.currentVersion.id, verified: true }, 400],
    [f.headers, { expectedCurrentVersionId: f.project.currentVersion.id, files: 'x'.repeat(1200) }, 413],
    [{ ...f.headers, 'content-type': 'text/plain' }, {}, 415],
  ] as const) assert.equal((await f.app.inject({ method: 'POST', url: f.path + f.first.version.id + '/adopt', headers, payload: JSON.stringify(body) })).statusCode, expected);
  assert.equal(f.store.getProject(f.owner.id, f.project.project.id).currentVersion.id, f.project.currentVersion.id);
});
test('same-parent competing candidates use CAS, target retries are idempotent and reopen preserves exact code', async t => {
  const f = await fixture(t); const results = await Promise.all([f.adopt(f.first.version.id), f.adopt(f.second.version.id)]);
  assert.deepEqual(results.map(item => item.statusCode).sort(), [200, 409]);
  const target = f.store.getProject(f.owner.id, f.project.project.id).currentVersion;
  assert.ok([f.first.version.id, f.second.version.id].includes(target.id)); const before = f.store.getProject(f.owner.id, f.project.project.id);
  assert.equal((await f.adopt(target.id)).json().alreadyCurrent, true);
  assert.deepEqual(f.store.getProject(f.owner.id, f.project.project.id), before);
  const losing = target.id === f.first.version.id ? f.second.version.id : f.first.version.id;
  assert.equal((await f.adopt(losing)).json().error.code, 'CURRENT_VERSION_CONFLICT');
  assert.equal(versionReviewSchema.parse((await f.app.inject({ method: 'GET', url: f.path + losing, headers: f.headers })).json()).adoptionAvailability, 'stale');
  await f.app.close(); const store = openStore(f.filename); t.after(() => store.close());
  assert.deepEqual(store.getProject(f.owner.id, f.project.project.id).currentVersion, target);
  assert.deepEqual(store.versionReview(f.owner.id, f.project.project.id, f.project.currentVersion.id, () => null).version.snapshot, f.bundle);
});
test('adoption requires success association, exact parent, and never restores arbitrary old versions', async t => {
  const f = await fixture(t);
  assert.equal((await f.adopt(f.project.currentVersion.id)).json().error.code, 'CANDIDATE_NOT_ADOPTABLE');
  assert.equal((await f.adopt(f.first.version.id, randomUUID())).json().error.code, 'CANDIDATE_NOT_ADOPTABLE');
  const sql = new Database(f.filename);
  sql.prepare("UPDATE generation_runs SET status='failed',result_version_id=NULL,error_code='MODEL_ERROR' WHERE id=?").run(f.first.run.id); sql.close();
  assert.equal((await f.adopt(f.first.version.id)).json().error.code, 'CANDIDATE_NOT_ADOPTABLE');
  assert.equal(versionReviewSchema.parse((await f.app.inject({ method: 'GET', url: f.path + f.first.version.id, headers: f.headers })).json()).adoptionAvailability, 'not-candidate');
});
test('isolated running blocks adoption, but retry of an already-current valid target does not write', async t => {
  const f = await fixture(t);
  const orphan = f.store.createRun({ projectId: f.project.project.id, requestId: randomUUID(), baseVersionId: f.project.currentVersion.id });
  assert.equal((await f.adopt(f.first.version.id)).json().error.code, 'RUN_STATE_UNCONFIRMED');
  assert.equal(versionReviewSchema.parse((await f.app.inject({ method: 'GET', url: f.path + f.first.version.id, headers: f.headers })).json()).adoptionAvailability, 'unconfirmed');
  f.store.finishRun({ projectId: f.project.project.id, runId: orphan.id, status: 'interrupted', errorCode: 'PROCESS_RESTARTED' });
  assert.equal((await f.adopt(f.first.version.id)).statusCode, 200);
  const pending = f.store.createRun({ projectId: f.project.project.id, requestId: randomUUID(), baseVersionId: f.first.version.id });
  const before = f.store.getProject(f.owner.id, f.project.project.id);
  assert.equal((await f.adopt(f.first.version.id)).json().alreadyCurrent, true); assert.deepEqual(f.store.getProject(f.owner.id, f.project.project.id), before);
  assert.equal(pending.status, 'running');
});
test('real active generation refuses adoption and abort cleanup permits adopting the saved candidate', async t => {
  const f = await fixture(t); await f.app.ready(); await f.app.close(); const store = openStore(f.filename);
  const upstream = await startFixture(() => {});
  const app = buildApp({ logger: false, forceCloseConnections: true }, { store, catalog: f.catalog, origins: [origin], secureCookies: false, generation: { env: fixtureEnv, transport: upstream.transport } });
  const base = await app.listen({ host: '127.0.0.1', port: 0 }); const controller = new AbortController();
  try {
    const response = await fetch(base + `/api/projects/${f.project.project.id}/generations`, { method: 'POST', signal: controller.signal,
      headers: { ...f.headers, accept: 'text/event-stream' }, body: JSON.stringify({ requestId: randomUUID(), baseVersionId: f.project.currentVersion.id, prompt: 'EXPLICIT BUSY FIXTURE' }) });
    const reader = response.body?.getReader(); assert.ok(reader); await reader.read();
    for (let i = 0; i < 100 && upstream.requests.length === 0; i++) await delay(10);
    assert.equal(upstream.requests.length, 1);
    const blocked = await app.inject({ method: 'POST', url: f.path + f.first.version.id + '/adopt', headers: f.headers, payload: { expectedCurrentVersionId: f.project.currentVersion.id } });
    assert.equal(blocked.statusCode, 409); assert.equal(blocked.json().error.code, 'PROJECT_BUSY'); controller.abort(); await reader.cancel().catch(() => {});
    for (let i = 0; i < 100 && store.hasRunning(f.project.project.id); i++) await delay(10);
    assert.equal(store.hasRunning(f.project.project.id), false);
    assert.equal((await app.inject({ method: 'POST', url: f.path + f.first.version.id + '/adopt', headers: f.headers, payload: { expectedCurrentVersionId: f.project.currentVersion.id } })).statusCode, 200);
  } finally { controller.abort(); await upstream.close(); await app.close(); }
});
test('adoption storage failure rolls back pointer; corrupt snapshots are safe 500, never substituted', async t => {
  const f = await fixture(t); const sql = new Database(f.filename);
  sql.exec("CREATE TRIGGER reject_adoption BEFORE UPDATE OF current_version_id ON projects BEGIN SELECT RAISE(ABORT,'PRIVATE_ADOPTION_SENTINEL'); END");
  const failure = await f.adopt(f.first.version.id); assert.equal(failure.statusCode, 503); assert.ok(!failure.body.includes('PRIVATE_ADOPTION_SENTINEL'));
  assert.deepEqual(f.store.getProject(f.owner.id, f.project.project.id).currentVersion, f.project.currentVersion);
  sql.exec('DROP TRIGGER reject_adoption; DROP TRIGGER versions_immutable');
  sql.prepare('UPDATE versions SET snapshot_json=? WHERE id=?').run('{"PRIVATE_CODE_SENTINEL":true}', f.first.version.id); sql.close();
  const corrupt = await f.app.inject({ method: 'GET', url: f.path + f.first.version.id, headers: f.headers });
  assert.equal(corrupt.statusCode, 500); assert.ok(!corrupt.body.includes('PRIVATE_CODE_SENTINEL')); assert.equal(failure.headers['cache-control'], 'no-store');
});

test('historical version reads do not consult current catalog and sensitive errors never enter logs', async t => {
  const f = await projectFixture(t); const owner = f.store.createSession();
  const project = f.store.createProject(owner.id, 'Historical fixture', f.bundle);
  const run = f.store.createRun({ projectId: project.project.id, requestId: randomUUID(), baseVersionId: project.currentVersion.id });
  const candidate = f.store.saveCandidate({ projectId: project.project.id, runId: run.id, snapshot: changedSnapshot(f.bundle) });
  let logs = '';
  const catalog = { list: () => { throw new Error('UNEXPECTED_CATALOG_READ'); }, resolve: () => { throw new Error('UNEXPECTED_CATALOG_READ'); } };
  const app = buildApp({ logger: { stream: { write: (text: string) => { logs += text; } } } }, { store: f.store, catalog, origins: [origin], secureCookies: false });
  t.after(() => app.close()); const url = `/api/projects/${project.project.id}/versions/${candidate.version.id}`;
  const headers = { cookie: `atoms_session=${owner.token}` };
  assert.equal((await app.inject({ url, headers })).statusCode, 200);
  const sql = new Database(f.filename); sql.exec('DROP TRIGGER versions_immutable');
  sql.prepare('UPDATE versions SET snapshot_json=? WHERE id=?').run('{"PRIVATE_CANDIDATE_SOURCE_SENTINEL":true}', candidate.version.id); sql.close();
  await app.inject({ url: url + '?PRIVATE_QUERY_SENTINEL', headers });
  const result = await app.inject({ url, headers }); assert.equal(result.statusCode, 500);
  for (const secret of [owner.token, f.filename, 'PRIVATE_CANDIDATE_SOURCE_SENTINEL', 'PRIVATE_QUERY_SENTINEL', 'SELECT ', 'snapshot_json']) {
    assert.ok(!`${result.body}${logs}`.includes(secret));
  }
  assert.deepEqual(f.store.getProject(owner.id, project.project.id).currentVersion.snapshot, f.bundle);
});
