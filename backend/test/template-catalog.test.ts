import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { errorSchema, projectDetailSchema, sessionResponseSchema, snapshotSchema, templateListSchema } from '../src/contracts/projects.js';
import type { Snapshot } from '../src/contracts/projects.js';
import { createFileTools } from '../src/generation/policy.js';
import { generateProject } from '../src/generation/service.js';
import { openStore } from '../src/storage/store.js';
import { canonicalJSON, templateIdentities } from '../src/template-assets/bundle.mjs';
import { createCatalog, loadCatalog } from '../src/templates/catalog.js';
import { generationCall } from './helpers/generation.js';
import { fixtureEnv, startFixture } from './helpers/model-fixture.js';

const ids = ['company-landing', 'brand-store', 'personal-portfolio'];
const origin = 'http://127.0.0.1:5173';

function signedSnapshot(value: Snapshot): Snapshot {
  const { digest: previous, ...content } = value;
  void previous;
  return snapshotSchema.parse({ ...content, digest: createHash('sha256').update(canonicalJSON(content)).digest('hex') });
}

test('default catalog lists all three templates in order and resolves independent complete snapshots', async () => {
  const catalog = await loadCatalog();
  const listing = catalog.list();
  assert.deepEqual(templateIdentities.map(identity => identity.id), ids);
  assert.deepEqual(listing.items.map(item => item.id), ids);
  const snapshots = listing.items.map(item => catalog.resolve(item.id, item.version, item.digest));
  assert.equal(new Set(snapshots.map(snapshot => snapshot.digest)).size, 3);
  for (const [index, snapshot] of snapshots.entries()) {
    const identity = templateIdentities[index];
    assert.ok(identity);
    assert.deepEqual(snapshotSchema.parse(snapshot), snapshot);
    assert.deepEqual(snapshot.source, identity.source);
    assert.deepEqual(snapshot.dependencies, identity.dependencies);
    assert.equal(snapshot.entry, identity.entry);
    const original = structuredClone(snapshot);
    const another = catalog.resolve(snapshot.id, snapshot.version, snapshot.digest);
    assert.notStrictEqual(another.files, snapshot.files);
    snapshot.files['/src/App.tsx'] = 'mutated caller copy';
    snapshot.source.repository = 'https://invalid.example/caller';
    snapshot.dependencies['react'] = '0.0.0';
    assert.deepEqual(another, original);
    assert.deepEqual(catalog.resolve(original.id, original.version, original.digest), original);
    assert.deepEqual(catalog.list(), listing);
  }
  listing.items.reverse();
  assert.deepEqual(catalog.list().items.map(item => item.id), ids);
});

test('catalog rejects empty, duplicate and unknown identities and version/digest conflicts', async () => {
  const catalog = await loadCatalog();
  assert.throws(() => createCatalog([]), { code: 'INVALID_CONFIGURATION' });
  for (const item of catalog.list().items) {
    const snapshot = catalog.resolve(item.id, item.version, item.digest);
    assert.throws(() => createCatalog([snapshot, structuredClone(snapshot)]), { code: 'INVALID_CONFIGURATION' });
    const unknown = signedSnapshot({ ...snapshot, id: 'unknown-template' });
    assert.throws(() => createCatalog([unknown]), { code: 'INVALID_CONFIGURATION' });
    assert.throws(() => catalog.resolve(item.id, item.version + 1, item.digest), { code: 'TEMPLATE_CONFLICT' });
    assert.throws(() => catalog.resolve(item.id, item.version, '0'.repeat(64)), { code: 'TEMPLATE_CONFLICT' });
    assert.throws(() => catalog.resolve('unknown-template', item.version, item.digest), { code: 'NOT_FOUND' });
    assert.throws(() => createCatalog([{ ...snapshot, digest: '0'.repeat(64) }]));
  }
});

test('catalog and storage reject self-consistent snapshots that disagree with trusted template metadata', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'atoms catalog trust '));
  const store = openStore(join(directory, 'test.sqlite'));
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  const session = store.createSession();
  const catalog = await loadCatalog();
  const mutations: [string, (snapshot: Snapshot) => void][] = [
    ['name', snapshot => { snapshot.name += ' forged'; }],
    ['category', snapshot => { snapshot.category = 'forged-category'; }],
    ['version', snapshot => { snapshot.version++; }],
    ['entry', snapshot => {
      snapshot.entry = '/src/App.tsx';
      const pkg = JSON.parse(snapshot.files['/package.json'] ?? '') as Record<string, unknown>;
      snapshot.files['/package.json'] = JSON.stringify({ ...pkg, main: snapshot.entry });
    }],
    ['repository', snapshot => { snapshot.source.repository = 'https://invalid.example/forged'; }],
    ['commit', snapshot => { snapshot.source.commit = '0'.repeat(40); }],
    ['dependencies', snapshot => {
      snapshot.dependencies['react'] = '18.3.0';
      const pkg = JSON.parse(snapshot.files['/package.json'] ?? '') as Record<string, unknown>;
      snapshot.files['/package.json'] = JSON.stringify({ ...pkg, dependencies: snapshot.dependencies });
    }],
  ];
  for (const item of catalog.list().items) {
    const snapshot = catalog.resolve(item.id, item.version, item.digest);
    for (const [field, mutate] of mutations) {
      const changed = structuredClone(snapshot);
      mutate(changed);
      // Re-sign and validate first so rejection exercises catalog trust, not a stale digest.
      const forged = signedSnapshot(changed);
      assert.throws(() => createCatalog([forged]), `${item.id}: ${field}`);
      assert.throws(() => store.createProject(session.id, 'Forged template', forged), `${item.id}: ${field}`);
    }
    const unknown = signedSnapshot({ ...snapshot, id: 'unknown-template' });
    assert.throws(() => store.createProject(session.id, 'Unknown template', unknown), { code: 'TEMPLATE_CONFLICT' });
  }
  assert.deepEqual(store.listProjects(session.id, 20), { items: [], nextCursor: null });
});

