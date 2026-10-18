import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import Database from 'better-sqlite3';
import { snapshotDigest, snapshotSchema, VERSION_HISTORY_MAX_BYTES, versionHistoryQuerySchema,
  versionHistorySchema, versionReviewSchema } from '@atoms/contracts';
import type { Snapshot, VersionHistory } from '@atoms/contracts';
import { buildApp } from '../src/app.js';
import { migrate, migrations } from '../src/storage/migrations.js';
import { openStore } from '../src/storage/store.js';
import { changedSnapshot, projectFixture } from './helpers/projects.js';

const origin = 'http://127.0.0.1:5173';

function snapshot(original: Snapshot, files: Record<string, string>, changes: Partial<Snapshot> = {}) {
  const { digest, ...body } = { ...original, ...changes, files };
  void digest;
  return snapshotSchema.parse({ ...body, digest: snapshotDigest(body) });
}

async function fixture(t: TestContext) {
  const f = await projectFixture(t);
  // Keep historical fixtures small while retaining all required bundle metadata/files.
  const files = Object.fromEntries(Object.keys(f.bundle.files).map(path => [path, '']));
  for (const path of ['/package.json', '/LICENSE']) files[path] = f.bundle.files[path] ?? '';
  files[f.bundle.entry] = '// PRIVATE_HISTORY_CODE; throw new Error("must not execute");';
  files['/src/styles.css'] = '/* history fixture */';
  files['/public/index.html'] = '<div id="root"></div>';
  const bundle = snapshot(f.bundle, files);
  const owner = f.store.createSession();
  const foreign = f.store.createSession();
  const project = f.store.createProject(owner.id, 'History fixture', bundle);
  let modelCalls = 0;
  const app = buildApp({ logger: false }, {
    store: f.store, catalog: f.catalog, origins: [origin], secureCookies: false,
    generation: { env: {}, transport: async () => { modelCalls++; throw new Error('Unexpected model call'); } },
  });
  t.after(() => app.close());
  const sql = new Database(f.filename);
  t.after(() => sql.close());
  const projectId = project.project.id;
  const path = `/api/projects/${projectId}/versions`;
  const headers = { origin, cookie: `atoms_session=${owner.token}` };
  const get = (query = '') => app.inject({ method: 'GET', url: path + query, headers });
  function candidate(baseVersionId = project.currentVersion.id, input = changedSnapshot(bundle), messages?: { role: 'user' | 'assistant'; content: string }[]) {
    const run = f.store.createRun({ projectId, requestId: randomUUID(), baseVersionId, ...(messages ? { messages } : {}) });
    return f.store.saveCandidate({ projectId, runId: run.id, snapshot: input });
  }
  const list = (limit = 20, beforeSequence?: number) => f.store.listVersions(owner.id, projectId, limit, beforeSequence);
  return { ...f, bundle, owner, foreign, project, projectId, app, sql, path, headers, get, candidate, list,
    modelCalls: () => modelCalls };
}

function assertCurrent(page: VersionHistory) {
  for (const item of page.items) assert.equal(item.isCurrent, item.id === page.currentVersionId);
}

function databaseRows(sql: Database.Database) {
  return Object.fromEntries(['sessions', 'projects', 'versions', 'generation_runs', 'messages'].map(table =>
    [table, sql.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]));
}

test('history query accepts canonical boundaries and rejects ambiguous or unknown input', () => {
  assert.deepEqual(versionHistoryQuerySchema.parse({}), { limit: 20 });
  assert.deepEqual(versionHistoryQuerySchema.parse({ limit: '50', beforeSequence: '0' }), { limit: 50, beforeSequence: 0 });
  assert.equal(versionHistoryQuerySchema.parse({ limit: '1', beforeSequence: String(Number.MAX_SAFE_INTEGER) }).beforeSequence, Number.MAX_SAFE_INTEGER);
  for (const value of ['-1', '1.5', '1e1', '01', '+1', '', ' 1', '9007199254740992']) {
    assert.equal(versionHistoryQuerySchema.safeParse({ limit: value }).success, false, `limit=${value}`);
    assert.equal(versionHistoryQuerySchema.safeParse({ beforeSequence: value }).success, false, `beforeSequence=${value}`);
  }
  for (const input of [{ limit: '0' }, { limit: '51' }, { limit: ['1', '2'] }, { beforeSequence: ['1', '2'] },
    { limit: 1 }, { beforeSequence: 1 }, { extra: 'x' }]) {
    assert.equal(versionHistoryQuerySchema.safeParse(input).success, false);
  }
});

