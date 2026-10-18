import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import Database from 'better-sqlite3';
import Fastify from 'fastify';
import { errorSchema, restoreRequestSchema, restoreResponseSchema, sessionRequestSchema,
  snapshotDigest, snapshotSchema, versionParamsSchema } from '@atoms/contracts';
import type { Restoration, Snapshot } from '@atoms/contracts';
import { buildApp } from '../src/app.js';
import { openStore } from '../src/storage/store.js';
import { versionRoutes } from '../src/routes/versions.js';
import { changedSnapshot, projectFixture } from './helpers/projects.js';

const origin = 'http://127.0.0.1:5173';
const idle = () => null;

async function fixture(t: TestContext) {
  const f = await projectFixture(t);
  const owner = f.store.createSession();
  const foreign = f.store.createSession();
  const project = f.store.createProject(owner.id, 'Restoration fixture', f.bundle);
  const projectId = project.project.id;
  const templateId = project.currentVersion.id;
  let logs = '';
  let modelCalls = 0;
  const ownership = new AbortController();
  const catalog = {
    list: () => { throw new Error('UNEXPECTED_RESTORATION_CATALOG_READ'); },
    resolve: () => { throw new Error('UNEXPECTED_RESTORATION_CATALOG_READ'); },
  };
  const app = buildApp({ logger: { stream: { write: (text: string) => { logs += text; } } } }, {
    store: f.store, catalog, origins: [origin], secureCookies: false, ownershipSignal: ownership.signal,
    generation: { env: {}, transport: async () => { modelCalls++; throw new Error('Unexpected restoration model call'); } },
  });
  t.after(() => app.close());
  const sql = new Database(f.filename);
  t.after(() => sql.close());
  const headers = { origin, 'content-type': 'application/json', cookie: `atoms_session=${owner.token}` };
  const path = `/api/projects/${projectId}/versions/`;
  function candidate(baseVersionId = templateId, input = changedSnapshot(f.bundle)) {
    const run = f.store.createRun({ projectId, requestId: randomUUID(), baseVersionId,
      messages: [{ role: 'user', content: 'PRIVATE_RESTORATION_PROMPT' }] });
    return f.store.saveCandidate({ projectId, runId: run.id, snapshot: input,
      messages: [{ role: 'assistant', content: 'Explicit fixture candidate; preview unverified.' }] });
  }
  const restore = (versionId: string, expected = templateId, activity: () => 'busy' | 'unconfirmed' | null = idle,
    now: () => number = Date.now) => f.store.restoreVersion(owner.id, projectId, versionId, expected, activity, now);
  const post = (versionId: string, expectedCurrentVersionId = templateId) => app.inject({
    method: 'POST', url: path + versionId + '/restore', headers, payload: { expectedCurrentVersionId },
  });
  return { ...f, owner, foreign, project, projectId, templateId, app, sql, headers, path, ownership,
    candidate, restore, post, logs: () => logs, modelCalls: () => modelCalls };
}

function databaseRows(sql: Database.Database) {
  return Object.fromEntries(['sessions', 'projects', 'versions', 'messages', 'generation_runs'].map(table =>
    [table, sql.prepare(`SELECT * FROM ${table} ORDER BY id`).all()])) as Record<string, Record<string, unknown>[]>;
}

function assertOnlySelectionChanged(before: ReturnType<typeof databaseRows>, after: ReturnType<typeof databaseRows>,
  projectId: string, result: Restoration) {
  const expected = structuredClone(before);
  const row = expected.projects?.find(value => value.id === projectId);
  assert.ok(row);
  assert.notEqual(row.current_version_id, result.currentVersionId);
  assert.ok(Date.parse(result.updatedAt) > Date.parse(String(row.updated_at)));
  row.current_version_id = result.currentVersionId;
  row.updated_at = result.updatedAt;
  assert.deepEqual(after, expected);
}

function assertError(response: { statusCode: number; headers: Record<string, unknown>; body: string; json: () => unknown },
  status: number, code?: string) {
  assert.equal(response.statusCode, status, response.body);
  assert.equal(response.headers['cache-control'], 'no-store');
  const value = errorSchema.parse(response.json());
  assert.deepEqual(Object.keys(response.json() as object).sort(), ['error', 'requestId']);
  assert.deepEqual(Object.keys(value.error).sort(), ['code', 'message']);
  assert.ok(value.requestId.length > 0);
  if (code) assert.equal(value.error.code, code);
  return value.error;
}

