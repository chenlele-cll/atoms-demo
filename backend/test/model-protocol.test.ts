import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { getEventListeners } from 'node:events';
import { createModelClient, ModelFailure } from '../src/model/client.js';
import type { ModelSession } from '../src/model/client.js';
import { readModelConfig } from '../src/model/config.js';
import { runProbe } from '../src/model/probe-runner.js';
import { fixtureEnv, sentinel, startFixture, successfulResponse, textResponse, toolResponse, response } from './helpers/model-fixture.js';

test('real SDK protocol exercises text, structured files and one memory-tool round trip', async t => {
  const previousBase = process.env['OPENAI_BASE_URL'];
  process.env['OPENAI_BASE_URL'] = 'https://forbidden.invalid/not-openai';
  t.after(() => {
    if (previousBase === undefined) delete process.env['OPENAI_BASE_URL'];
    else process.env['OPENAI_BASE_URL'] = previousBase;
  });
  const fixture = await startFixture((body, res) => res.end(JSON.stringify(successfulResponse(body))));
  try {
    const report = await runProbe('all', { env: fixtureEnv, transport: fixture.transport });
    assert.equal(report.status, 'passed', JSON.stringify(report));
    assert.equal(report.source, 'fixture');
    assert.equal(report.requestCount, 4);
    assert.deepEqual(report.cases.map(item => item.status), ['passed', 'passed', 'passed']);
    assert.deepEqual(report.cases[2]?.usage, { inputTokens: 24, outputTokens: 14, totalTokens: 38 });
    assert.equal(report.cases[2]?.summary?.toolExecutions, 1);
    for (const request of fixture.requests) {
      assert.equal(request.model, 'gpt-6.1-sol');
      assert.equal(request.store, false);
      assert.equal(request.max_output_tokens, 4096);
      assert.ok(!('previous_response_id' in request));
    }
    assert.deepEqual(fixture.urls, Array(4).fill('/v1/responses'));
    assert.deepEqual(fixture.authorizations, Array(4).fill(`Bearer ${sentinel}`));
    const files = fixture.requests[1];
    assert.match(JSON.stringify(files?.text), /json_schema/);
    assert.match(JSON.stringify(files?.text), /\/App.tsx/);
    const firstTool = fixture.requests[2];
    assert.equal(firstTool?.tools?.length, 1);
    assert.equal(firstTool?.tools?.[0]?.['name'], 'inspect_fixture');
    const finalTool = fixture.requests[3];
    const output = finalTool?.input.find(item => item['type'] === 'function_call_output');
    assert.ok(output);
    const nonce = JSON.parse(String(output['output'])) as { nonce: string };
    assert.ok(!JSON.stringify(firstTool).includes(nonce.nonce));
    assert.equal(finalTool?.tool_choice, 'none');
    assert.ok(!JSON.stringify(report).includes(nonce.nonce));
    assert.ok(!JSON.stringify(report).includes('export default'));
  } finally { await fixture.close(); }
});

test('files validate schema, single fixed path, nonblank content and UTF-8 byte limit', async t => {
  const invalid = [
    { files: [] }, { files: [{ path: '/src/App.tsx', content: 'x' }] },
    { files: [{ path: '../../secret', content: 'x' }] },
    { files: [{ path: '/App.tsx', content: ' ' }] },
    { files: [{ path: '/App.tsx', content: '中'.repeat(5462) }] },
    { files: [{ path: '/App.tsx', content: 'x'.repeat(16_385) }] },
    { files: [{ path: '/App.tsx', content: 123 }] },
    { files: [{ path: '/App.tsx', content: 'x', extra: true }] },
    { files: [{ path: '/App.tsx', content: 'x' }, { path: '/App.tsx', content: 'x' }] },
    'not-json',
  ];
  for (const [index, body] of invalid.entries()) await t.test(`invalid file response ${index + 1}`, async () => {
    const fixture = await startFixture((_, res) => res.end(JSON.stringify(textResponse(typeof body === 'string' ? body : JSON.stringify(body)))));
    try {
      const report = await runProbe('files', { env: fixtureEnv, transport: fixture.transport });
      assert.equal(report.status, 'failed');
      assert.equal(report.cases[1]?.error?.code, 'invalid_output');
      assert.equal(fixture.requests.length, 1);
    } finally { await fixture.close(); }
  });
});