test('history response enforces the UTF-8 JSON budget for otherwise bounded items', () => {
  assert.equal(VERSION_HISTORY_MAX_BYTES, 1024 * 1024);
  const projectId = randomUUID();
  const currentVersionId = randomUUID();
  // Two 64-file snapshots share at least five required files: 123 changed paths is feasible.
  const changedFiles = Array.from({ length: 123 }, (_, i) => `/src/generated/${String(i).padStart(3, '0')}${'a'.repeat(219)}.ts`);
  assert.ok(changedFiles.every(path => path.length === 240));
  const items = Array.from({ length: 50 }, (_, i) => ({ id: randomUUID(), sequence: 50 - i,
    parentVersionId: currentVersionId, kind: 'generated', createdAt: '2026-01-01T00:00:00.000Z', isCurrent: false,
    runId: null, request: null, summary: { source: 'fallback', text: 'x'.repeat(240) }, changedFiles }));
  const small = { projectId, currentVersionId, items: items.slice(0, 1), nextBeforeSequence: null };
  assert.equal(versionHistorySchema.safeParse(small).success, true);
  const large = { ...small, items };
  assert.ok(Buffer.byteLength(JSON.stringify(large)) > VERSION_HISTORY_MAX_BYTES);
  assert.equal(versionHistorySchema.safeParse(large).success, false);
  assert.equal(versionHistorySchema.safeParse({ ...small, projectId: 'invalid' }).success, false);
  const attributed = { ...items[0], runId: randomUUID(), request: { messageId: randomUUID(), excerpt: '\u{1f642}'.repeat(240), truncated: true } };
  assert.equal(versionHistorySchema.safeParse({ ...small, items: [attributed] }).success, true);
  assert.equal(versionHistorySchema.safeParse({ ...small, items: [{ ...attributed, request: { ...attributed.request, excerpt: '\u{1f642}'.repeat(241) } }] }).success, false);
  assert.equal(versionHistorySchema.safeParse({ ...small, items: [{ ...attributed, parentVersionId: attributed.id }] }).success, false);
  const parent = items[0]; const child = items[1]; assert.ok(parent && child);
  assert.equal(versionHistorySchema.safeParse({ ...small, items: [parent, { ...child, parentVersionId: parent.id }] }).success, false);
});

test('template and legacy generated versions retain null attribution and factual fallback', async t => {
  const f = await fixture(t);
  const withoutMessages = f.candidate();
  const legacy = f.candidate();
  f.sql.prepare('DELETE FROM generation_runs WHERE id=?').run(legacy.run.id);
  const page = f.list();
  assert.deepEqual(page.items.map(item => item.id), [legacy.version.id, withoutMessages.version.id, f.project.currentVersion.id]);
  const [old, empty, template] = page.items;
  assert.ok(old && empty && template);
  assert.equal(old.runId, null);
  assert.equal(old.request, null);
  assert.equal(empty.runId, withoutMessages.run.id);
  assert.equal(empty.request, null);
  assert.equal(old.summary.source, 'fallback');
  assert.deepEqual(empty.summary, old.summary);
  assert.equal(template.summary.source, 'fallback');
  assert.ok(template.summary.text.length > 0);
  assert.notEqual(template.summary.text, old.summary.text);
  assert.deepEqual(template.changedFiles, []);
  assert.equal(template.runId, null);
  assert.equal(template.request, null);
  assertCurrent(page);
  assert.deepEqual(f.list(20, 0), { projectId: f.projectId, currentVersionId: template.id, items: [], nextBeforeSequence: null });
  assert.equal(f.modelCalls(), 0);
});