test('restoration contracts enforce strict UUID input and project only the independent public DTO', () => {
  const projectId = randomUUID();
  const versionId = randomUUID();
  assert.deepEqual(restoreRequestSchema.parse({ expectedCurrentVersionId: versionId }), { expectedCurrentVersionId: versionId });
  for (const input of [{}, null, [], { expectedCurrentVersionId: null }, { expectedCurrentVersionId: 'invalid' },
    ...['files', 'compiled', 'verified', 'runId', 'snapshot', 'target'].map(key => ({ expectedCurrentVersionId: versionId, [key]: true }))]) {
    assert.equal(restoreRequestSchema.safeParse(input).success, false);
  }
  assert.deepEqual(versionParamsSchema.parse({ projectId, versionId }), { projectId, versionId });
  for (const input of [{ projectId: 'invalid', versionId }, { projectId, versionId: 'invalid' }, { projectId, versionId, extra: true }]) {
    assert.equal(versionParamsSchema.safeParse(input).success, false);
  }
  assert.deepEqual(sessionRequestSchema.parse({}), {});
  assert.equal(sessionRequestSchema.safeParse({ extra: 'query' }).success, false);
  const value: Restoration = { projectId, currentVersionId: versionId, updatedAt: '2026-01-01T00:00:00.000Z', alreadyCurrent: false };
  assert.deepEqual(restoreResponseSchema.parse({ ...value, snapshot: 'PRIVATE_CODE', ownerSessionId: 'PRIVATE_OWNER' }), value);
  for (const change of [{ projectId: 'invalid' }, { currentVersionId: 'invalid' }, { updatedAt: '2026-01-01T00:00:00Z' },
    { alreadyCurrent: 'true' }]) assert.equal(restoreResponseSchema.safeParse({ ...value, ...change }).success, false);
});

test('version routes do not register restoration without a real generation manager', async t => {
  const f = await fixture(t);
  const app = Fastify({ logger: false }); t.after(() => app.close());
  assert.throws(() => Reflect.apply(versionRoutes, undefined, [app, f.store, undefined, () => f.owner.id]),
    { code: 'GENERATION_UNAVAILABLE' });
  assert.equal((await app.inject({ method: 'POST', url: `/projects/${f.projectId}/versions/${f.templateId}/restore`,
    payload: { expectedCurrentVersionId: f.templateId } })).statusCode, 404);
});

test('restore accepts templates, ancestors and never-adopted branches whose parent differs from expected', async t => {
  const f = await fixture(t);
  const ancestor = f.candidate();
  const child = f.candidate(ancestor.version.id);
  const sibling = f.candidate();
  for (const [target, expected] of [[child.version.id, f.templateId], [ancestor.version.id, child.version.id],
    [sibling.version.id, ancestor.version.id], [f.templateId, sibling.version.id]]) {
    assert.ok(target && expected);
    const before = databaseRows(f.sql);
    const result = restoreResponseSchema.parse(f.restore(target, expected));
    assert.equal(result.alreadyCurrent, false);
    assert.equal(result.currentVersionId, target);
    assert.equal(result.projectId, f.projectId);
    assertOnlySelectionChanged(before, databaseRows(f.sql), f.projectId, result);
  }
  assert.equal(f.modelCalls(), 0);
});

test('store revalidates persistent sessions, owner, target membership and all UUID inputs even for retries', async t => {
  const f = await fixture(t);
  const saved = f.candidate();
  const other = f.store.createProject(f.owner.id, 'Other restoration project', f.bundle);
  const before = databaseRows(f.sql);
  for (const [owner, project, version, code] of [
    [randomUUID(), f.projectId, saved.version.id, 'SESSION_REQUIRED'],
    [f.foreign.id, f.projectId, saved.version.id, 'NOT_FOUND'],
    [f.owner.id, randomUUID(), saved.version.id, 'NOT_FOUND'],
    [f.owner.id, f.projectId, randomUUID(), 'NOT_FOUND'],
    [f.owner.id, f.projectId, other.currentVersion.id, 'NOT_FOUND'],
  ] as const) assert.throws(() => f.store.restoreVersion(owner, project, version, f.templateId, idle), { code });
  for (let index = 0; index < 4; index++) {
    const args = [f.owner.id, f.projectId, saved.version.id, f.templateId];
    args[index] = 'not-a-uuid';
    assert.throws(() => Reflect.apply(f.store.restoreVersion, f.store, [...args, idle]), { code: 'INVALID_INPUT' });
  }
  assert.deepEqual(databaseRows(f.sql), before);
  f.restore(saved.version.id);
  f.sql.prepare('UPDATE sessions SET expires_at=created_at+1 WHERE id=?').run(f.owner.id);
  const expired = databaseRows(f.sql);
  assert.throws(() => f.restore(saved.version.id), { code: 'SESSION_REQUIRED' });
  assert.deepEqual(databaseRows(f.sql), expired);
});

