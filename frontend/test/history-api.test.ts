import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { VersionHistory } from '@atoms/contracts';
import { getVersionHistory, restoreVersion, VersionApiError } from '../src/api/versions';
import type { ApiOptions } from '../src/api/versions';

const json = (value: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(value), { status, headers });
const rejects = (promise: Promise<unknown>, kind: VersionApiError['kind']) => assert.rejects(promise,
  error => error instanceof VersionApiError && error.kind === kind && !error.message.includes('PRIVATE_SENTINEL'));
function fixture() {
  const projectId = randomUUID(); const targetId = randomUUID(); const expected = randomUUID(); const at = new Date().toISOString();
  const generated = (sequence: number): VersionHistory['items'][number] => ({ id: randomUUID(), sequence, parentVersionId: expected,
    kind: 'generated', createdAt: at, isCurrent: false, runId: randomUUID(),
    request: { messageId: randomUUID(), excerpt: 'Request excerpt', truncated: true },
    summary: { source: 'stored', text: 'Stored summary' }, changedFiles: ['/src/App.tsx'] });
  const page: VersionHistory = { projectId, currentVersionId: targetId, items: [
    { ...generated(3), id: targetId, isCurrent: true }, generated(2),
  ], nextBeforeSequence: 2 };
  const restored = { projectId, currentVersionId: targetId, updatedAt: at, alreadyCurrent: false };
  return { projectId, targetId, expected, page, restored, generated };
}

test('history defaults to 20, validates 1..50 and preserves exclusive zero/max-safe cursors without prefetch', async () => {
  const f = fixture(); const calls: { url: string; init: RequestInit | undefined }[] = [];
  const transport: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return json({ ...f.page, items: [], nextBeforeSequence: null });
  };
  await getVersionHistory(f.projectId, { transport });
  for (const limit of [1, 20, 50]) await getVersionHistory(f.projectId, { limit, beforeSequence: Number.MAX_SAFE_INTEGER, transport });
  await getVersionHistory(f.projectId, { beforeSequence: 0, transport });
  assert.deepEqual(calls.map(call => call.url), [
    `/api/projects/${f.projectId}/versions?limit=20`,
    ...[1, 20, 50].map(limit => `/api/projects/${f.projectId}/versions?limit=${limit}&beforeSequence=${Number.MAX_SAFE_INTEGER}`),
    `/api/projects/${f.projectId}/versions?limit=20&beforeSequence=0`,
  ]);
  for (const { init } of calls) {
    assert.equal(init?.method, 'GET'); assert.equal(init?.credentials, 'same-origin'); assert.equal(init?.cache, 'no-store');
    assert.equal(init?.body, undefined); assert.ok(init?.signal instanceof AbortSignal);
    assert.equal(new Headers(init?.headers).get('cookie'), null);
  }
  for (const limit of [0, 51, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await rejects(getVersionHistory(f.projectId, { limit, transport }), 'invalid');
  }
  for (const beforeSequence of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await rejects(getVersionHistory(f.projectId, { beforeSequence, transport }), 'invalid');
  }
  assert.equal(calls.length, 5);
});

test('history parses shared metadata, strips unknown fields, and accepts template and legacy fallback entries', async () => {
  const f = fixture();
  const template: VersionHistory['items'][number] = { id: f.expected, sequence: 0, parentVersionId: null, kind: 'template',
    createdAt: f.restored.updatedAt, isCurrent: false, runId: null, request: null, summary: { source: 'fallback', text: 'Template' }, changedFiles: [] };
  const page = { ...f.page, items: [...f.page.items, template], nextBeforeSequence: null };
  assert.deepEqual(await getVersionHistory(f.projectId, { transport: async () => json({ ...page, snapshot: 'PRIVATE_SENTINEL',
    items: page.items.map(item => ({ ...item, files: 'PRIVATE_SENTINEL' })) }) }), page);
  const legacy = { ...f.generated(1), runId: null, request: null, summary: { source: 'fallback', text: 'Legacy version' } };
  assert.equal((await getVersionHistory(f.projectId, { transport: async () => json({ ...f.page, items: [legacy], nextBeforeSequence: null }) })).items.length, 1);
  assert.deepEqual(await getVersionHistory(f.projectId, { limit: 2, beforeSequence: 4, transport: async () => json(f.page) }), f.page);
  const full = { ...f.page, items: Array.from({ length: 50 }, (_, index) => f.generated(51 - index)), nextBeforeSequence: 2 };
  assert.deepEqual(await getVersionHistory(f.projectId, { limit: 50, transport: async () => json(full) }), full);
  await rejects(getVersionHistory(f.projectId, { limit: 50, transport: async () => json({ ...full, items: [...full.items, f.generated(1)], nextBeforeSequence: 1 }) }), 'invalid');
});