test('attribution selects earliest user and last assistant by sequence and truncates Unicode code points', async t => {
  const f = await fixture(t);
  const prompt = 'a'.repeat(239) + '\u{1f642}' + 'PRIVATE_FULL_PROMPT';
  const summary = '\u{1f680}'.repeat(240) + 'PRIVATE_FULL_SUMMARY';
  const saved = f.candidate(undefined, undefined, [{ role: 'user', content: prompt }, { role: 'assistant', content: 'old summary' }]);
  f.store.appendMessages(f.projectId, [
    { role: 'user', content: 'later request', runId: saved.run.id },
    { role: 'assistant', content: summary, runId: saved.run.id },
    { role: 'assistant', content: 'unrelated latest project summary' },
  ]);
  f.candidate(undefined, undefined, [{ role: 'user', content: 'different run request' }, { role: 'assistant', content: 'different run summary' }]);
  const messages = f.store.listMessages(f.owner.id, f.projectId, 0, 50).items;
  const response = await f.get();
  assert.equal(response.statusCode, 200);
  const page = versionHistorySchema.parse(response.json());
  assert.deepEqual(Object.keys(page).sort(), ['currentVersionId', 'items', 'nextBeforeSequence', 'projectId']);
  const item = page.items.find(value => value.id === saved.version.id);
  assert.ok(item);
  assert.equal(item.runId, saved.run.id);
  assert.deepEqual(item.request, { messageId: messages[0]?.id, excerpt: 'a'.repeat(239) + '\u{1f642}', truncated: true });
  assert.deepEqual(item.summary, { source: 'stored', text: '\u{1f680}'.repeat(240) });
  assert.equal(Array.from(item.summary.text).length, 240);
  for (const secret of ['PRIVATE_FULL_PROMPT', 'PRIVATE_FULL_SUMMARY', 'PRIVATE_HISTORY_CODE', f.owner.token, 'ownerSessionId', 'snapshot', 'adoptionAvailability', 'unrelated latest']) {
    assert.ok(!response.body.includes(secret), secret);
  }
  assert.deepEqual(Object.keys(item).sort(), ['changedFiles', 'createdAt', 'id', 'isCurrent', 'kind', 'parentVersionId', 'request', 'runId', 'sequence', 'summary'].sort());
  const exact = f.candidate(undefined, undefined, [{ role: 'user', content: '\u{1f642}'.repeat(240) }]);
  assert.equal(f.list().items.find(value => value.id === exact.version.id)?.request?.truncated, false);
});

test('more than fifty equal-time versions paginate without gaps across a second connection append/current change', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 55; i++) f.candidate();
  f.sql.exec('DROP TRIGGER versions_immutable');
  f.sql.prepare('UPDATE versions SET created_at=? WHERE project_id=?').run('2026-01-01T00:00:00.000Z', f.projectId);
  const first = f.list(50);
  assert.deepEqual(first.items.map(item => item.sequence), Array.from({ length: 50 }, (_, i) => 55 - i));
  assert.equal(first.nextBeforeSequence, 6);
  assert.equal(first.items.some(item => item.isCurrent), false);
  const other = openStore(f.filename);
  try {
    const run = other.createRun({ projectId: f.projectId, baseVersionId: f.project.currentVersion.id, requestId: randomUUID() });
    const added = other.saveCandidate({ projectId: f.projectId, runId: run.id, snapshot: changedSnapshot(f.bundle) });
    const oldCurrent = f.sql.prepare('SELECT id FROM versions WHERE project_id=? AND sequence=3').get(f.projectId) as { id: string };
    f.sql.prepare('UPDATE projects SET current_version_id=? WHERE id=?').run(oldCurrent.id, f.projectId);
    const second = f.list(50, first.nextBeforeSequence ?? undefined);
    assert.deepEqual(second.items.map(item => item.sequence), [5, 4, 3, 2, 1, 0]);
    assert.equal(second.nextBeforeSequence, null);
    assert.equal(second.currentVersionId, oldCurrent.id);
    assertCurrent(second);
    const ids = [...first.items, ...second.items].map(item => item.id);
    assert.equal(new Set(ids).size, 56);
    assert.ok(!ids.includes(added.version.id));
    assert.equal(f.list(1).items[0]?.id, added.version.id);
    assert.equal(f.list(1).nextBeforeSequence, 56);
    assert.equal(f.list().items.length, 20);
  } finally { other.close(); }
});