test('round trips and real SQLite reopen retain every snapshot, message and run without executing code or a model', async t => {
  const f = await fixture(t);
  const { digest, ...body } = f.bundle;
  void digest;
  const codeKey = `restorationExecution_${randomUUID().replaceAll('-', '')}`;
  const content = { ...body, files: { ...body.files,
    [body.entry]: `globalThis[${JSON.stringify(codeKey)}] = true; throw new Error('PRIVATE_RESTORATION_CODE');` } };
  const executable: Snapshot = snapshotSchema.parse({ ...content, digest: snapshotDigest(content) });
  const first = f.candidate(f.templateId, executable);
  const second = f.candidate(first.version.id);
  for (const [target, expected] of [[first.version.id, f.templateId], [second.version.id, first.version.id],
    [f.templateId, second.version.id], [second.version.id, f.templateId], [first.version.id, second.version.id]]) {
    assert.ok(target && expected);
    const before = databaseRows(f.sql);
    const result = f.restore(target, expected);
    assertOnlySelectionChanged(before, databaseRows(f.sql), f.projectId, result);
  }
  assert.equal(Reflect.get(globalThis, codeKey), undefined);
  assert.equal(f.modelCalls(), 0);
  const beforeReopen = databaseRows(f.sql);
  const detail = f.store.getProject(f.owner.id, f.projectId);
  assert.deepEqual(detail.currentVersion, first.version);
  await f.app.close();
  const reopened = openStore(f.filename);
  try {
    assert.deepEqual(reopened.getProject(f.owner.id, f.projectId), detail);
    for (const version of [f.project.currentVersion, first.version, second.version]) {
      assert.deepEqual(reopened.versionReview(f.owner.id, f.projectId, version.id, idle).version, version);
    }
    assert.deepEqual(databaseRows(f.sql), beforeReopen);
  } finally { reopened.close(); }
});

test('already-current retry precedes stale CAS and activity, retaining the timestamp of subsequent running work', async t => {
  const f = await fixture(t);
  const saved = f.candidate();
  const first = f.restore(saved.version.id);
  f.store.createRun({ projectId: f.projectId, requestId: randomUUID(), baseVersionId: saved.version.id });
  const laterTimestamp = new Date(Date.parse(first.updatedAt) + 1000).toISOString();
  f.sql.prepare('UPDATE projects SET updated_at=? WHERE id=?').run(laterTimestamp, f.projectId);
  const before = databaseRows(f.sql);
  const updatedAt = f.store.getProject(f.owner.id, f.projectId).project.updatedAt;
  assert.notEqual(updatedAt, first.updatedAt);
  let calls = 0;
  const result = f.restore(saved.version.id, randomUUID(), () => { calls++; throw new Error('PRIVATE_ACTIVITY_FAILURE'); });
  assert.deepEqual(result, { projectId: f.projectId, currentVersionId: saved.version.id, updatedAt, alreadyCurrent: true });
  assert.equal(calls, 0);
  assert.deepEqual(databaseRows(f.sql), before);
});