test('HTTP lists the real catalog, creates each template and preserves all identities after app/SQLite reopen', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'atoms catalog HTTP '));
  const filename = join(directory, 'test.sqlite');
  let app = buildApp({ logger: false }, { store: openStore(filename), catalog: await loadCatalog(), origins: [origin], secureCookies: false,
    limits: { projectsPerMinute: 30 } });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const response = await app.inject('/api/templates');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['set-cookie'], undefined);
  const listing = templateListSchema.parse(response.json());
  assert.deepEqual(listing.items.map(item => item.id), ids);
  assert.ok(listing.items.every(item => !Object.hasOwn(item, 'files')));
  const session = await app.inject({ method: 'POST', url: '/api/session', headers: { origin }, payload: {} });
  assert.equal(session.statusCode, 201);
  sessionResponseSchema.parse(session.json());
  assert.equal(typeof session.headers['set-cookie'], 'string');
  const cookie = String(session.headers['set-cookie']).split(';')[0] ?? '';
  const catalog = await loadCatalog();
  const created = [];
  for (const item of listing.items) {
    const payload = { title: `Catalog ${item.id}`, templateId: item.id, templateVersion: item.version, templateDigest: item.digest };
    for (const [patch, status, code] of [
      [{ templateVersion: item.version + 1 }, 409, 'TEMPLATE_CONFLICT'],
      [{ templateDigest: '0'.repeat(64) }, 409, 'TEMPLATE_CONFLICT'],
      [{ templateId: 'unknown-template' }, 404, 'NOT_FOUND'],
    ] as const) {
      const rejected = await app.inject({ method: 'POST', url: '/api/projects', headers: { origin, cookie }, payload: { ...payload, ...patch } });
      assert.equal(rejected.statusCode, status, rejected.body);
      assert.equal(errorSchema.parse(rejected.json()).error.code, code);
    }
    const result = await app.inject({ method: 'POST', url: '/api/projects', headers: { origin, cookie }, payload });
    assert.equal(result.statusCode, 201, result.body);
    const detail = projectDetailSchema.parse(result.json());
    assert.equal(detail.project.templateId, item.id);
    assert.equal(detail.project.templateVersion, item.version);
    assert.equal(detail.project.templateDigest, item.digest);
    assert.equal(detail.currentVersion.kind, 'template');
    assert.equal(detail.currentVersion.sequence, 0);
    assert.equal(detail.latestRun, null);
    assert.deepEqual(detail.currentVersion.snapshot, catalog.resolve(item.id, item.version, item.digest));
    created.push(detail);
  }
  assert.equal((await app.inject({ url: '/api/projects', headers: { cookie } })).json<{ items: unknown[] }>().items.length, 3);
  await app.close();
  app = buildApp({ logger: false }, { store: openStore(filename), catalog: await loadCatalog(), origins: [origin], secureCookies: false });
  assert.deepEqual((await app.inject('/api/templates')).json(), listing);
  const reused = await app.inject({ method: 'POST', url: '/api/session', headers: { origin, cookie }, payload: {} });
  assert.equal(reused.statusCode, 200);
  assert.deepEqual(reused.json(), session.json());
  for (const detail of created) {
    const reopened = await app.inject({ url: `/api/projects/${detail.project.id}`, headers: { cookie } });
    assert.equal(reopened.statusCode, 200, reopened.body);
    assert.deepEqual(projectDetailSchema.parse(reopened.json()), detail);
  }
});