test('sibling branches compare their own parent with sorted additions/deletions/modifications, matching detail GET', async t => {
  const f = await fixture(t);
  const parentFiles = { ...f.bundle.files, '/src/generated/deleted.ts': 'delete me', '/src/generated/kept.ts': 'keep me' };
  const parent = f.candidate(undefined, snapshot(f.bundle, parentFiles));
  const childFiles = { ...parentFiles, [f.bundle.entry]: 'changed child', '/src/generated/added.ts': 'added' };
  delete (childFiles as Record<string, string>)['/src/generated/deleted.ts'];
  const child = f.candidate(parent.version.id, snapshot(f.bundle, childFiles));
  const sibling = f.candidate(parent.version.id, snapshot(f.bundle, { ...parentFiles, '/src/generated/kept.ts': 'changed sibling' }));
  f.sql.prepare('UPDATE projects SET current_version_id=? WHERE id=?').run(sibling.version.id, f.projectId);
  const response = await f.get();
  assert.equal(response.statusCode, 200);
  const page = versionHistorySchema.parse(response.json());
  assertCurrent(page);
  const item = page.items.find(value => value.id === child.version.id);
  assert.ok(item);
  assert.equal(item.parentVersionId, parent.version.id);
  assert.equal(item.isCurrent, false);
  assert.deepEqual(item.changedFiles, [f.bundle.entry, '/src/generated/added.ts', '/src/generated/deleted.ts'].sort());
  assert.deepEqual(page.items.find(value => value.id === sibling.version.id)?.changedFiles, ['/src/generated/kept.ts']);
  for (const version of [parent.version, child.version, sibling.version]) {
    const detail = await f.app.inject({ method: 'GET', url: `${f.path}/${version.id}`, headers: f.headers });
    assert.equal(detail.statusCode, 200);
    assert.deepEqual(versionReviewSchema.parse(detail.json()).changedFiles, page.items.find(value => value.id === version.id)?.changedFiles);
  }
});

test('HTTP enforces author sessions and indistinguishable missing projects without initializing a session', async t => {
  const f = await fixture(t);
  const before = databaseRows(f.sql);
  for (const cookie of ['', 'atoms_session=invalid']) {
    const response = await f.app.inject({ method: 'GET', url: f.path, headers: { cookie } });
    assert.equal(response.statusCode, 401);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['set-cookie'], undefined);
  }
  const foreign = await f.app.inject({ method: 'GET', url: f.path, headers: { cookie: `atoms_session=${f.foreign.token}` } });
  const missing = await f.app.inject({ method: 'GET', url: `/api/projects/${randomUUID()}/versions`, headers: f.headers });
  assert.equal(foreign.statusCode, 404);
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(foreign.json().error, missing.json().error);
  assert.equal(foreign.headers['cache-control'], 'no-store');
  assert.equal((await f.get()).statusCode, 200);
  assert.throws(() => f.store.listVersions(f.foreign.id, f.projectId, 1), { code: 'NOT_FOUND' });
  assert.deepEqual(databaseRows(f.sql), before);
});