test('same-target requests are idempotent, different targets share CAS and an old request cannot overwrite a later move', async t => {
  const f = await fixture(t);
  const first = f.candidate();
  const second = f.candidate();
  const same = await Promise.all([f.post(first.version.id), f.post(first.version.id)]);
  assert.deepEqual(same.map(response => response.statusCode), [200, 200]);
  assert.deepEqual(same.map(response => restoreResponseSchema.parse(response.json()).alreadyCurrent).sort(), [false, true]);
  assert.equal(same[0]?.json().updatedAt, same[1]?.json().updatedAt);
  f.restore(f.templateId, first.version.id);
  const different = await Promise.all([f.post(first.version.id), f.post(second.version.id)]);
  assert.deepEqual(different.map(response => response.statusCode).sort(), [200, 409]);
  const conflict = different.find(response => response.statusCode === 409);
  assert.ok(conflict);
  assertError(conflict, 409, 'CURRENT_VERSION_CONFLICT');
  const current = f.store.getProject(f.owner.id, f.projectId).project.currentVersionId;
  const other = current === first.version.id ? second.version.id : first.version.id;
  f.restore(other, current);
  const before = databaseRows(f.sql);
  let calls = 0;
  assert.throws(() => f.restore(current, f.templateId, () => { calls++; throw new Error('must not check activity'); }), { code: 'CURRENT_VERSION_CONFLICT' });
  assert.equal(calls, 0);
  assert.deepEqual(databaseRows(f.sql), before);
});

test('actual switches require explicit valid activity and hold an immediate transaction before admission', async t => {
  const f = await fixture(t);
  const saved = f.candidate();
  const before = databaseRows(f.sql);
  for (const [activity, code] of [[() => 'busy' as const, 'PROJECT_BUSY'], [() => 'unconfirmed' as const, 'RUN_STATE_UNCONFIRMED']] as const) {
    assert.throws(() => f.restore(saved.version.id, f.templateId, activity), { code });
  }
  for (const activity of [undefined, null, () => undefined, () => false, () => 'idle', () => Promise.resolve(null),
    () => { throw new Error('PRIVATE_ACTIVITY_FAILURE'); }]) {
    assert.throws(() => Reflect.apply(f.store.restoreVersion, f.store,
      [f.owner.id, f.projectId, saved.version.id, f.templateId, activity]));
    assert.deepEqual(databaseRows(f.sql), before);
  }
  f.sql.pragma('busy_timeout = 0');
  let calls = 0;
  const result = f.restore(saved.version.id, f.templateId, () => {
    calls++;
    assert.throws(() => f.sql.prepare('UPDATE projects SET title=? WHERE id=?').run('must not write', f.projectId), { code: 'SQLITE_BUSY' });
    return null;
  });
  assert.equal(calls, 1);
  assertOnlySelectionChanged(before, databaseRows(f.sql), f.projectId, result);
});

test('every project running row blocks restoration even when latestRun is terminal; unrelated running does not', async t => {
  const f = await fixture(t);
  const saved = f.candidate();
  const pending = f.store.createRun({ projectId: f.projectId, requestId: randomUUID(), baseVersionId: f.templateId });
  const later = f.candidate();
  f.sql.prepare('UPDATE generation_runs SET started_at=?,finished_at=? WHERE id=?')
    .run('2099-01-01T00:00:00.000Z', '2099-01-01T00:00:00.001Z', later.run.id);
  assert.equal(f.store.getProject(f.owner.id, f.projectId).latestRun?.id, later.run.id);
  const before = databaseRows(f.sql);
  assert.throws(() => f.restore(saved.version.id), { code: 'RUN_STATE_UNCONFIRMED' });
  assertError(await f.post(saved.version.id), 503, 'RUN_STATE_UNCONFIRMED');
  assert.deepEqual(databaseRows(f.sql), before);
  f.store.finishRun({ projectId: f.projectId, runId: pending.id, status: 'interrupted', errorCode: 'PROCESS_RESTARTED' });
  const other = f.store.createProject(f.foreign.id, 'Unrelated running fixture', f.bundle);
  f.store.createRun({ projectId: other.project.id, requestId: randomUUID(), baseVersionId: other.currentVersion.id });
  assert.equal(f.restore(saved.version.id).alreadyCurrent, false);
});

test('switch timestamps strictly increase for equal milliseconds and a clock moving backwards', async t => {
  const f = await fixture(t);
  const first = f.candidate();
  const second = f.candidate();
  const old = Date.parse(f.store.getProject(f.owner.id, f.projectId).project.updatedAt);
  const a = f.restore(first.version.id, f.templateId, idle, () => old);
  assert.equal(Date.parse(a.updatedAt), old + 1);
  const b = f.restore(second.version.id, first.version.id, idle, () => old - 60_000);
  assert.equal(Date.parse(b.updatedAt), old + 2);
  const c = f.restore(f.templateId, second.version.id, idle, () => old + 1000);
  assert.equal(Date.parse(c.updatedAt), old + 1000);
});

