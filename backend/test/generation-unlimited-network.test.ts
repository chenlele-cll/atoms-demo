import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { generationEventSchema } from '../src/contracts/generations.js';
import { generationFixture, successfulGeneration } from './helpers/generation.js';
import { fixtureEnv, startFixture } from './helpers/model-fixture.js';

// Opt-in wall-clock regression: all HTTP traffic is loopback, with fake credentials.
test('unlimited HTTP generation survives the old 60-second wall deadline with SSE heartbeats', {
  skip: process.env['ATOMS_LONG_GENERATION_TEST'] !== '1', timeout: 90_000,
}, async t => {
  const f = await generationFixture(t);
  let release: ReturnType<typeof setTimeout> | undefined;
  const upstream = await startFixture((body, response, index) => {
    const finish = () => response.end(JSON.stringify(successfulGeneration(body, index)));
    if (index === 1) release = setTimeout(finish, 61_500);
    else finish();
  });
  const origin = 'http://127.0.0.1:5173';
  const app = buildApp({ logger: false }, { store: f.store, catalog: f.catalog,
    origins: [origin], secureCookies: false,
    generation: { env: { ...fixtureEnv, MODEL_TIMEOUT_MS: '0' }, transport: upstream.transport } });
  try {
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const started = performance.now();
    const response = await fetch(address + `/api/projects/${f.input.projectId}/generations`, {
      method: 'POST', headers: { origin, 'content-type': 'application/json', accept: 'text/event-stream',
        cookie: `atoms_session=${f.session.token}` },
      body: JSON.stringify({ requestId: f.input.requestId, baseVersionId: f.input.baseVersionId, prompt: f.input.prompt }),
      signal: AbortSignal.timeout(80_000),
    });
    assert.equal(response.status, 200);
    assert.ok(performance.now() - started < 5000, 'Acceptance must precede the slow model response');
    const text = await response.text();
    const events = text.split('\n').filter(line => line.startsWith('data: '))
      .map(line => generationEventSchema.parse(JSON.parse(line.slice(6))));
    const terminal = events.at(-1);
    assert.ok(performance.now() - started >= 61_000);
    assert.equal(events[0]?.event, 'accepted');
    assert.equal(terminal?.event, 'terminal');
    assert.ok(terminal?.event === 'terminal');
    assert.equal(terminal.state.status, 'succeeded');
    assert.ok(terminal.state.candidateVersionId);
    assert.equal(upstream.requests.length, 3);
    assert.ok(text.split('\n').filter(line => line.startsWith(':')).length >= 5);
    assert.equal(f.store.getProject(f.session.id, f.input.projectId).currentVersion.id, f.input.baseVersionId);
  } finally { clearTimeout(release); await app.close(); await upstream.close(); }
});
