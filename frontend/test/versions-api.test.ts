import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { snapshotSchema, snapshotDigest, versionReviewSchema } from '@atoms/contracts';
import { getProject, getVersion, adoptVersion, VersionApiError } from '../src/api/versions';

function fixture() {
  const projectId = randomUUID(); const baseId = randomUUID(); const candidateId = randomUUID();
  const dependencies = { react: '18.3.1' };
  const body = { id: 'client-fixture', version: 1, name: '显式测试夹具', category: 'test', entry: '/src/index.tsx',
    source: { repository: 'https://github.com/example/fixture', commit: 'a'.repeat(40), license: 'MIT' }, dependencies,
    files: { '/src/index.tsx': 'export const value = "中文🙂";', '/src/styles.css': 'body{}', '/public/index.html': '<div id="root"></div>',
      '/LICENSE': 'MIT License\nCopyright fixture', '/package.json': JSON.stringify({ main: '/src/index.tsx', dependencies }) } };
  const snapshot = snapshotSchema.parse({ ...body, digest: snapshotDigest(body) }); const at = new Date().toISOString();
  const version = { id: candidateId, projectId, sequence: 1, parentVersionId: baseId, kind: 'generated', snapshot, createdAt: at };
  const review = { version, successfulRun: { id: randomUUID(), projectId, requestId: randomUUID(), baseVersionId: baseId,
    resultVersionId: candidateId, status: 'succeeded', errorCode: null, startedAt: at, finishedAt: at }, changedFiles: ['/src/index.tsx'], currentVersionId: baseId, adoptionAvailability: 'eligible' };
  const project = { project: { id: projectId, title: 'fixture', templateId: body.id, templateVersion: 1, templateDigest: snapshot.digest,
    currentVersionId: candidateId, createdAt: at, updatedAt: at }, currentVersion: version, latestRun: review.successfulRun };
  return { projectId, baseId, candidateId, review, project, at };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const rejects = (promise: Promise<unknown>, kind: VersionApiError['kind']) => assert.rejects(promise, error => error instanceof VersionApiError && error.kind === kind);
test('version/project/adoption clients share schemas, use relative API and send only expected base with cookie policy', async () => {
  const f = fixture(); const calls: { url: string; init: RequestInit | undefined }[] = [];
  const transport: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return json(String(url).endsWith('/adopt') ? { projectId: f.projectId, currentVersionId: f.candidateId, updatedAt: f.at, alreadyCurrent: false }
      : String(url).includes('/versions/') ? f.review : f.project);
  };
  assert.deepEqual(await getVersion(f.projectId, f.candidateId, { transport }), versionReviewSchema.parse(f.review));
  assert.equal((await getProject(f.projectId, { transport })).project.id, f.projectId);
  assert.equal((await adoptVersion(f.projectId, f.candidateId, f.baseId, { transport })).currentVersionId, f.candidateId);
  for (const call of calls) { assert.ok(call.url.startsWith('/api/projects/')); assert.equal(call.init?.credentials, 'same-origin'); assert.equal(call.init?.cache, 'no-store'); }
  assert.deepEqual(JSON.parse(String(calls[2]?.init?.body)), { expectedCurrentVersionId: f.baseId });
  assert.equal(new Headers(calls[2]?.init?.headers).get('cookie'), null);
});
test('strict schema, association, snapshot structure/digest and invalid JSON fail before use', async () => {
  const f = fixture();
  for (const value of [{}, { ...f.review, version: { ...f.review.version, id: randomUUID() } },
    { ...f.review, version: { ...f.review.version, snapshot: { ...f.review.version.snapshot, digest: '0'.repeat(64) } } },
    { ...f.review, successfulRun: { ...f.review.successfulRun, projectId: randomUUID() } }]) {
    await rejects(getVersion(f.projectId, f.candidateId, { transport: async () => json(value) }), 'invalid');
  }
  await rejects(getVersion(f.projectId, f.candidateId, { transport: async () => new Response('<html>invalid</html>') }), 'invalid');
  await rejects(getVersion(f.projectId, f.candidateId, { transport: async () => new Response(new Uint8Array([0xff])) }), 'invalid');
  await rejects(getProject(f.projectId, { transport: async () => json({ ...f.project, project: { ...f.project.project, id: randomUUID() } }) }), 'invalid');
  await rejects(adoptVersion(f.projectId, f.candidateId, f.baseId, { transport: async () => json({ projectId: f.projectId, currentVersionId: randomUUID(), updatedAt: f.at, alreadyCurrent: false }) }), 'invalid');
});
test('HTTP errors are bounded plain text and do not execute HTML', async () => {
  const f = fixture();
  await assert.rejects(getVersion(f.projectId, f.candidateId, { transport: async () => json({ error: { code: 'NOT_FOUND', message: '<img src=x onerror=alert(1)>' }, requestId: 'fixture' }, 404) }),
    error => error instanceof VersionApiError && error.status === 404 && error.message === '<img src=x onerror=alert(1)>');
  await assert.rejects(getVersion(f.projectId, f.candidateId, { transport: async () => new Response('x'.repeat(65 * 1024), { status: 503 }) }),
    error => error instanceof VersionApiError && error.kind === 'http' && error.status === 503);
});
test('16 MiB response cap enforces declared and streamed bytes, cancelling body', async () => {
  const f = fixture();
  await rejects(getVersion(f.projectId, f.candidateId, { transport: async () => new Response('{}', { headers: { 'content-length': String(16 * 1024 * 1024 + 1) } }) }), 'tooLarge');
  let cancelled = false; let count = 0;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { if (count++ < 100) controller.enqueue(new Uint8Array(1024 * 1024)); else controller.close(); }, cancel() { cancelled = true; } });
  await rejects(getVersion(f.projectId, f.candidateId, { transport: async () => new Response(stream) }), 'tooLarge'); assert.equal(cancelled, true);
});
test('pre-abort performs no transport, timeouts/cancellation bound noncooperative fetch and body reads', async () => {
  const f = fixture(); let calls = 0; const controller = new AbortController(); controller.abort();
  await rejects(getVersion(f.projectId, f.candidateId, { signal: controller.signal, transport: async () => { calls++; return json(f.review); } }), 'cancelled'); assert.equal(calls, 0);
  await rejects(getVersion(f.projectId, f.candidateId, { timeoutMs: 10, transport: async () => new Promise(() => {}) }), 'timeout');
  let cancelled = false;
  await rejects(getVersion(f.projectId, f.candidateId, { timeoutMs: 10, transport: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })) }), 'timeout'); assert.equal(cancelled, true);
  await rejects(getVersion(f.projectId, f.candidateId, { transport: async () => { throw new Error('PRIVATE_TRANSPORT_SENTINEL'); } }), 'network');
});
test('UTF-8 payload split at every byte is decoded without losing snapshot content', async () => {
  const f = fixture(); const bytes = new TextEncoder().encode(JSON.stringify(f.review)); let offset = 0;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { if (offset < bytes.length) controller.enqueue(bytes.slice(offset, ++offset)); else controller.close(); } });
  const value = await getVersion(f.projectId, f.candidateId, { transport: async () => new Response(stream) }); assert.deepEqual(value.version.snapshot, f.review.version.snapshot);
});
test('late headers and noncooperative cancel are fenced without extending the deadline', async () => {
  const f=fixture(); let release:(value:Response)=>void=()=>{}; let cancelled=false;
  const operation=getProject(f.projectId,{timeoutMs:5,transport:async()=>new Promise<Response>(resolve=>{release=resolve;})});
  await rejects(operation,'timeout'); release(new Response(new ReadableStream({cancel(){cancelled=true;return new Promise(()=>{});}}))); await delay(1); assert.equal(cancelled,true);
  await rejects(getProject(f.projectId,{timeoutMs:5,transport:async()=>new Response(new ReadableStream({cancel(){return new Promise(()=>{});}}))}),'timeout');
});