test('HTTP rejects extra, duplicate and noncanonical query values and accepts an empty cursor page', async t => {
  const f = await fixture(t);
  for (const query of ['?extra=x', '?limit=1&limit=2', '?beforeSequence=0&beforeSequence=1', '?limit=0', '?limit=51',
    '?limit=1.5', '?limit=1e1', '?limit=-1', '?limit=01', '?beforeSequence=-1', '?beforeSequence=1.5',
    '?beforeSequence=1e1', '?beforeSequence=01', '?beforeSequence=9007199254740992']) {
    const response = await f.get(query);
    assert.equal(response.statusCode, 400, query);
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  assert.equal((await f.app.inject({ method: 'GET', url: '/api/projects/not-a-uuid/versions', headers: f.headers })).statusCode, 400);
  const response = await f.get('?limit=1&beforeSequence=0');
  assert.equal(response.statusCode, 200);
  assert.deepEqual(versionHistorySchema.parse(response.json()).items, []);
});

test('history allows sixty requests per IP then returns Retry-After despite forged forwarding headers', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 60; i++) {
    const response = await f.app.inject({ method: 'GET', url: f.path + '?limit=1', headers: {
      ...f.headers, 'x-forwarded-for': `192.0.2.${i + 1}`, 'x-real-ip': `198.51.100.${i + 1}` }, remoteAddress: '127.0.0.9' });
    assert.equal(response.statusCode, 200, `request ${i + 1}`);
  }
  const response = await f.app.inject({ method: 'GET', url: f.path + '?limit=1', headers: {
    ...f.headers, 'x-forwarded-for': '203.0.113.1' }, remoteAddress: '127.0.0.9' });
  assert.equal(response.statusCode, 429);
  assert.ok(Number(response.headers['retry-after']) > 0);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal((await f.app.inject({ method: 'GET', url: f.path + '?limit=1', headers: f.headers, remoteAddress: '127.0.0.10' })).statusCode, 200);
});

test('repeated store/HTTP reads and reopen preserve all SQL rows, current, updatedAt and zero model calls', async t => {
  const f = await fixture(t);
  f.candidate(undefined, undefined, [{ role: 'user', content: 'stored request' }, { role: 'assistant', content: 'stored summary' }]);
  const before = databaseRows(f.sql);
  const expected = f.list();
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(f.list(), expected);
    const response = await f.get();
    assert.equal(response.statusCode, 200);
    assert.deepEqual(versionHistorySchema.parse(response.json()), expected);
  }
  assert.deepEqual(databaseRows(f.sql), before);
  assert.equal(f.modelCalls(), 0);
  await f.app.close();
  const reopened = openStore(f.filename);
  try {
    assert.deepEqual(reopened.listVersions(f.owner.id, f.projectId, 20), expected);
    assert.deepEqual(databaseRows(f.sql), before);
  } finally { reopened.close(); }
});

