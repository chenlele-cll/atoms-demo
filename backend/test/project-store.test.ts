import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import Database from 'better-sqlite3';
import { openStore, tokenDigest } from '../src/storage/store.js';
import { migrate } from '../src/storage/migrations.js';
import { ProjectError } from '../src/projects/errors.js';
import { createCatalog } from '../src/templates/catalog.js';
import { changedSnapshot, projectFixture } from './helpers/projects.js';

test('real file migrations are idempotent, WAL/foreign keys enabled and future schemas preserved', async t => {
  const f = await projectFixture(t);
  const session = f.store.createSession();
  const sql = new Database(f.filename);
  t.after(() => sql.close());
  assert.equal(sql.pragma('user_version', { simple: true }), 2);
  assert.equal(sql.pragma('journal_mode', { simple: true }), 'wal');
  migrate(sql); migrate(sql);
  const row = sql.prepare('SELECT token_hash FROM sessions').get();
  assert.deepEqual(row, { token_hash: tokenDigest(session.token) });
  assert.ok(!JSON.stringify(sql.prepare('SELECT * FROM sessions').all()).includes(session.token));
  f.store.close();
  const reopened = openStore(f.filename);
  assert.equal(reopened.findSession(session.token)?.id, session.id); reopened.close();
  sql.pragma('user_version=99'); sql.close();
  const before = await readFile(f.filename);
  assert.throws(() => openStore(f.filename), error => error instanceof ProjectError && error.code === 'INVALID_CONFIGURATION');
  assert.deepEqual(await readFile(f.filename), before);
});

test('migration failure rolls back all DDL and user_version', async t => {
  const f = await projectFixture(t);
  const sql = new Database(`${f.directory}/migration.sqlite`);
  t.after(() => sql.close());
  assert.throws(() => migrate(sql, [{ version: 1, sql: 'CREATE TABLE rollback_test(id TEXT); INVALID SQL;' }]));
  assert.equal(sql.pragma('user_version', { simple: true }), 0);
  assert.deepEqual(sql.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(), []);
});

test('initial project is atomic, empty and restores every file independently of a changed catalog', async t => {
  const f = await projectFixture(t);
  const a = f.store.createSession(); const b = f.store.createSession();
  const first = f.store.createProject(a.id, '  Company A  ', f.bundle);
  assert.equal(first.project.title, 'Company A'); assert.equal(first.currentVersion.sequence, 0);
  assert.equal(first.currentVersion.kind, 'template'); assert.equal(first.latestRun, null);
  assert.deepEqual(f.store.listMessages(a.id, first.project.id, 0, 20), { items: [], nextAfterSequence: null });
  assert.equal(f.store.listProjects(b.id, 20).items.length, 0);
  assert.throws(() => f.store.getProject(b.id, first.project.id), error => error instanceof ProjectError && error.code === 'NOT_FOUND');
  const different = createCatalog(changedSnapshot(f.bundle));
  assert.notEqual(different.list().items[0]?.digest, f.bundle.digest);
  f.store.close(); const reopened = openStore(f.filename); t.after(() => reopened.close());
  assert.deepEqual(reopened.getProject(a.id, first.project.id), first);
  assert.deepEqual(reopened.getProject(a.id, first.project.id).currentVersion.snapshot.files, f.bundle.files);
  assert.equal(reopened.findSession(a.token)?.id, a.id);
  assert.deepEqual(reopened.listProjects(a.id, 20).items[0], first.project);
});

test('project save failures at initial snapshot or current reference roll back completely', async t => {
  const f = await projectFixture(t); const session = f.store.createSession();
  const sql = new Database(f.filename); t.after(() => sql.close());
  for (const target of ['versions', 'projects']) {
    sql.exec(`CREATE TRIGGER test_failure BEFORE ${target === 'versions' ? 'INSERT' : 'UPDATE'} ON ${target} BEGIN SELECT RAISE(ABORT,'PRIVATE_SQL_SENTINEL'); END;`);
    assert.throws(() => f.store.createProject(session.id, 'not saved', f.bundle), error => {
      assert.ok(error instanceof ProjectError); assert.equal(error.code, 'STORAGE_UNAVAILABLE');
      assert.ok(!String(error).includes('PRIVATE_SQL_SENTINEL')); return true;
    });
    assert.deepEqual(sql.prepare('SELECT count(*) AS count FROM projects').get(), { count: 0 });
    assert.deepEqual(sql.prepare('SELECT count(*) AS count FROM versions').get(), { count: 0 });
    sql.exec('DROP TRIGGER test_failure');
  }
  assert.ok(f.store.createProject(session.id, 'valid after rollback', f.bundle).project.id);
});

test('stable keyset pagination and transactional project quota', async t => {
  const f = await projectFixture(t); const a = f.store.createSession(); const b = f.store.createSession();
  const ids = Array.from({ length: 4 }, () => f.store.createProject(a.id, 'page fixture', f.bundle).project.id);
  f.store.createProject(b.id, 'private', f.bundle);
  const sql = new Database(f.filename); t.after(() => sql.close());
  sql.prepare('UPDATE projects SET updated_at=? WHERE owner_session_id=?').run('2026-10-18T00:00:00.000Z', a.id);
  const page1 = f.store.listProjects(a.id, 2); assert.ok(page1.nextCursor);
  const page2 = f.store.listProjects(a.id, 2, page1.nextCursor);
  assert.equal(page2.nextCursor, null);
  assert.deepEqual([...page1.items, ...page2.items].map(item => item.id), ids.sort().reverse());
  assert.throws(() => f.store.createProject(a.id, 'over quota', f.bundle, 4), error => error instanceof ProjectError && error.code === 'PROJECT_LIMIT_REACHED');
  assert.equal(f.store.listProjects(a.id, 20).items.length, 4);
});