test('snapshot, digest, ancestry and contradictory or duplicate result corruption fail safely before any retry shortcut', async t => {
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  type Saved = ReturnType<Fixture['candidate']>;
  const mutations: Record<string, (f: Fixture, saved: Saved) => void> = {
    'snapshot schema': (f, saved) => { f.sql.prepare('UPDATE versions SET snapshot_json=? WHERE id=?').run('{"PRIVATE_CORRUPTION_SENTINEL":true}', saved.version.id); },
    'snapshot digest': (f, saved) => { f.sql.prepare('UPDATE versions SET snapshot_json=? WHERE id=?').run(JSON.stringify({ ...saved.version.snapshot, digest: '0'.repeat(64) }), saved.version.id); },
    'missing parent': (f, saved) => { f.sql.prepare('UPDATE versions SET parent_version_id=? WHERE id=?').run(randomUUID(), saved.version.id); },
    'self parent': (f, saved) => { f.sql.prepare('UPDATE versions SET parent_version_id=? WHERE id=?').run(saved.version.id, saved.version.id); },
    'foreign parent': (f, saved) => {
      const other = f.store.createProject(f.foreign.id, 'Foreign parent fixture', f.bundle);
      f.sql.prepare('UPDATE versions SET parent_version_id=? WHERE id=?').run(other.currentVersion.id, saved.version.id);
    },
    'parent identity': (f, saved) => {
      const { digest, ...body } = f.bundle;
      void digest;
      const changed = { ...body, version: body.version + 1 };
      f.sql.prepare('UPDATE versions SET snapshot_json=? WHERE id=?')
        .run(JSON.stringify(snapshotSchema.parse({ ...changed, digest: snapshotDigest(changed) })), saved.version.parentVersionId);
    },
    'run base': (f, saved) => { f.sql.prepare('UPDATE generation_runs SET base_version_id=? WHERE id=?').run(saved.version.id, saved.run.id); },
    'run status': (f, saved) => {
      f.sql.pragma('ignore_check_constraints = ON');
      f.sql.prepare("UPDATE generation_runs SET status='failed',error_code='MODEL_ERROR' WHERE id=?").run(saved.run.id);
    },
    'run terminal fields': (f, saved) => {
      f.sql.pragma('ignore_check_constraints = ON');
      f.sql.prepare('UPDATE generation_runs SET finished_at=NULL WHERE id=?').run(saved.run.id);
    },
    'duplicate result': (f, saved) => {
      f.sql.prepare(`INSERT INTO generation_runs(id,project_id,request_id,base_version_id,result_version_id,status,started_at,finished_at)
        VALUES(?,?,?,?,?,'succeeded',?,?)`).run(randomUUID(), f.projectId, randomUUID(), saved.version.parentVersionId,
         saved.version.id, saved.run.startedAt, saved.run.finishedAt);
    },
    'foreign result association': (f, saved) => {
      const other = f.store.createProject(f.foreign.id, 'Foreign result fixture', f.bundle);
      f.sql.prepare(`INSERT INTO generation_runs(id,project_id,request_id,base_version_id,result_version_id,status,started_at,finished_at)
        VALUES(?,?,?,?,?,'succeeded',?,?)`).run(randomUUID(), other.project.id, randomUUID(), other.currentVersion.id,
          saved.version.id, saved.run.startedAt, saved.run.finishedAt);
    },
    'only foreign result association': (f, saved) => {
      const other = f.store.createProject(f.foreign.id, 'Only foreign result fixture', f.bundle);
      f.sql.prepare('UPDATE generation_runs SET project_id=?,base_version_id=? WHERE id=?')
        .run(other.project.id, other.currentVersion.id, saved.run.id);
    },
  };
  for (const [name, mutate] of Object.entries(mutations)) await t.test(name, async child => {
    const f = await fixture(child);
    const saved = f.candidate();
    f.restore(saved.version.id);
    f.sql.exec('DROP TRIGGER versions_immutable');
    f.sql.pragma('foreign_keys = OFF');
    mutate(f, saved);
    const before = databaseRows(f.sql);
    assert.throws(() => f.restore(saved.version.id), { code: 'DATA_CORRUPT' });
    const response = await f.post(saved.version.id);
    assertError(response, 500, 'DATA_CORRUPT');
    for (const secret of ['PRIVATE_CORRUPTION_SENTINEL', 'PRIVATE_RESTORATION_PROMPT', f.owner.token, f.filename, 'snapshot_json', 'SELECT ']) {
      assert.ok(!`${response.body}${f.logs()}`.includes(secret), secret);
    }
    assert.deepEqual(databaseRows(f.sql), before);
  });
});