test('corrupt snapshots, ancestry, messages and contradictory/duplicate run associations fail safely', async t => {
  const mutations: Record<string, (f: Awaited<ReturnType<typeof fixture>>, saved: ReturnType<Awaited<ReturnType<typeof fixture>>['candidate']>) => void> = {
    'invalid JSON': (f, saved) => { f.sql.prepare('UPDATE versions SET snapshot_json=? WHERE id=?').run('PRIVATE_CORRUPTION_SENTINEL', saved.version.id); },
    'bad digest': (f, saved) => { f.sql.prepare('UPDATE versions SET snapshot_json=? WHERE id=?').run(JSON.stringify({ ...saved.version.snapshot, digest: '0'.repeat(64) }), saved.version.id); },
    'missing parent': (f, saved) => { f.sql.prepare('UPDATE versions SET parent_version_id=? WHERE id=?').run(randomUUID(), saved.version.id); },
    'parent sequence is not older': (f, saved) => { f.sql.prepare('UPDATE versions SET parent_version_id=? WHERE id=?').run(saved.version.id, saved.version.id); },
    'parent identity mismatch': (f, saved) => {
      const parent = snapshot(f.bundle, f.bundle.files, { version: f.bundle.version + 1 });
      f.sql.prepare('UPDATE versions SET snapshot_json=? WHERE id=?').run(JSON.stringify(parent), saved.version.parentVersionId);
    },
    'parent local ancestry is inconsistent': (f, saved) => {
      f.sql.pragma('ignore_check_constraints = ON');
      f.sql.prepare("UPDATE versions SET kind='generated' WHERE id=?").run(saved.version.parentVersionId);
    },
    'invalid associated message': (f, saved) => { f.sql.prepare('UPDATE messages SET content=? WHERE run_id=?').run(' '.repeat(17000) + 'PRIVATE_CORRUPTION_SENTINEL', saved.run.id); },
    'contradictory run status': (f, saved) => {
      f.sql.pragma('ignore_check_constraints = ON');
      f.sql.prepare("UPDATE generation_runs SET status='failed',error_code='MODEL_ERROR' WHERE id=?").run(saved.run.id);
    },
    'contradictory run base': (f, saved) => { f.sql.prepare('UPDATE generation_runs SET base_version_id=? WHERE id=?').run(saved.version.id, saved.run.id); },
    'duplicate success association': (f, saved) => {
      f.sql.prepare(`INSERT INTO generation_runs(id,project_id,request_id,base_version_id,result_version_id,status,started_at,finished_at)
        VALUES(?,?,?,?,?,'succeeded',?,?)`).run(randomUUID(), f.projectId, randomUUID(), saved.version.parentVersionId, saved.version.id, saved.run.startedAt, saved.run.finishedAt);
    },
    'cross-project parent': (f, saved) => {
      const other = f.store.createProject(f.owner.id, 'Other project', f.bundle);
      f.sql.prepare('UPDATE versions SET parent_version_id=? WHERE id=?').run(other.currentVersion.id, saved.version.id);
    },
  };
  for (const [name, mutate] of Object.entries(mutations)) await t.test(name, async child => {
    const f = await fixture(child);
    const saved = f.candidate(undefined, undefined, [{ role: 'user', content: 'request' }]);
    f.sql.exec('DROP TRIGGER versions_immutable');
    f.sql.pragma('foreign_keys = OFF');
    mutate(f, saved);
    const before = databaseRows(f.sql);
    assert.throws(() => f.list(1), { code: 'DATA_CORRUPT' });
    const response = await f.get('?limit=1');
    assert.equal(response.statusCode, 500);
    assert.equal(response.json().error.code, 'DATA_CORRUPT');
    assert.equal(response.headers['cache-control'], 'no-store');
    for (const secret of ['PRIVATE_CORRUPTION_SENTINEL', f.filename, f.owner.token, 'snapshot_json', 'SELECT ']) assert.ok(!response.body.includes(secret), secret);
    assert.deepEqual(databaseRows(f.sql), before);
  });
});

test('corruption outside the page and its parents does not poison valid pages or the lookahead', async t => {
  const f = await fixture(t);
  const corrupt = f.candidate();
  const healthy = f.candidate();
  f.sql.exec('DROP TRIGGER versions_immutable');
  f.sql.prepare('UPDATE versions SET snapshot_json=? WHERE id=?').run('PRIVATE_OFF_PAGE_SENTINEL', corrupt.version.id);
  const page = f.list(1);
  assert.equal(page.items[0]?.id, healthy.version.id);
  assert.equal(page.nextBeforeSequence, healthy.version.sequence);
  assert.equal((await f.get('?limit=1')).statusCode, 200);
  assert.equal((await f.get('?limit=1&beforeSequence=1')).statusCode, 200);
  assert.equal((await f.get('?limit=1&beforeSequence=2')).statusCode, 500);
});

test('a large valid stored snapshot produces complete metadata with a bounded response', async t => {
  const f = await fixture(t);
  const path = '/src/generated/large.ts';
  const large = snapshot(f.bundle, { ...f.bundle.files, [path]: '// PRIVATE_LARGE_CODE\n' + 'x'.repeat(1024 * 1024) });
  f.candidate(undefined, large);
  const response = await f.get('?limit=50');
  assert.equal(response.statusCode, 200);
  assert.deepEqual(versionHistorySchema.parse(response.json()).items[0]?.changedFiles, [path]);
  assert.ok(Buffer.byteLength(response.body) < VERSION_HISTORY_MAX_BYTES);
  assert.ok(!response.body.includes('PRIVATE_LARGE_CODE'));
  assert.equal(f.modelCalls(), 0);
});