test('refusal, truncation, incomplete status and empty text are failures', async t => {
  const cases = [
    { body: textResponse(''), code: 'invalid_output' },
    { body: textResponse('partial', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }), code: 'truncated' },
    { body: textResponse('partial', { status: 'incomplete' }), code: 'truncated' },
    { body: textResponse('partial', { status: 'failed' }), code: 'invalid_output' },
    { body: response([{ type: 'message', id: 'msg', role: 'assistant', status: 'incomplete', content: [{ type: 'output_text', text: 'partial', annotations: [] }] }]), code: 'truncated' },
    { body: response([{ type: 'message', id: 'msg', role: 'assistant', content: [{ type: 'refusal', refusal: sentinel }] }]), code: 'refusal' },
  ];
  for (const item of cases) await t.test(item.code, async () => {
    const fixture = await startFixture((_, res) => res.end(JSON.stringify(item.body)));
    try {
      const report = await runProbe('text', { env: fixtureEnv, transport: fixture.transport });
      assert.equal(report.cases[0]?.error?.code, item.code, JSON.stringify(report));
      assert.ok(!JSON.stringify(report).includes(sentinel));
      assert.equal(report.requestCount, 1);
    } finally { await fixture.close(); }
  });
});

test('tool failures never dispatch an invalid batch or add a repair request', async t => {
  const cases = [
    { title: 'no tool call', body: textResponse('inspect_fixture') },
    { title: 'unknown tool', body: toolResponse('read_secret') },
    { title: 'invalid input', body: toolResponse('inspect_fixture', { fixture: 'private' }) },
    { title: 'extra argument', body: toolResponse('inspect_fixture', { fixture: 'public-demo', file: '/etc/passwd' }) },
    { title: 'duplicate calls', body: toolResponse('inspect_fixture', { fixture: 'public-demo' }, 2) },
  ];
  for (const item of cases) await t.test(item.title, async () => {
    const fixture = await startFixture((_, res) => res.end(JSON.stringify(item.body)));
    try {
      const report = await runProbe('tools', { env: fixtureEnv, transport: fixture.transport });
      assert.equal(report.status, 'failed');
      assert.equal(report.cases[2]?.error?.code, 'invalid_output');
      assert.equal(report.requestCount, 1);
    } finally { await fixture.close(); }
  });
  for (const body of [textResponse('invented-nonce'), toolResponse()]) await t.test('missing final nonce or another tool request', async () => {
    const fixture = await startFixture((_, res, index) => res.end(JSON.stringify(index === 1 ? toolResponse() : body)));
    try {
      const report = await runProbe('tools', { env: fixtureEnv, transport: fixture.transport });
      assert.equal(report.status, 'failed');
      assert.equal(report.requestCount, 2);
      assert.equal(report.cases[2]?.error?.code, 'invalid_output');
    } finally { await fixture.close(); }
  });
});