test('history rejects project/count/cursor, ordering, duplicate, current and parent association violations', async () => {
  const f = fixture(); const first = f.page.items[0]; const second = f.page.items[1]; assert.ok(first && second);
  const invalid = [
    { ...f.page, projectId: randomUUID() },
    { ...f.page, items: [first, second, f.generated(1)] },
    { ...f.page, items: [first], nextBeforeSequence: 3 },
    { ...f.page, nextBeforeSequence: 1 },
    { ...f.page, items: [], nextBeforeSequence: 2 },
    { ...f.page, items: [second, first], nextBeforeSequence: null },
    { ...f.page, items: [first, { ...second, sequence: 3 }], nextBeforeSequence: null },
    { ...f.page, items: [first, { ...second, id: first.id }] },
    { ...f.page, items: [{ ...first, isCurrent: false }, second] },
    { ...f.page, items: [first, { ...second, parentVersionId: first.id }] },
    { ...f.page, items: [{ ...first, parentVersionId: first.id }, second] },
    { ...f.page, items: [{ ...first, runId: null }, second] },
    { ...f.page, items: [{ ...first, changedFiles: ['/src/z.ts', '/src/a.ts'] }, second] },
    { ...f.page, items: [{ ...first, request: { ...first.request, excerpt: 'x'.repeat(241) } }, second] },
    { ...f.page, items: [{ ...first, kind: 'template' }, second] },
  ];
  for (const page of invalid) await rejects(getVersionHistory(f.projectId, { limit: 2, transport: async () => json(page) }), 'invalid');
  for (const beforeSequence of [0, 2, 3]) {
    await rejects(getVersionHistory(f.projectId, { limit: 2, beforeSequence, transport: async () => json(f.page) }), 'invalid');
  }
});

test('restore sends only strict expected payload and validates idempotent/template/branch responses without detail reads', async () => {
  const f = fixture(); let calls = 0;
  for (const alreadyCurrent of [false, true]) {
    const restored = { ...f.restored, alreadyCurrent };
    assert.deepEqual(await restoreVersion(f.projectId, f.targetId, f.expected, { transport: async (url, init) => {
      calls++; assert.equal(String(url), `/api/projects/${f.projectId}/versions/${f.targetId}/restore`);
      assert.equal(init?.method, 'POST'); assert.equal(init?.credentials, 'same-origin'); assert.equal(init?.cache, 'no-store');
      assert.equal(new Headers(init?.headers).get('content-type'), 'application/json');
      assert.equal(new Headers(init?.headers).get('cookie'), null);
      assert.deepEqual(JSON.parse(String(init?.body)), { expectedCurrentVersionId: f.expected });
      return json({ ...restored, unknown: 'PRIVATE_SENTINEL' });
    } }), restored);
  }
  assert.equal(calls, 2);
  for (const [projectId, targetId, expected] of [['invalid', f.targetId, f.expected], [f.projectId, 'invalid', f.expected], [f.projectId, f.targetId, 'invalid']]) {
    assert.ok(projectId && targetId && expected);
    await assert.rejects(restoreVersion(projectId, targetId, expected, { transport: async () => { calls++; return json(f.restored); } }));
  }
  assert.equal(calls, 2);
});

test('restore rejects mismatched project/target and invalid required confirmation fields', async () => {
  const f = fixture();
  for (const value of [{}, { ...f.restored, projectId: randomUUID() }, { ...f.restored, currentVersionId: f.expected },
    { ...f.restored, updatedAt: 'yesterday' }, { ...f.restored, alreadyCurrent: 'true' },
    { ...f.restored, updatedAt: undefined }, { ...f.restored, alreadyCurrent: undefined }]) {
    await rejects(restoreVersion(f.projectId, f.targetId, f.expected, { transport: async () => json(value) }), 'invalid');
  }
});