test('HTTP rejects an oversized complete history page instead of truncating paths or returning partial results', async t => {
  const f = await fixture(t);
  const required = [f.bundle.entry, '/src/styles.css', '/public/index.html', '/package.json', '/LICENSE'];
  const common = Object.fromEntries(required.map(path => [path, f.bundle.files[path] ?? '']));
  const files = (prefix: string) => ({ ...common, ...Object.fromEntries(Array.from({ length: 59 }, (_, i) =>
    [`/src/generated/${prefix}${String(i).padStart(3, '0')}${'a'.repeat(218)}.ts`, '// fixture'])) });
  const parent = f.candidate(undefined, snapshot(f.bundle, files('a')));
  const child = snapshot(f.bundle, files('b'));
  for (let i = 0; i < 50; i++) f.candidate(parent.version.id, child);
  const small = await f.get('?limit=1');
  assert.equal(small.statusCode, 200);
  const page = versionHistorySchema.parse(small.json());
  assert.equal(page.items[0]?.changedFiles.length, 118);
  const detail = await f.app.inject({ method: 'GET', url: `${f.path}/${page.items[0]?.id}`, headers: f.headers });
  assert.equal(detail.statusCode, 200);
  assert.deepEqual(versionReviewSchema.parse(detail.json()).changedFiles, page.items[0]?.changedFiles);
  const before = databaseRows(f.sql);
  const response = await f.get('?limit=50');
  assert.equal(response.statusCode, 500);
  assert.equal(response.json().error.code, 'DATA_CORRUPT');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.ok(!response.body.includes('items'));
  assert.deepEqual(databaseRows(f.sql), before);
  assert.equal(f.modelCalls(), 0);
});

test('closed storage returns safe 503 rather than empty history or SQLite details', async t => {
  const f = await fixture(t);
  await f.app.ready();
  f.store.close();
  const response = await f.get();
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error.code, 'STORAGE_UNAVAILABLE');
  assert.equal(response.headers['cache-control'], 'no-store');
  for (const secret of [f.filename, f.owner.token, 'database connection', 'SELECT ', 'Sqlite']) assert.ok(!response.body.includes(secret));
});

test('v2 database upgrades without data changes and actual history association plans use v3 indexes after reopen', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 52; i++) f.candidate(undefined, undefined, [{ role: 'user', content: `request ${i}` }, { role: 'assistant', content: `summary ${i}` }]);
  const expected = f.list(1);
  const before = databaseRows(f.sql);
  await f.app.close();
  f.sql.exec('DROP INDEX run_version_result; DROP INDEX message_run_role_order');
  f.sql.pragma('user_version = 2');
  for (let i = 0; i < 2; i++) {
    const store = openStore(f.filename);
    try {
      assert.deepEqual(store.listVersions(f.owner.id, f.projectId, 1), expected);
      assert.deepEqual(databaseRows(f.sql), before);
      assert.equal(f.sql.pragma('user_version', { simple: true }), 3);
    } finally { store.close(); }
  }
  const executed: string[] = [];
  const observed = new Database(f.filename, { verbose: sql => { if (typeof sql === 'string') executed.push(sql); } });
  try {
    const { ProjectStore } = await import('../src/storage/store.js');
    const store = new ProjectStore(observed);
    assert.deepEqual(store.listVersions(f.owner.id, f.projectId, 1), expected);
    const associationQueries = executed.filter(sql => /^\s*SELECT\b/i.test(sql) &&
      (/FROM\s+generation_runs\b/i.test(sql) && /result_version_id\s*=/i.test(sql) ||
       /FROM\s+messages\b/i.test(sql) && /run_id\s*=/i.test(sql)));
    assert.ok(associationQueries.some(sql => /generation_runs/.test(sql)));
    assert.ok(associationQueries.some(sql => /messages/.test(sql)));
    for (const query of associationQueries) {
      const plans = observed.prepare(`EXPLAIN QUERY PLAN ${query}`).all() as { detail: string }[];
      const index = /FROM\s+messages\b/i.test(query) ? 'message_run_role_order' : 'run_version_result';
      assert.ok(plans.some(plan => plan.detail.includes(index)), JSON.stringify(plans));
      assert.ok(plans.every(plan => !plan.detail.includes('USE TEMP B-TREE')), JSON.stringify(plans));
    }
    assert.equal(migrations.find(migration => migration.version === 3)?.version, 3);
    migrate(observed);
    assert.deepEqual(databaseRows(observed), before);
  } finally { observed.close(); }
});