test('safe provider errors stop all later cases with zero retries and no raw details', async t => {
  for (const [status, code] of [[401, 'authentication'], [403, 'model_access'], [404, 'model_access'],
    [429, 'quota_rate_limit'], [500, 'upstream'], [503, 'upstream'], [400, 'invalid_output']] as const) {
    await t.test(String(status), async () => {
      const fixture = await startFixture((_, res) => {
        res.statusCode = status;
        res.setHeader('x-private-debug', sentinel);
        res.end(JSON.stringify({ error: { message: `RAW_PROVIDER_BODY ${sentinel}`, type: 'fixture', code: 'fixture' } }));
      });
      const logs: unknown[] = [];
      t.mock.method(console, 'warn', (...args: unknown[]) => { logs.push(args); });
      t.mock.method(console, 'error', (...args: unknown[]) => { logs.push(args); });
      try {
        const report = await runProbe(status === 400 ? 'text' : 'all', { env: fixtureEnv, transport: fixture.transport });
        assert.equal(report.cases[0]?.error?.code, code, JSON.stringify(report));
        assert.equal(report.cases[0]?.error?.status, status);
        assert.equal(report.requestCount, 1);
        assert.equal(fixture.requests.length, 1);
        assert.equal(report.cases[1]?.status, 'not-run');
        assert.ok(!JSON.stringify({ report, logs }).includes(sentinel));
        assert.ok(!JSON.stringify({ report, logs }).includes('RAW_PROVIDER_BODY'));
      } finally { await fixture.close(); t.mock.restoreAll(); }
    });
  }
});

test('missing usage remains null and format failure can continue independent capabilities', async () => {
  const fixture = await startFixture((body, res, index) => res.end(JSON.stringify(index === 1
    ? textResponse('') : { ...successfulResponse(body) as object, usage: undefined })));
  try {
    const report = await runProbe('all', { env: fixtureEnv, transport: fixture.transport });
    assert.equal(report.status, 'failed');
    assert.equal(report.requestCount, 4);
    assert.deepEqual(report.cases.map(item => item.status), ['failed', 'passed', 'passed']);
    assert.equal(report.cases[1]?.usage, null);
    assert.equal(report.cases[2]?.usage, null);
  } finally { await fixture.close(); }
});

test('network failures are distinct, bounded and stop all later samples', async () => {
  const fixture = await startFixture((_, res) => res.destroy());
  try {
    const report = await runProbe('all', { env: fixtureEnv, transport: fixture.transport });
    assert.equal(report.cases[0]?.error?.code, 'network');
    assert.equal(report.requestCount, 1);
    assert.equal(report.cases[1]?.status, 'not-run');
  } finally { await fixture.close(); }
});

test('Responses failed status with an embedded error stops later cases even over HTTP 200', async () => {
  const fixture = await startFixture((_, res) => res.end(JSON.stringify(response([], {
    status: 'failed', error: { message: sentinel, type: 'server_error', code: 'server_error' },
  }))));
  try {
    const report = await runProbe('all', { env: fixtureEnv, transport: fixture.transport });
    assert.equal(report.cases[0]?.error?.code, 'upstream');
    assert.equal(report.requestCount, 1); assert.equal(report.cases[1]?.status, 'not-run');
    assert.ok(!JSON.stringify(report).includes(sentinel));
  } finally { await fixture.close(); }
});

test('deadline aborts actual HTTP request, drops late response and skips remaining capabilities', async () => {
  const fixture = await startFixture(() => {});
  try {
    const report = await runProbe('all', { env: fixtureEnv, transport: fixture.transport });
    await delay(30);
    assert.equal(report.cases[0]?.error?.code, 'timeout');
    assert.equal(fixture.aborted(), 1);
    assert.equal(report.requestCount, 1);
    assert.equal(report.cases[1]?.status, 'not-run');
    assert.ok(report.durationMs < 1800);
  } finally { await fixture.close(); }
});

test('tool round trip shares one deadline across both HTTP requests', async () => {
  const timers: NodeJS.Timeout[] = [];
  const fixture = await startFixture((_, res, index) => {
    if (index === 1) timers.push(setTimeout(() => res.end(JSON.stringify(toolResponse())), 650));
  });
  try {
    const report = await runProbe('tools', { env: fixtureEnv, transport: fixture.transport });
    await delay(30);
    assert.equal(report.cases[2]?.error?.code, 'timeout');
    assert.equal(report.requestCount, 2);
    assert.equal(fixture.aborted(), 1);
    assert.ok(report.durationMs >= 950 && report.durationMs < 1450);
  } finally { timers.forEach(clearTimeout); await fixture.close(); }
});