test('generated snapshots without successful result association are 409 including already-current targets', async t => {
  const f = await fixture(t);
  const saved = f.candidate();
  f.sql.prepare("UPDATE generation_runs SET status='failed',result_version_id=NULL,error_code='MODEL_ERROR' WHERE id=?").run(saved.run.id);
  for (const current of [f.templateId, saved.version.id]) {
    f.sql.prepare('UPDATE projects SET current_version_id=? WHERE id=?').run(current, f.projectId);
    const before = databaseRows(f.sql);
    assert.throws(() => f.restore(saved.version.id), { code: 'VERSION_NOT_RESTORABLE' });
    assertError(await f.post(saved.version.id), 409, 'VERSION_NOT_RESTORABLE');
    assert.deepEqual(databaseRows(f.sql), before);
  }
});

test('transaction failures roll back both project fields and never leak SQL, path, cookie or source into logs', async t => {
  const f = await fixture(t);
  const saved = f.candidate();
  f.sql.exec(`CREATE TRIGGER reject_restoration AFTER UPDATE OF current_version_id ON projects
    BEGIN SELECT RAISE(ABORT,'PRIVATE_RESTORATION_SQL_SENTINEL'); END`);
  const before = databaseRows(f.sql);
  assert.throws(() => f.restore(saved.version.id), { code: 'STORAGE_UNAVAILABLE' });
  const response = await f.post(saved.version.id);
  assertError(response, 503, 'STORAGE_UNAVAILABLE');
  assert.deepEqual(databaseRows(f.sql), before);
  for (const secret of ['PRIVATE_RESTORATION_SQL_SENTINEL', 'PRIVATE_RESTORATION_PROMPT', f.filename, f.owner.token,
    'CREATE TRIGGER', 'UPDATE projects', 'snapshot_json']) assert.ok(!`${response.body}${f.logs()}`.includes(secret), secret);
  f.sql.exec('DROP TRIGGER reject_restoration');
  assert.equal((await f.post(saved.version.id)).statusCode, 200);
});

test('HTTP rejects malformed UUID, strict body/query, JSON, Origin and body limits without mutations', async t => {
  const f = await fixture(t);
  const saved = f.candidate();
  const url = f.path + saved.version.id + '/restore';
  const payload = { expectedCurrentVersionId: f.templateId };
  const cases = [
    { url: `/api/projects/invalid/versions/${saved.version.id}/restore`, payload, status: 400 },
    { url: f.path + 'invalid/restore', payload, status: 400 },
    { payload: {}, status: 400 }, { payload: { expectedCurrentVersionId: 'invalid' }, status: 400 },
    ...['compiled', 'verified', 'files', 'runId', 'snapshot'].map(key => ({ payload: { ...payload, [key]: true }, status: 400 })),
    { url: url + '?extra=PRIVATE_QUERY_SENTINEL', payload, status: 400 },
    { url: url + '?extra=a&extra=b', payload, status: 400 },
    { payload: '{invalid JSON', status: 400 },
    { headers: { ...f.headers, origin: '' }, payload, status: 403 },
    { headers: { ...f.headers, origin: origin + '/' }, payload, status: 403 },
    { headers: { ...f.headers, origin: 'https://foreign.invalid' }, payload, status: 403 },
    { headers: { ...f.headers, 'content-type': 'text/plain' }, payload: JSON.stringify(payload), status: 415 },
    { payload: { ...payload, files: 'x'.repeat(1200) }, status: 413 },
  ];
  const before = databaseRows(f.sql);
  for (const [index, item] of cases.entries()) {
    const response = await f.app.inject({ method: 'POST', url: item.url ?? url, headers: item.headers ?? f.headers,
      payload: item.payload, remoteAddress: `192.0.2.${index + 1}` });
    assertError(response, item.status);
    assert.ok(!`${response.body}${f.logs()}`.includes('PRIVATE_QUERY_SENTINEL'));
  }
  assert.deepEqual(databaseRows(f.sql), before);
  const response = await f.post(saved.version.id);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  const result = restoreResponseSchema.parse(response.json());
  assert.deepEqual(Object.keys(response.json()).sort(), ['alreadyCurrent', 'currentVersionId', 'projectId', 'updatedAt']);
  assertOnlySelectionChanged(before, databaseRows(f.sql), f.projectId, result);
});