test('ordered messages, terminal runs and immutable candidates persist without adopting', async t => {
  const f = await projectFixture(t); const owner = f.store.createSession();
  const first = f.store.createProject(owner.id, 'explicit internal fixtures', f.bundle);
  const projectId = first.project.id;
  f.store.appendMessages(projectId, [{ role: 'user', content: 'fixture one' }, { role: 'assistant', content: 'fixture two' }]);
  const requestId = randomUUID();
  const run = f.store.createRun({ projectId, requestId, baseVersionId: first.currentVersion.id,
    messages: [{ role: 'user', content: 'fixture candidate request' }] });
  assert.equal(run.status, 'running'); assert.equal(run.finishedAt, null);
  assert.throws(() => f.store.createRun({ projectId, requestId, baseVersionId: first.currentVersion.id }));
  const candidate = f.store.saveCandidate({ projectId, runId: run.id, snapshot: changedSnapshot(f.bundle),
    messages: [{ role: 'assistant', content: 'explicit fixture candidate, not model output' }] });
  assert.equal(candidate.version.parentVersionId, first.currentVersion.id);
  assert.equal(candidate.version.sequence, 1); assert.equal(candidate.run.status, 'succeeded');
  assert.equal(candidate.run.resultVersionId, candidate.version.id); assert.ok(candidate.run.finishedAt);
  const detail = f.store.getProject(owner.id, projectId);
  assert.equal(detail.project.currentVersionId, first.currentVersion.id);
  assert.deepEqual(detail.currentVersion, first.currentVersion);
  assert.equal(detail.latestRun?.id, run.id);
  const page1 = f.store.listMessages(owner.id, projectId, 0, 2);
  assert.equal(page1.nextAfterSequence, 2);
  const page2 = f.store.listMessages(owner.id, projectId, 2, 2);
  assert.deepEqual([...page1.items, ...page2.items].map(message => message.sequence), [1, 2, 3, 4]);
  assert.equal(page2.nextAfterSequence, null);
  const sql = new Database(f.filename); t.after(() => sql.close());
  assert.throws(() => sql.prepare('UPDATE versions SET snapshot_json=? WHERE id=?').run('{}', candidate.version.id));
  f.store.close(); const reopened = openStore(f.filename); t.after(() => reopened.close());
  assert.deepEqual(reopened.getProject(owner.id, projectId), detail);
  assert.deepEqual(reopened.listMessages(owner.id, projectId, 0, 50).items, [...page1.items, ...page2.items]);
  for (const status of ['failed', 'cancelled', 'interrupted'] as const) {
    const next = reopened.createRun({ projectId, requestId: randomUUID(), baseVersionId: first.currentVersion.id });
    const finished = reopened.finishRun({ projectId, runId: next.id, status, errorCode: 'INTERNAL_ERROR' });
    assert.equal(finished.status, status); assert.ok(finished.finishedAt);
    assert.throws(() => reopened.finishRun({ projectId, runId: next.id, status, errorCode: 'INTERNAL_ERROR' }));
  }
});

test('cross-project relations and associated-write failures leave no partial records', async t => {
  const f = await projectFixture(t); const owner = f.store.createSession();
  const a = f.store.createProject(owner.id, 'A', f.bundle); const b = f.store.createProject(owner.id, 'B', f.bundle);
  assert.throws(() => f.store.createRun({ projectId: a.project.id, requestId: randomUUID(), baseVersionId: b.currentVersion.id }));
  assert.equal(f.store.getProject(owner.id, a.project.id).latestRun, null);
  const run = f.store.createRun({ projectId: a.project.id, requestId: randomUUID(), baseVersionId: a.currentVersion.id });
  assert.throws(() => f.store.appendMessages(b.project.id, [{ role: 'user', content: 'cross project', runId: run.id }]));
  assert.equal(f.store.listMessages(owner.id, b.project.id, 0, 20).items.length, 0);
  const sql = new Database(f.filename); t.after(() => sql.close());
  sql.exec("PRAGMA foreign_keys=ON; CREATE TRIGGER message_failure BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
  assert.throws(() => f.store.saveCandidate({ projectId: a.project.id, runId: run.id, snapshot: f.bundle,
    messages: [{ role: 'assistant', content: 'rollback candidate and run' }] }));
  assert.equal(f.store.getProject(owner.id, a.project.id).latestRun?.status, 'running');
  assert.deepEqual(sql.prepare('SELECT count(*) AS count FROM versions WHERE project_id=?').get(a.project.id), { count: 1 });
  assert.throws(() => f.store.createRun({ projectId: b.project.id, requestId: randomUUID(), baseVersionId: b.currentVersion.id,
    messages: [{ role: 'user', content: 'rollback run as well' }] }));
  assert.equal(f.store.getProject(owner.id, b.project.id).latestRun, null);
  assert.throws(() => f.store.finishRun({ projectId: a.project.id, runId: run.id, status: 'failed', errorCode: 'MODEL_ERROR',
    messages: [{ role: 'assistant', content: 'rollback finish' }] }));
  assert.equal(f.store.getProject(owner.id, a.project.id).latestRun?.status, 'running');
  sql.exec('DROP TRIGGER message_failure');
  assert.throws(() => sql.prepare('UPDATE projects SET current_version_id=? WHERE id=?').run(b.currentVersion.id, a.project.id));
  assert.throws(() => sql.prepare('UPDATE generation_runs SET base_version_id=? WHERE id=?').run(b.currentVersion.id, run.id));
});