for (const endpoint of ['history', 'restore'] as const) {
  test(`${endpoint} classifies safe HTTP errors, preserves status/retry hints, and never retries or exposes backend text`, async () => {
    const f = fixture(); const request = (options: ApiOptions) => endpoint === 'history' ? getVersionHistory(f.projectId, options)
      : restoreVersion(f.projectId, f.targetId, f.expected, options);
    const messages = new Map<string, string>(); let calls = 0;
    for (const [status, code] of [[400, 'INVALID_INPUT'], [401, 'SESSION_REQUIRED'], [403, 'ORIGIN_NOT_ALLOWED'], [404, 'NOT_FOUND'],
      [409, 'CURRENT_VERSION_CONFLICT'], [409, 'PROJECT_BUSY'], [409, 'VERSION_NOT_RESTORABLE'], [413, 'BODY_TOO_LARGE'],
      [415, 'JSON_REQUIRED'], [429, 'RATE_LIMITED'], [500, 'DATA_CORRUPT'], [503, 'STORAGE_UNAVAILABLE'],
      [503, 'RUN_STATE_UNCONFIRMED'], [503, 'PRIVATE_SENTINEL']] as const) {
      await assert.rejects(request({ transport: async () => { calls++; return json({ error: { code, message: 'PRIVATE_SENTINEL' }, requestId: 'PRIVATE_SENTINEL' }, status, { 'retry-after': '999' }); } }), error => {
        assert.ok(error instanceof VersionApiError); assert.equal(error.kind, 'http'); assert.equal(error.status, status);
        assert.equal(error.retryAfter, 150); assert.ok(!error.message.includes('PRIVATE_SENTINEL'));
        if (['CURRENT_VERSION_CONFLICT', 'PROJECT_BUSY', 'RUN_STATE_UNCONFIRMED', 'STORAGE_UNAVAILABLE'].includes(code)) {
          assert.equal(error.code, code); messages.set(code, error.message);
        }
        if (code === 'PRIVATE_SENTINEL') assert.equal(error.code, null);
        return true;
      });
    }
    assert.equal(new Set(messages.values()).size, 4); assert.equal(calls, 14);
    await assert.rejects(request({ transport: async () => json({ message: 'PRIVATE_SENTINEL' }, 401) }),
      error => error instanceof VersionApiError && error.status === 401 && error.code === 'SESSION_REQUIRED' && !error.message.includes('PRIVATE_SENTINEL'));
  });

  test(`${endpoint} rejects bad JSON/UTF-8 and safely classifies network failures`, async () => {
    const f = fixture(); const request = (options: ApiOptions) => endpoint === 'history' ? getVersionHistory(f.projectId, options)
      : restoreVersion(f.projectId, f.targetId, f.expected, options);
    for (const status of [200, 401, 404, 503]) {
      for (const body of ['<html>PRIVATE_SENTINEL</html>', new Uint8Array([0xff])]) {
        await assert.rejects(request({ transport: async () => new Response(body, { status, headers: { 'retry-after': '5' } }) }), error => {
          assert.ok(error instanceof VersionApiError);
          assert.equal(error.kind, status === 200 ? 'invalid' : 'http');
          assert.equal(error.status, status === 200 ? null : status);
          if (status !== 200) assert.equal(error.retryAfter, 5);
          assert.ok(!error.message.includes('PRIVATE_SENTINEL')); return true;
        });
      }
    }
    await rejects(request({ transport: async () => { throw new Error('PRIVATE_SENTINEL'); } }), 'network');
  });

  test(`${endpoint} enforces raw declared/streamed byte caps for success and errors, cancelling rejected bodies`, async () => {
    const f = fixture(); const request = (options: ApiOptions) => endpoint === 'history' ? getVersionHistory(f.projectId, options)
      : restoreVersion(f.projectId, f.targetId, f.expected, options);
    const value = endpoint === 'history' ? { ...f.page, nextBeforeSequence: null } : f.restored;
    for (const status of [200, 503]) {
      const max = endpoint === 'restore' ? 16 * 1024 : status === 200 ? 1024 * 1024 : 64 * 1024;
      const check = (error: unknown) => {
        assert.ok(error instanceof VersionApiError); assert.equal(error.kind, status === 200 ? 'tooLarge' : 'http');
        assert.equal(error.status, status === 200 ? null : status); return true;
      };
      await assert.rejects(request({ responseLimit: 32 * 1024 * 1024, transport: async () => new Response('{}', { status, headers: { 'content-length': String(max + 1) } }) }), check);
      let cancelled = false;
      await assert.rejects(request({ transport: async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new TextEncoder().encode(' '.repeat(max + 1))); }, cancel() { cancelled = true; },
      }), { status }) }), check);
      assert.equal(cancelled, true);
    }
    const max = endpoint === 'history' ? 1024 * 1024 : 16 * 1024;
    const text = JSON.stringify(value); const atLimit = text + ' '.repeat(max - new TextEncoder().encode(text).length);
    assert.deepEqual(await request({ transport: async () => new Response(atLimit) }), value);
    await rejects(request({ transport: async () => new Response(atLimit + ' ') }), 'tooLarge');
    const multiByte = JSON.stringify({ ...value, ignored: '\u4e2d'.repeat(Math.floor(max / 3)) });
    assert.ok(multiByte.length < max);
    await rejects(request({ transport: async () => new Response(multiByte) }), 'tooLarge');
  });

  test(`${endpoint} rejects 401 at headers and cancels stalled or oversized bodies without waiting for cancellation`, async () => {
    const f = fixture(); const request = (options: ApiOptions) => endpoint === 'history' ? getVersionHistory(f.projectId, options)
      : restoreVersion(f.projectId, f.targetId, f.expected, options);
    for (const oversized of [false, true]) {
      let cancelled = false; let calls = 0;
      await assert.rejects(request({ timeoutMs: 50, transport: async () => {
        calls++;
        return new Response(new ReadableStream<Uint8Array>({
          cancel() { cancelled = true; return new Promise(() => {}); },
        }), { status: 401, headers: oversized ? { 'content-length': String(2 * 1024 * 1024) } : {} });
      } }), error => error instanceof VersionApiError && error.kind === 'http' && error.status === 401 && error.code === 'SESSION_REQUIRED');
      assert.equal(cancelled, true); assert.equal(calls, 1);
    }
  });

  test(`${endpoint} preserves 404 for declared/streamed overflow and interrupted error bodies`, async () => {
    const f = fixture(); const request = (options: ApiOptions) => endpoint === 'history' ? getVersionHistory(f.projectId, options)
      : restoreVersion(f.projectId, f.targetId, f.expected, options);
    for (const mode of ['declared', 'streamed', 'interrupted'] as const) {
      let cancelled = false;
      const response = new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          if (mode === 'streamed') controller.enqueue(new Uint8Array(65 * 1024));
          if (mode === 'interrupted') controller.error(new Error('PRIVATE_SENTINEL'));
        }, cancel() { cancelled = true; },
      }), { status: 404, headers: { 'retry-after': '7', ...(mode === 'declared' ? { 'content-length': String(65 * 1024) } : {}) } });
      await assert.rejects(request({ transport: async () => response }), error => error instanceof VersionApiError && error.kind === 'http' &&
        error.status === 404 && error.retryAfter === 7 && !error.message.includes('PRIVATE_SENTINEL'));
      if (mode !== 'interrupted') assert.equal(cancelled, true);
    }
  });

  test(`${endpoint} bounds fetch/body waits, handles pre/mid-request abort and fences late responses`, async () => {
    const f = fixture(); const request = (options: ApiOptions) => endpoint === 'history' ? getVersionHistory(f.projectId, options)
      : restoreVersion(f.projectId, f.targetId, f.expected, options);
    let calls = 0; const pre = new AbortController(); pre.abort();
    await rejects(request({ signal: pre.signal, transport: async () => { calls++; return json({}); } }), 'cancelled');
    assert.equal(calls, 0);
    await rejects(request({ timeoutMs: 10, transport: async () => new Promise(() => {}) }), 'timeout');
    for (const mode of ['cancel', 'timeout'] as const) {
      const controller = new AbortController(); let cancelled = false;
      const operation = request({ signal: controller.signal, timeoutMs: mode === 'timeout' ? 10 : 1000,
        transport: async () => new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled = true; return new Promise(() => {}); } })) });
      if (mode === 'cancel') { await delay(1); controller.abort(); }
      await rejects(operation, mode === 'cancel' ? 'cancelled' : 'timeout'); assert.equal(cancelled, true);
    }
    let release: (value: Response) => void = () => {}; let cancelled = false;
    const late = request({ timeoutMs: 10, transport: async () => new Promise<Response>(resolve => { release = resolve; }) });
    await rejects(late, 'timeout');
    release(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
    await delay(1); assert.equal(cancelled, true);
  });
}

test('history decodes multi-byte UTF-8 across byte boundaries without changing excerpts', async () => {
  const f = fixture(); const first = f.page.items[0]; assert.ok(first);
  const page = { ...f.page, items: [{ ...first, summary: { source: 'stored', text: '\u4e2d\u6587\ud83d\ude42' } }], nextBeforeSequence: null };
  const bytes = new TextEncoder().encode(JSON.stringify(page)); let offset = 0;
  assert.deepEqual(await getVersionHistory(f.projectId, { transport: async () => new Response(new ReadableStream<Uint8Array>({
    pull(controller) { if (offset < bytes.length) controller.enqueue(bytes.slice(offset, ++offset)); else controller.close(); },
  })) }), page);
});
