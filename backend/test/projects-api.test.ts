import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { buildApp } from '../src/app.js';
import { errorSchema, listQuerySchema, messageQuerySchema, projectDetailSchema, projectListSchema, sessionResponseSchema,
  snapshotSchema, templateListSchema, projectRequestSchema, messageInputSchema } from '../src/contracts/projects.js';
import { readPersistenceConfig } from '../src/projects/config.js';
import type { ProjectServices } from '../src/routes/projects.js';
import { changedSnapshot, projectFixture } from './helpers/projects.js';

const origin = 'http://127.0.0.1:5173';
const projectBody = (bundle: { id: string; version: number; digest: string }, title = 'Company project') => ({
  templateId: bundle.id, templateVersion: bundle.version, templateDigest: bundle.digest, title,
});
function cookieHeader(response: { headers: Record<string, unknown> }) {
  const value = response.headers['set-cookie'];
  assert.equal(typeof value, 'string');
  return String(value).split(';')[0] ?? '';
}

test('authoritative schemas reject extras, unsafe snapshots and unbounded query values; DTOs exclude internals', async t => {
  const f = await projectFixture(t);
  assert.ok(!projectRequestSchema.safeParse({ ...projectBody(f.bundle), ownerSessionId: randomUUID() }).success);
  assert.ok(!messageInputSchema.safeParse({ role: 'user', content: '中'.repeat(5462) }).success);
  for (const input of [{ limit: '0' }, { limit: '51' }, { limit: '1e1' }, { limit: '01' }, { cursor: '???' }, { cursor: Buffer.from('["bad","bad"]').toString('base64url') }, { sort: 'DROP TABLE' }]) {
    assert.equal(listQuerySchema.safeParse(input).success, false);
  }
  for (const afterSequence of ['-1', '1.5', '9007199254740992', '']) assert.equal(messageQuerySchema.safeParse({ afterSequence }).success, false);
  for (const mutation of [
    (value: typeof f.bundle) => { value.files['/src/../secret.ts'] = 'x'; },
    (value: typeof f.bundle) => { delete value.files[value.entry]; },
    (value: typeof f.bundle) => { value.dependencies['react'] = '^18.3.1'; },
    (value: typeof f.bundle) => { value.files['/src/huge.ts'] = 'x'.repeat(2 * 1024 * 1024); },
  ]) { const value = structuredClone(f.bundle); mutation(value); assert.equal(snapshotSchema.safeParse(value).success, false); }
  const session = f.store.createSession(); const detail = f.store.createProject(session.id, 'DTO', f.bundle);
  const projected = projectDetailSchema.parse({ ...detail, tokenHash: 'PRIVATE', project: { ...detail.project, ownerSessionId: session.id } });
  assert.ok(!JSON.stringify(projected).includes('PRIVATE')); assert.ok(!JSON.stringify(projected).includes(session.id));
});

test('full API sequence uses persistent sessions and isolates projects without creating fake runs', async t => {
  const f = await projectFixture(t);
  const app = buildApp({ logger: false }, { ...f, origins: [origin], secureCookies: false }); t.after(() => app.close());
  for (const url of ['/api/health', '/api/templates']) {
    const response = await app.inject(url); assert.equal(response.statusCode, 200); assert.equal(response.headers['set-cookie'], undefined);
  }
  const templates = templateListSchema.parse((await app.inject('/api/templates')).json());
  assert.equal(templates.items[0]?.digest, f.bundle.digest); assert.ok(!JSON.stringify(templates).includes('/src/main.tsx'));
  const first = await app.inject({ method: 'POST', url: '/api/session', headers: { origin }, payload: {} });
  assert.equal(first.statusCode, 201); sessionResponseSchema.parse(first.json());
  const a = cookieHeader(first);
  assert.match(String(first.headers['set-cookie']), /HttpOnly/); assert.match(String(first.headers['set-cookie']), /SameSite=Strict/);
  assert.match(String(first.headers['set-cookie']), /Path=\/api/); assert.match(String(first.headers['set-cookie']), /Max-Age=2592000/);
  const reused = await app.inject({ method: 'POST', url: '/api/session', headers: { origin, cookie: a }, payload: {} });
  assert.equal(reused.statusCode, 200); assert.deepEqual(reused.json(), first.json()); assert.equal(reused.headers['set-cookie'], undefined);
  const b = cookieHeader(await app.inject({ method: 'POST', url: '/api/session', headers: { origin }, payload: {} }));
  const created = await app.inject({ method: 'POST', url: '/api/projects', headers: { origin, cookie: a }, payload: projectBody(f.bundle, '  Kept  ') });
  assert.equal(created.statusCode, 201, created.body);
  const detail = projectDetailSchema.parse(created.json());
  assert.equal(detail.project.title, 'Kept'); assert.equal(detail.latestRun, null);
  assert.deepEqual(detail.currentVersion.snapshot, f.bundle); assert.equal(detail.currentVersion.sequence, 0);
  const url = `/api/projects/${detail.project.id}`;
  const got = await app.inject({ url, headers: { cookie: a } }); assert.deepEqual(got.json(), detail);
  assert.equal(got.headers['cache-control'], 'no-store');
  const messages = await app.inject({ url: `${url}/messages`, headers: { cookie: a } });
  assert.deepEqual(messages.json(), { items: [], nextAfterSequence: null });
  const listed = projectListSchema.parse((await app.inject({ url: '/api/projects?limit=1', headers: { cookie: a } })).json());
  assert.equal(listed.items[0]?.id, detail.project.id); assert.ok(!JSON.stringify(listed).includes('files'));
  assert.deepEqual((await app.inject({ url: '/api/projects', headers: { cookie: b } })).json(), { items: [], nextCursor: null });
  for (const suffix of ['', '/messages']) {
    const denied = await app.inject({ url: `${url}${suffix}`, headers: { cookie: b } });
    const missing = await app.inject({ url: `/api/projects/${randomUUID()}${suffix}`, headers: { cookie: b } });
    assert.equal(denied.statusCode, 404); assert.equal(missing.statusCode, 404);
    assert.deepEqual(errorSchema.parse(denied.json()).error, errorSchema.parse(missing.json()).error);
    assert.ok(!denied.body.includes(f.bundle.digest));
  }
  for (const url of ['/api/projects', `/api/projects/${detail.project.id}`, `/api/projects/${detail.project.id}/messages`]) {
    assert.equal((await app.inject(url)).statusCode, 401);
  }
  const run = f.store.createRun({ projectId: detail.project.id, requestId: randomUUID(), baseVersionId: detail.currentVersion.id,
    messages: [{ role: 'user', content: 'explicit fixture request' }] });
  f.store.saveCandidate({ projectId: detail.project.id, runId: run.id, snapshot: changedSnapshot(f.bundle),
    messages: [{ role: 'assistant', content: 'explicit fixture candidate' }] });
  const latest = projectDetailSchema.parse((await app.inject({ url, headers: { cookie: a } })).json());
  assert.equal(latest.latestRun?.status, 'succeeded'); assert.equal(latest.currentVersion.id, detail.currentVersion.id);
  const page = await app.inject({ url: `${url}/messages?limit=1`, headers: { cookie: a } });
  assert.equal(page.json<{ nextAfterSequence: number }>().nextAfterSequence, 1);
});