test('external cancellation aborts a live connection; already-aborted signals send zero requests', async () => {
  const controller = new AbortController();
  const fixture = await startFixture(() => controller.abort());
  try {
    const report = await runProbe('all', { env: fixtureEnv, transport: fixture.transport, signal: controller.signal });
    await delay(30);
    assert.equal(report.status, 'cancelled');
    assert.equal(report.requestCount, 1);
    assert.equal(fixture.aborted(), 1);
    assert.equal(report.cases[1]?.status, 'not-run');
    const pre = await runProbe('all', { env: fixtureEnv, transport: fixture.transport, signal: controller.signal });
    assert.equal(pre.status, 'cancelled'); assert.equal(pre.source, 'not-run'); assert.equal(pre.requestCount, 0);
  } finally { await fixture.close(); }
});

test('non-cooperative late transport cannot turn timeout into success or start the next step', async () => {
  let calls = 0;
  const report = await runProbe('all', { env: fixtureEnv, transport: async () => {
    calls++; await delay(1150); return new Response(JSON.stringify(response()), { headers: { 'content-type': 'application/json' } });
  } });
  assert.equal(report.cases[0]?.error?.code, 'timeout');
  await delay(250);
  assert.equal(calls, 1); assert.equal(report.cases[0]?.status, 'failed');
});

test('redirects cannot replay requests or forward credentials to another endpoint', async () => {
  const fixture = await startFixture((_, res) => {
    res.statusCode = 302; res.setHeader('location', '/v1/responses'); res.end();
  });
  try {
    const report = await runProbe('all', { env: fixtureEnv, transport: fixture.transport });
    assert.equal(report.status, 'failed'); assert.equal(report.requestCount, 1);
    assert.equal(fixture.requests.length, 1); assert.equal(report.cases[1]?.status, 'not-run');
  } finally { await fixture.close(); }
});

test('bounded client closes its scope, enforces request budget and removes external listeners', async () => {
  const fixture = await startFixture((_, res) => res.end(JSON.stringify(response())));
  const controller = new AbortController();
  const client = createModelClient(readModelConfig(fixtureEnv), fixture.transport);
  const listenersBefore = getEventListeners(controller.signal, 'abort').length;
  let saved: ModelSession | undefined;
  const input = { messages: [{ role: 'user' as const, content: 'Public connectivity check' }] };
  try {
    await client.run(1, async session => { saved = session; await session.step(input); }, controller.signal);
    assert.equal(getEventListeners(controller.signal, 'abort').length, listenersBefore);
    assert.ok(saved);
    await assert.rejects(saved.step(input));
    assert.equal(fixture.requests.length, 1);
    await assert.rejects(client.run(1, async session => { await session.step(input); await session.step(input); }, controller.signal), error => {
      assert.ok(error instanceof ModelFailure); assert.equal(error.metrics.requestCount, 1); return true;
    });
    assert.equal(getEventListeners(controller.signal, 'abort').length, listenersBefore);
    assert.equal(fixture.requests.length, 2);
  } finally { await fixture.close(); }
});

test('explicit approved compatible endpoint uses Responses and is identified in the report', async () => {
  const fixture = await startFixture((_, res) => res.end(JSON.stringify(response())));
  let target = '';
  const transport: typeof fetch = (url, init) => {
    target = String(url);
    return fetch(`${fixture.origin}/v1/responses`, init);
  };
  try {
    const report = await runProbe('text', { env: { ...fixtureEnv, OPENAI_BASE_URL: 'https://ai.elegantyc.com/v1' }, transport });
    assert.equal(report.status, 'passed'); assert.equal(report.source, 'fixture');
    assert.equal(report.provider, 'openai-compatible'); assert.equal(report.baseURL, 'https://ai.elegantyc.com/v1');
    assert.equal(target, 'https://ai.elegantyc.com/v1/responses');
    assert.equal(fixture.requests[0]?.store, false); assert.equal(report.requestCount, 1);
  } finally { await fixture.close(); }
});