for (const change of [
  { id: 'brand-store', path: '/src/components/Navbar.tsx', before: 'Considered goods. Everyday living.', after: 'Thoughtful goods. Made for your everyday.' },
  { id: 'personal-portfolio', path: '/src/components/Hero.tsx', before: 'TO EXPLORE', after: 'VIEW MY WORK' },
]) {
  test(`${change.id}: file tools read/submit business edits and reject protected paths and unknown template IDs`, async () => {
    const catalog = await loadCatalog();
    const item = catalog.list().items.find(item => item.id === change.id);
    assert.ok(item);
    const base = catalog.resolve(item.id, item.version, item.digest);
    const source = base.files[change.path];
    assert.ok(source);
    assert.ok(source.includes(change.before));
    const content = source.replace(change.before, change.after);
    const tools = createFileTools(base);
    assert.equal(tools.list({}).files.find(file => file.path === change.path)?.writable, true);
    assert.deepEqual(tools.read({ paths: [change.path] }).files, [{ path: change.path, content: source }]);
    const candidate = tools.submit({ files: [{ path: change.path, content }] });
    assert.deepEqual(candidate.changedFiles, [change.path]);
    assert.deepEqual(candidate.snapshot, signedSnapshot({ ...base, files: { ...base.files, [change.path]: content } }));
    for (const path of [base.entry, '/src/styles.css', '/package.json', '/LICENSE', '/public/index.html']) {
      const guarded = createFileTools(base);
      assert.equal(guarded.list({}).files.find(file => file.path === path)?.writable, false);
      guarded.read({ paths: [path] });
      assert.throws(() => guarded.submit({ files: [{ path, content: `${base.files[path]}\n// forbidden change` }] }), { code: 'FILE_POLICY' });
    }
    assert.throws(() => createFileTools(signedSnapshot({ ...base, id: 'unknown-template' })), { code: 'UNSUPPORTED_TEMPLATE' });
    assert.deepEqual(catalog.resolve(item.id, item.version, item.digest), base);
  });

  test(`${change.id}: actual SDK generation saves a business edit as an unverified candidate without adoption and survives reopen`, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'atoms catalog generation '));
    const filename = join(directory, 'test.sqlite');
    let store = openStore(filename);
    t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
    const catalog = await loadCatalog();
    const item = catalog.list().items.find(item => item.id === change.id);
    assert.ok(item);
    const base = catalog.resolve(item.id, item.version, item.digest);
    const source = base.files[change.path];
    assert.ok(source);
    assert.ok(source.includes(change.before));
    const content = source.replace(change.before, change.after);
    const session = store.createSession();
    const detail = store.createProject(session.id, 'SDK catalog fixture', base);
    const input = { sessionId: session.id, projectId: detail.project.id, baseVersionId: detail.currentVersion.id,
      requestId: randomUUID(), prompt: `Change the visible text ${change.before} to ${change.after}.` };
    const fixture = await startFixture((_, res, index) => {
      const call = index === 1 ? generationCall('list_files', {}, index)
        : index === 2 ? generationCall('read_files', { paths: [change.path] }, index)
          : generationCall('submit_files', { files: [{ path: change.path, content }] }, index);
      res.end(JSON.stringify(call));
    });
    try {
      const result = await generateProject(input, { store, env: { ...fixtureEnv, MODEL_TIMEOUT_MS: '5000' }, transport: fixture.transport });
      assert.equal(result.status, 'succeeded', JSON.stringify(result));
      assert.equal(result.previewStatus, 'unverified');
      assert.equal(result.terminalStatePersisted, true);
      assert.equal(result.metrics.requestCount, 3);
      assert.equal(fixture.requests.length, 3);
      assert.deepEqual(result.changedFiles, [change.path]);
      assert.ok(result.candidateVersionId);
      const outputs = fixture.requests[2]?.input.filter(value => value['type'] === 'function_call_output') ?? [];
      assert.ok(outputs.some(value => {
        const read = JSON.parse(String(value['output'])) as { files?: { path: string; content: string }[] };
        return read.files?.some(file => file.path === change.path && file.content === source);
      }));
      const saved = store.inspectGeneration(input);
      assert.ok(saved?.candidateVersion);
      assert.equal(saved.run.status, 'succeeded');
      assert.equal(saved.candidateVersion.id, result.candidateVersionId);
      assert.equal(saved.candidateVersion.parentVersionId, detail.currentVersion.id);
      assert.equal(saved.candidateVersion.kind, 'generated');
      assert.equal(saved.candidateVersion.sequence, 1);
      assert.deepEqual(saved.candidateVersion.snapshot, signedSnapshot({ ...base, files: { ...base.files, [change.path]: content } }));
      assert.deepEqual(store.getProject(session.id, detail.project.id).currentVersion, detail.currentVersion);
      const messages = store.listMessages(session.id, detail.project.id, 0, 20);
      assert.deepEqual(messages.items.map(message => message.role), ['user', 'assistant']);
      assert.equal(messages.items[0]?.content, input.prompt);
      assert.ok(messages.items[1]?.content.includes(change.path));
      store.close();
      store = openStore(filename);
      assert.deepEqual(store.inspectGeneration(input), saved);
      assert.deepEqual(store.getProject(session.id, detail.project.id).currentVersion, detail.currentVersion);
      assert.deepEqual(store.listMessages(session.id, detail.project.id, 0, 20), messages);
    } finally { await fixture.close(); }
  });
}