test('origin, JSON, strict fields, template conflicts and safe input errors leave no projects', async t => {
  const f = await projectFixture(t);
  const app = buildApp({ logger: false }, { ...f, origins: [origin], secureCookies: false }); t.after(() => app.close());
  for (const fakeOrigin of [undefined, 'https://untrusted.example', `${origin}/`]) {
    const response = await app.inject({ method: 'POST', url: '/api/session', headers: fakeOrigin ? { origin: fakeOrigin } : {}, payload: {} });
    assert.equal(response.statusCode, 403); assert.equal(response.headers['set-cookie'], undefined);
  }
  assert.equal((await app.inject({ method: 'POST', url: '/api/session', headers: { origin }, payload: { extra: true } })).statusCode, 400);
  const cookie = cookieHeader(await app.inject({ method: 'POST', url: '/api/session', headers: { origin }, payload: {} }));
  const headers = { origin, cookie };
  for (const [patch, status] of [[{ files: {} }, 400], [{ title: ' ' }, 400], [{ title: 'x'.repeat(121) }, 400],
    [{ templateVersion: 2 }, 409], [{ templateDigest: 'a'.repeat(64) }, 409], [{ templateId: 'unknown' }, 404]] as const) {
    const response = await app.inject({ method: 'POST', url: '/api/projects', headers, payload: { ...projectBody(f.bundle), ...patch } });
    assert.equal(response.statusCode, status, response.body); errorSchema.parse(response.json());
  }
  assert.equal((await app.inject({ method: 'POST', url: '/api/projects', headers: { ...headers, 'content-type': 'text/plain' }, payload: '{}' })).statusCode, 415);
  assert.equal((await app.inject({ method: 'POST', url: '/api/projects', headers, payload: { ...projectBody(f.bundle), title: 'x'.repeat(9000) } })).statusCode, 413);
  for (const url of ['/api/projects?limit=51', '/api/projects?limit=1&limit=2', '/api/projects?cursor=bad', '/api/projects/not-a-uuid']) {
    assert.equal((await app.inject({ url, headers: { cookie } })).statusCode, 400);
  }
  assert.deepEqual((await app.inject({ url: '/api/projects', headers: { cookie } })).json(), { items: [], nextCursor: null });
});