test('HTTP isolates A/B sessions and cross-project misses and rejects expired same-target retries', async t => {
  const f = await fixture(t);
  const saved = f.candidate();
  const other = f.store.createProject(f.owner.id, 'Other HTTP fixture', f.bundle);
  const payload = { expectedCurrentVersionId: f.templateId };
  const before = databaseRows(f.sql);
  for (const cookie of ['', 'atoms_session=invalid']) {
    const response = await f.app.inject({ method: 'POST', url: f.path + saved.version.id + '/restore',
      headers: { ...f.headers, cookie }, payload });
    assertError(response, 401, 'SESSION_REQUIRED');
    assert.equal(response.headers['set-cookie'], undefined);
  }
  const missing = assertError(await f.post(randomUUID()), 404, 'NOT_FOUND');
  for (const [url, cookie] of [[f.path + saved.version.id + '/restore', `atoms_session=${f.foreign.token}`],
    [f.path + other.currentVersion.id + '/restore', f.headers.cookie],
    [`/api/projects/${randomUUID()}/versions/${saved.version.id}/restore`, f.headers.cookie]]) {
    assert.ok(url && cookie);
    const response = await f.app.inject({ method: 'POST', url, headers: { ...f.headers, cookie }, payload });
    assert.deepEqual(assertError(response, 404), missing);
  }
  assert.deepEqual(databaseRows(f.sql), before);
  assert.equal((await f.post(saved.version.id)).statusCode, 200);
  f.sql.prepare('UPDATE sessions SET expires_at=created_at+1 WHERE id=?').run(f.owner.id);
  const expired = databaseRows(f.sql);
  assertError(await f.post(saved.version.id), 401, 'SESSION_REQUIRED');
  assert.deepEqual(databaseRows(f.sql), expired);
});

test('restore limits ten requests per minute by actual IP despite forged proxy headers', async t => {
  const f = await fixture(t);
  const before = databaseRows(f.sql);
  for (let i = 0; i < 10; i++) {
    const response = await f.app.inject({ method: 'POST', url: f.path + f.templateId + '/restore',
      headers: { ...f.headers, 'x-forwarded-for': `192.0.2.${i + 1}`, 'x-real-ip': `198.51.100.${i + 1}` },
      remoteAddress: '127.0.0.9', payload: { expectedCurrentVersionId: randomUUID() } });
    assert.equal(response.statusCode, 200, `request ${i + 1}`);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(restoreResponseSchema.parse(response.json()).alreadyCurrent, true);
  }
  const response = await f.app.inject({ method: 'POST', url: f.path + f.templateId + '/restore',
    headers: { ...f.headers, 'x-forwarded-for': '203.0.113.1', 'x-real-ip': '203.0.113.2' },
    remoteAddress: '127.0.0.9', payload: { expectedCurrentVersionId: f.templateId } });
  assertError(response, 429, 'RATE_LIMITED');
  assert.ok(Number(response.headers['retry-after']) > 0);
  assert.equal((await f.app.inject({ method: 'POST', url: f.path + f.templateId + '/restore', headers: f.headers,
    remoteAddress: '127.0.0.10', payload: { expectedCurrentVersionId: f.templateId } })).statusCode, 200);
  assert.deepEqual(databaseRows(f.sql), before);
});

test('production assembly refuses actual switches after ownership loss and closed storage returns safe 503', async t => {
  await t.test('ownership loss', async child => {
    const f = await fixture(child);
    const saved = f.candidate();
    await f.app.ready();
    f.ownership.abort();
    const before = databaseRows(f.sql);
    assertError(await f.post(saved.version.id), 503);
    assert.deepEqual(databaseRows(f.sql), before);
  });
  await t.test('closed storage', async child => {
    const f = await fixture(child);
    const saved = f.candidate();
    await f.app.ready();
    const before = databaseRows(f.sql);
    f.store.close();
    const response = await f.post(saved.version.id);
    assertError(response, 503, 'STORAGE_UNAVAILABLE');
    assert.deepEqual(databaseRows(f.sql), before);
    for (const secret of [f.filename, f.owner.token, 'database connection', 'SELECT ', 'Sqlite']) {
      assert.ok(!`${response.body}${f.logs()}`.includes(secret), secret);
    }
  });
});
