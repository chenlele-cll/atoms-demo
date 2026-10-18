import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { createModelClient, ModelFailure } from '../src/model/client.js';
import { readModelConfig } from '../src/model/config.js';
import type { ModelObservation } from '../src/model/observation.js';
import { generateProject } from '../src/generation/service.js';
import { generationFixture, successfulGeneration } from './helpers/generation.js';
import { fixtureEnv, response, sentinel, startFixture, textResponse, toolResponse } from './helpers/model-fixture.js';
import { streamEvents, writeEvent, writeStream } from './helpers/model-stream-fixture.js';

const env = { ...fixtureEnv, MODEL_TIMEOUT_MS: '0', MODEL_STREAMING: 'true' };
const input = { messages: [{ role: 'user' as const, content: 'Public streaming fixture' }] };
const tools = { inspect_fixture: { inputSchema: z.strictObject({ fixture: z.literal('public-demo') }) } };

test('stream mode uses real SDK SSE parsing, full text, usage and safe observations with one dispatch', async t => {
  const observations: ModelObservation[] = [];
  const upstream = await startFixture((_body, res) => { res.setHeader('x-request-id', 'req_stream_fixture'); writeStream(res, response()); });
  t.after(upstream.close);
  const result = await createModelClient(readModelConfig(env), upstream.transport).run(1, session => session.step(input), undefined, undefined, event => observations.push(event));
  assert.equal(upstream.requests[0]?.stream, true);
  assert.equal(upstream.requests[0]?.store, false);
  assert.equal(upstream.requests[0]?.max_output_tokens, 4096);
  assert.equal(upstream.requests.length, 1);
  assert.equal(result.value.text, 'Hello from the public fixture.');
  assert.deepEqual(result.metrics.usage, { inputTokens: 12, outputTokens: 7, totalTokens: 19 });
  assert.deepEqual(observations.map(event => event.event), ['dispatch', 'response', 'step-finished']);
  assert.equal(observations[2]?.responseModel, 'gpt-6.1-sol');
  assert.equal(observations[2]?.providerRequestId, 'req_stream_fixture');
  assert.ok(!JSON.stringify(observations).includes(sentinel));
});

test('streaming structured output remains runtime validated', async t => {
  const upstream = await startFixture((_body, res) => writeStream(res, textResponse('{"answer":42}')));
  t.after(upstream.close);
  const result = await createModelClient(readModelConfig(env), upstream.transport).run(1, session => session.step({ ...input, schema: z.strictObject({ answer: z.literal(42) }) }));
  assert.deepEqual(result.value.output, { answer: 42 });
});

test('partial tool arguments do not resolve a step until the complete terminal stream arrives', async t => {
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const upstream = await startFixture((_body, res) => {
    res.setHeader('content-type', 'text/event-stream');
    const events = streamEvents(toolResponse());
    events.slice(0, 3).forEach((event, index) => writeEvent(res, event, index));
    void gate.then(() => { events.slice(3).forEach((event, index) => writeEvent(res, event, index + 3)); res.end(); });
  });
  t.after(() => { release(); return upstream.close(); });
  let resolved = false;
  const pending = createModelClient(readModelConfig(env), upstream.transport).run(1, async session => {
    const result = await session.step({ ...input, tools, toolChoice: 'required' }); resolved = true; return result;
  });
  await delay(100); assert.equal(resolved, false); release();
  const result = await pending;
  assert.equal(result.value.finishReason, 'tool-calls');
  assert.deepEqual(result.value.toolCalls[0]?.input, { fixture: 'public-demo' });
});

for (const scenario of ['missing-terminal', 'incomplete', 'refusal', 'failed', 'http504', 'malformed'] as const) {
  test(`stream ${scenario} fails safely without retry or successful work`, async t => {
    const observations: ModelObservation[] = [];
    const upstream = await startFixture((_body, res) => {
      if (scenario === 'http504') { res.statusCode = 504; res.end(JSON.stringify({ error: { message: sentinel } })); return; }
      res.setHeader('content-type', 'text/event-stream');
      if (scenario === 'malformed') { res.end('data: not valid JSON\n\n'); return; }
      const body = scenario === 'refusal' ? response([{ type: 'message', id: 'msg_refusal', role: 'assistant', status: 'completed', content: [{ type: 'refusal', refusal: sentinel }] }])
        : response(undefined, scenario === 'incomplete' ? { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }
          : scenario === 'failed' ? { status: 'failed', error: { code: 'server_error', message: sentinel } } : {});
      const events = streamEvents(body);
      (scenario === 'missing-terminal' ? events.slice(0, -1) : events).forEach((event, index) => writeEvent(res, event, index)); res.end();
    });
    t.after(upstream.close);
    let worked = false;
    const expected = scenario === 'incomplete' ? 'truncated' : scenario === 'refusal' ? 'refusal' : ['failed', 'http504'].includes(scenario) ? 'upstream' : 'invalid_output';
    await assert.rejects(createModelClient(readModelConfig(env), upstream.transport).run(1, async session => { await session.step(input); worked = true; }, undefined, undefined, event => observations.push(event)), (error: unknown) => {
      assert.ok(error instanceof ModelFailure); assert.equal(error.safe.code, expected); assert.ok(!String(error).includes(sentinel)); return true;
    });
    assert.equal(worked, false); assert.equal(upstream.requests.length, 1);
    assert.ok(!JSON.stringify(observations).includes(sentinel));
  });
}

test('zero-deadline cancellation aborts an actual in-progress SSE connection and fences partial tools', async t => {
  const upstream = await startFixture((_body, res) => { res.setHeader('content-type', 'text/event-stream'); streamEvents(toolResponse()).slice(0, 3).forEach((event, index) => writeEvent(res, event, index)); });
  t.after(upstream.close);
  const controller = new AbortController(); let worked = false;
  const pending = createModelClient(readModelConfig(env), upstream.transport).run(1, async session => { await session.step({ ...input, tools }); worked = true; }, controller.signal);
  while (!upstream.requests.length) await delay(10);
  await delay(25); controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof ModelFailure && error.safe.code === 'cancelled');
  await delay(50); assert.equal(worked, false); assert.equal(upstream.aborted(), 1); assert.equal(upstream.requests.length, 1);
});

test('three real SDK streaming tool steps persist an unadopted SQLite candidate', async t => {
  const f = await generationFixture(t);
  const upstream = await startFixture((body, res, index) => writeStream(res, successfulGeneration(body, index)));
  t.after(upstream.close);
  const result = await generateProject(f.input, { store: f.store, env, transport: upstream.transport });
  assert.equal(result.status, 'succeeded'); assert.ok(result.candidateVersionId);
  assert.equal(result.metrics.requestCount, 3); assert.equal(upstream.requests.length, 3);
  assert.ok(upstream.requests.every(request => request.stream === true));
  assert.equal(f.store.getProject(f.session.id, f.detail.project.id).currentVersion.id, f.detail.currentVersion.id);
  assert.ok(upstream.requests[1]?.input.some(item => item['type'] === 'function_call_output'));
});