test('expired or replaced cookies never claim the old project; HTTPS origins use Secure', async t => {
  const f = await projectFixture(t); let now = Date.now();
  const app = buildApp({ logger: false }, { ...f, origins: ['https://demo.example'], secureCookies: true, now: () => now }); t.after(() => app.close());
  const origin = 'https://demo.example';
  const first = await app.inject({ method: 'POST', url: '/api/session', headers: { origin }, payload: {} });
  assert.match(String(first.headers['set-cookie']), /Secure/); const cookie = cookieHeader(first);
  const created = projectDetailSchema.parse((await app.inject({ method: 'POST', url: '/api/projects', headers: { origin, cookie }, payload: projectBody(f.bundle) })).json());
  now += 31 * 24 * 60 * 60 * 1000;
  assert.equal((await app.inject({ url: '/api/projects', headers: { cookie } })).statusCode, 401);
  const renewed = await app.inject({ method: 'POST', url: '/api/session', headers: { origin, cookie }, payload: {} });
  assert.equal(renewed.statusCode, 201); assert.notEqual(cookieHeader(renewed), cookie);
  assert.equal((await app.inject({ url: `/api/projects/${created.project.id}`, headers: { cookie: cookieHeader(renewed) } })).statusCode, 404);
});

test('rate limits ignore forged proxy headers, quotas are transactional, errors and logs are sanitized', async t => {
  const f = await projectFixture(t); let logs = '';
  const services: ProjectServices = { ...f, origins: [origin], secureCookies: false, limits: { sessionPerMinute: 2, projectsPerMinute: 4, projectsPerSession: 1 } };
  const app = buildApp({ logger: { stream: { write: (text: string) => { logs += text; } } } }, services); t.after(() => app.close());
  const first = await app.inject({ method: 'POST', url: '/api/session', headers: { origin }, payload: {} }); const cookie = cookieHeader(first);
  await app.inject({ method: 'POST', url: '/api/session', headers: { origin, 'x-forwarded-for': '198.51.100.1' }, payload: {} });
  const limited = await app.inject({ method: 'POST', url: '/api/session', headers: { origin, 'x-forwarded-for': '198.51.100.2' }, payload: {} });
  assert.equal(limited.statusCode, 429); assert.ok(Number(limited.headers['retry-after']) > 0); errorSchema.parse(limited.json());
  const created = await app.inject({ method: 'POST', url: '/api/projects', headers: { origin, cookie }, payload: projectBody(f.bundle) });
  const detail = projectDetailSchema.parse(created.json());
  assert.equal((await app.inject({ method: 'POST', url: '/api/projects', headers: { origin, cookie }, payload: projectBody(f.bundle) })).statusCode, 409);
  const sql = new Database(f.filename); t.after(() => sql.close());
  sql.exec('DROP TRIGGER versions_immutable');
  sql.prepare('UPDATE versions SET snapshot_json=? WHERE id=?').run('{"PRIVATE_CODE_SENTINEL":"bad"}', detail.currentVersion.id);
  await app.inject({ url: '/api/projects?PRIVATE_QUERY_SENTINEL', headers: { cookie } });
  const corrupt = await app.inject({ url: `/api/projects/${detail.project.id}`, headers: { cookie } });
  assert.equal(corrupt.statusCode, 500); assert.equal(errorSchema.parse(corrupt.json()).error.code, 'DATA_CORRUPT');
  const token = cookie.split('=')[1] ?? '';
  const output = `${logs}${corrupt.body}`;
  assert.ok(!output.includes(token)); assert.ok(!output.includes(f.filename));
  assert.ok(!output.includes('PRIVATE_CODE_SENTINEL')); assert.ok(!output.includes('PRIVATE_QUERY_SENTINEL'));
  assert.ok(!output.includes('SELECT ')); assert.ok(!output.includes('snapshot_json'));
});

test('storage write failures map to safe 503 and do not leave partial data', async t => {
  const f = await projectFixture(t);
  const app = buildApp({ logger: false }, { ...f, origins: [origin], secureCookies: false }); t.after(() => app.close());
  const cookie = cookieHeader(await app.inject({ method: 'POST', url: '/api/session', headers: { origin }, payload: {} }));
  const sql = new Database(f.filename); t.after(() => sql.close());
  sql.exec("CREATE TRIGGER write_failure BEFORE INSERT ON versions BEGIN SELECT RAISE(ABORT,'PRIVATE_SQL_SENTINEL'); END;");
  const response = await app.inject({ method: 'POST', url: '/api/projects', headers: { origin, cookie }, payload: projectBody(f.bundle, 'PRIVATE_TITLE_SENTINEL') });
  assert.equal(response.statusCode, 503); assert.equal(errorSchema.parse(response.json()).error.code, 'STORAGE_UNAVAILABLE');
  assert.ok(!response.body.includes('PRIVATE_'));
  assert.deepEqual(sql.prepare('SELECT count(*) AS count FROM projects').get(), { count: 0 });
});

test('origin and database configuration reject public HTTP, mixed schemes and ephemeral database paths', () => {
  for (const APP_ORIGINS of ['', '*', 'http://example.com', `${origin},https://demo.example`, 'https://demo.example/path', 'https://user:password@demo.example', 'https://demo.example/']) {
    assert.throws(() => readPersistenceConfig({ APP_ORIGINS }));
  }
  assert.equal(readPersistenceConfig({ APP_ORIGINS: 'https://demo.example' }).secureCookies, true);
  assert.equal(readPersistenceConfig({}).secureCookies, false);
  for (const DATABASE_PATH of ['', ' ', ':memory:', 'file:temporary', 'bad\0file']) assert.throws(() => readPersistenceConfig({ DATABASE_PATH }));
});
