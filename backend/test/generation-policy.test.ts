import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { generationInputSchema } from '../src/generation/contracts.js';
import { buildContext, checkContext } from '../src/generation/context.js';
import { createFileTools, writable } from '../src/generation/policy.js';
import { snapshotSchema } from '../src/contracts/projects.js';
import type { Snapshot, Message } from '../src/contracts/projects.js';
import { canonicalJSON } from '../src/template-assets/bundle.mjs';
import { projectFixture } from './helpers/projects.js';

function withFiles(base: Snapshot, add: Record<string, string>): Snapshot {
  const { digest: old, ...content } = { ...base, files: { ...base.files, ...add } }; void old;
  return snapshotSchema.parse({ ...content, digest: createHash('sha256').update(canonicalJSON(content)).digest('hex') });
}

test('generation input is strict and bounded, context retains whole ordered history and one current request', async t => {
  const f = await projectFixture(t);
  const input = { sessionId: randomUUID(), projectId: randomUUID(), baseVersionId: randomUUID(), requestId: randomUUID(), prompt: ' requirement ' };
  assert.equal(generationInputSchema.parse(input).prompt, 'requirement');
  for (const change of [{ prompt: '' }, { prompt: ' ' }, { prompt: 'x'.repeat(4001) }, { prompt: '😀'.repeat(5000) }, { files: {} }, { env: {} }, { history: [] }]) {
    assert.equal(generationInputSchema.safeParse({ ...input, ...change }).success, false);
  }
  const history: Message[] = Array.from({ length: 12 }, (_, index) => ({
    id: randomUUID(), projectId: input.projectId, sequence: index + 1, role: index % 2 ? 'assistant' : 'user',
    content: `history-${index + 1}:` + 'x'.repeat(index === 11 ? 16 * 1024 : 10), runId: null, createdAt: new Date().toISOString(),
  }));
  const context = buildContext(f.bundle, 'CURRENT_REQUIREMENT_ONCE', history, history.length);
  const text = JSON.stringify(context.messages);
  assert.equal(text.split('CURRENT_REQUIREMENT_ONCE').length - 1, 1);
  assert.ok(!text.includes(history[11]?.content ?? 'never')); assert.equal(context.historyOmitted, 2);
  const actualHistory = context.messages.slice(2, -1).map(message => message.content);
  assert.deepEqual(actualHistory, history.slice(1, 11).map(message => message.content));
  assert.ok(!text.includes(f.bundle.files['/src/App.tsx'] ?? 'never'));
  assert.throws(() => checkContext([{ role: 'user', content: 'x'.repeat(256 * 1024) }]));
});

test('real company baseline policy allows only declared business/generated paths and preserves untouched bytes', async t => {
  const f = await projectFixture(t); const original = structuredClone(f.bundle);
  assert.equal(writable('/App.tsx', true), true); assert.equal(writable('/components/Example.tsx', true), true);
  const tools = createFileTools(f.bundle); const listing = tools.list({});
  assert.equal(listing.files.find(file => file.path === '/src/App.tsx')?.writable, true);
  assert.equal(listing.files.find(file => file.path === '/src/main.tsx')?.writable, false);
  tools.read({ paths: ['/src/App.tsx'] });
  const changed = (f.bundle.files['/src/App.tsx'] ?? '') + '\n// actual fixture change';
  const candidate = tools.submit({ files: [{ path: '/src/App.tsx', content: changed }, { path: '/src/generated/Quote.css', content: '.quote { color: red; }' }] });
  assert.deepEqual(candidate.changedFiles, ['/src/App.tsx', '/src/generated/Quote.css']);
  assert.notEqual(candidate.snapshot.digest, f.bundle.digest);
  for (const [path, content] of Object.entries(f.bundle.files)) if (path !== '/src/App.tsx') assert.equal(candidate.snapshot.files[path], content);
  assert.deepEqual(f.bundle, original); assert.deepEqual(candidate.snapshot.dependencies, f.bundle.dependencies);
  assert.equal(candidate.snapshot.entry, f.bundle.entry); assert.deepEqual(candidate.snapshot.source, f.bundle.source);
  assert.throws(() => tools.submit({ files: [{ path: '/src/App.tsx', content: changed }] }));
});

test('protected paths, traversal, duplicate paths, unread overwrites, blanks and no-op submits are rejected', async t => {
  const f = await projectFixture(t);
  for (const path of ['/src/main.tsx', '/src/styles.css', '/LICENSE', '/package.json', '/public/index.html', '/src/assets/logo.asset.ts',
    '/src/../App.tsx', '/src/%2e%2e/secret.ts', '/src\\App.tsx', '/src/generated/.env', '/etc/passwd', '/src/generated/bad\0.ts', '/src/generated/a.json']) {
    const tools = createFileTools(f.bundle); tools.read({ paths: ['/src/App.tsx'] });
    assert.throws(() => tools.submit({ files: [{ path, content: 'not allowed' }] }), path);
  }
  for (const input of [
    { files: [] }, { files: [{ path: '/src/App.tsx', content: '' }] },
    { files: [{ path: '/src/App.tsx', content: ' ' }] },
    { files: [{ path: '/src/App.tsx', content: f.bundle.files['/src/App.tsx'] }] },
    { files: [{ path: '/src/App.tsx', content: 'x' }, { path: '/src/App.tsx', content: 'y' }] },
    { files: [{ path: '/src/App.tsx', content: 'x', delete: true }] },
    { files: [{ path: '/src/generated/large.ts', content: '中'.repeat(90_000) }] },
  ]) { const tools = createFileTools(f.bundle); tools.read({ paths: ['/src/App.tsx'] }); assert.throws(() => tools.submit(input)); }
  const unread = createFileTools(f.bundle);
  assert.throws(() => unread.submit({ files: [{ path: '/src/generated/new.ts', content: 'export const n = 1;' }] }));
  unread.read({ paths: ['/LICENSE'] });
  assert.throws(() => unread.submit({ files: [{ path: '/src/App.tsx', content: 'unread' }] }));
  assert.throws(() => unread.read({ paths: ['/LICENSE', '/LICENSE'] }));
  assert.throws(() => unread.read({ paths: ['/not-present.ts'] }));
});

test('read/body/final snapshot limits reject whole operations without truncation', async t => {
  const f = await projectFixture(t);
  const big = withFiles(f.bundle, { '/src/generated/Large.ts': 'x'.repeat(96 * 1024 + 1) });
  const tools = createFileTools(big);
  assert.throws(() => tools.read({ paths: ['/src/generated/Large.ts'] }));
  assert.throws(() => tools.submit({ files: [{ path: '/src/generated/new.ts', content: 'x' }] }));
  const additions: Record<string, string> = {};
  for (let index = Object.keys(f.bundle.files).length; index < 64; index++) additions[`/src/generated/existing${index}.ts`] = 'export {};';
  const full = createFileTools(withFiles(f.bundle, additions)); full.read({ paths: ['/src/App.tsx'] });
  assert.throws(() => full.submit({ files: [{ path: '/src/generated/one-too-many.ts', content: 'export {};' }] }));
  const remaining = 2 * 1024 * 1024 - Object.values(f.bundle.files).reduce((sum, content) => sum + Buffer.byteLength(content), 0) - 10;
  const bytes = createFileTools(withFiles(f.bundle, { '/src/generated/Existing.ts': 'x'.repeat(remaining) }));
  bytes.read({ paths: ['/src/App.tsx'] });
  assert.throws(() => bytes.submit({ files: [{ path: '/src/generated/New.ts', content: 'x'.repeat(11) }] }));
});
