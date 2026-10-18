import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { backwardMessageListSchema, messageListSchema } from '@atoms/contracts';
import { buildApp } from '../src/app.js';
import { projectFixture } from './helpers/projects.js';

test('latest/backward pages stay ascending/owned and preserve the original forward contract', async t => {
  const f = await projectFixture(t); const a = f.store.createSession(); const b = f.store.createSession();
  const detail = f.store.createProject(a.id, 'Workspace pagination', f.bundle); const id = detail.project.id;
  const messages = Array.from({ length: 73 }, (_, index) => ({ role: 'user' as const, content: `persisted message ${index + 1}` }));
  f.store.appendMessages(id, messages.slice(0, 50)); f.store.appendMessages(id, messages.slice(50));
  const app = buildApp({ logger: false }, { ...f, origins: ['http://127.0.0.1:5173'], secureCookies: false }); t.after(() => app.close());
  const headers = { cookie: `atoms_session=${a.token}` }; const path = `/api/projects/${id}/messages`;
  const latest = await app.inject({ url: path + '?direction=backward&limit=50', headers });
  assert.equal(latest.statusCode, 200); assert.equal(latest.headers['cache-control'], 'no-store');
  const page = backwardMessageListSchema.parse(latest.json());
  assert.deepEqual(page.items.map(item => item.sequence), Array.from({ length: 50 }, (_, index) => index + 24));
  assert.equal(page.nextBeforeSequence, 24); assert.equal(page.latestSequence, 73);
  const earlier = backwardMessageListSchema.parse((await app.inject({ url: path + '?direction=backward&beforeSequence=24&limit=50', headers })).json());
  assert.deepEqual(earlier.items.map(item => item.sequence), Array.from({ length: 23 }, (_, index) => index + 1)); assert.equal(earlier.nextBeforeSequence, null);
  assert.equal(earlier.latestSequence, 73); assert.equal(new Set([...earlier.items, ...page.items].map(item => item.id)).size, 73);
  const forwardResponse = await app.inject({ url: path + '?afterSequence=70&limit=20', headers }); const forward = messageListSchema.parse(forwardResponse.json());
  assert.deepEqual(forward.items.map(item => item.sequence), [71,72,73]); assert.deepEqual(Object.keys(forwardResponse.json()).sort(), ['items','nextAfterSequence']);
  for (const query of ['direction=forward','beforeSequence=24','direction=backward&afterSequence=0','direction=backward&beforeSequence=0','direction=backward&beforeSequence=9007199254740992','direction=backward&limit=51','direction=backward&limit=0']) {
    assert.equal((await app.inject({ url: `${path}?${query}`, headers })).statusCode, 400, query);
  }
  assert.equal((await app.inject({ url: path + '?direction=backward' })).statusCode, 401);
  const foreign = await app.inject({ url: path + '?direction=backward', headers: { cookie: `atoms_session=${b.token}` } });
  const missing = await app.inject({ url: `/api/projects/${randomUUID()}/messages?direction=backward`, headers });
  assert.equal(foreign.statusCode, 404); assert.deepEqual(foreign.json().error, missing.json().error);
  const run = f.store.createRun({ projectId: id, requestId: randomUUID(), baseVersionId: detail.currentVersion.id, messages: [{ role: 'user', content: 'PRIVATE_REQUIREMENT_ONLY_IN_MESSAGES' }] });
  const after = (await app.inject({ url: `/api/projects/${id}`, headers })).json();
  assert.equal(after.latestRun.requestId, run.requestId); assert.equal(after.latestRun.baseVersionId, run.baseVersionId);
  assert.ok(!JSON.stringify(after.latestRun).includes('PRIVATE_REQUIREMENT_ONLY_IN_MESSAGES')); assert.ok(!JSON.stringify(after.latestRun).includes(a.token));
});
