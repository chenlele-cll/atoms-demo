import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { generateProject } from '../src/generation/service.js';
import type { GenerationActivity } from '../src/generation/contracts.js';
import { openStore } from '../src/storage/store.js';
import { canonicalJSON } from '../src/template-assets/bundle.mjs';
import { snapshotSchema } from '../src/contracts/projects.js';
import type { Snapshot } from '../src/contracts/projects.js';
import { fixtureEnv, sentinel, response, startFixture, textResponse } from './helpers/model-fixture.js';
import { generationCall, generationFixture, submitCall, successfulGeneration } from './helpers/generation.js';

const modify = (base: Snapshot, files: Record<string, string>) => {
  const { digest: previous, ...content } = { ...base, files: { ...base.files, ...files } }; void previous;
  return snapshotSchema.parse({ ...content, digest: createHash('sha256').update(canonicalJSON(content)).digest('hex') });
};

test('actual SDK performs strict serial list/read/submit, retains reasoning continuation and persists an unadopted candidate', async t => {
  const marker = 'PROJECT_SOURCE_UNIQUE_428831';
  const f = await generationFixture(t, base => modify(base, { '/src/App.tsx': base.files['/src/App.tsx'] + `\n// ${marker}` }));
  const activities: GenerationActivity[] = [];
  const foreign = f.store.createProject(f.session.id, 'other project', f.bundle);
  f.store.appendMessages(foreign.project.id, [{ role: 'user', content: 'FOREIGN_PROJECT_PRIVATE_TEXT' }]);
  f.store.appendMessages(f.input.projectId, [{ role: 'user', content: 'own previous requirement' }]);
  const fixture = await startFixture((body, res, index) => {
    let value = successfulGeneration(body, index);
    if (index === 1) value = { ...value, output: [{ type: 'reasoning', id: 'rs_fixture', summary: [], encrypted_content: 'OPAQUE_CONTINUATION_ONLY' }, ...value.output as object[]] };
    res.end(JSON.stringify(value));
  });
  try {
    const result = await generateProject(f.input, { store: f.store, env: fixtureEnv, transport: fixture.transport, observe: event => activities.push(event) });
    assert.equal(result.status, 'succeeded', JSON.stringify(result));
    assert.equal(result.previewStatus, 'unverified'); assert.equal(result.metrics.requestCount, 3);
    assert.deepEqual(result.metrics.usage, { inputTokens: 36, outputTokens: 21, totalTokens: 57 });
    assert.equal(result.metrics.requests?.length, 3);
    assert.deepEqual(result.changedFiles, ['/src/generated/FixtureQuote.tsx']);
    assert.ok(result.candidateVersionId); assert.ok(result.terminalStatePersisted);
    assert.equal(fixture.requests.length, 3);
    for (const request of fixture.requests) {
      assert.equal(request.store, false); assert.equal(request.model, 'gpt-6.1-sol'); assert.equal(request.max_output_tokens, 4096);
      assert.equal(request['parallel_tool_calls'], false);
      assert.equal(request.tools?.length, 3);
      for (const tool of request.tools ?? []) { assert.equal(tool['strict'], true); assert.match(JSON.stringify(tool['parameters']), /"additionalProperties":false/); }
    }
    const second = fixture.requests[1];
    assert.ok(second?.input.some(item => item['type'] === 'reasoning' && item['encrypted_content'] === 'OPAQUE_CONTINUATION_ONLY'));
    const third = fixture.requests[2];
    const read = third?.input.filter(item => item['type'] === 'function_call_output').at(-1);
    assert.ok(read); const output = JSON.parse(String(read['output'])) as { files: { content: string }[] };
    assert.equal(output.files[0]?.content, f.bundle.files['/src/App.tsx']);
    assert.ok(JSON.stringify(third).includes(marker)); assert.ok(!JSON.stringify(fixture.requests).includes('FOREIGN_PROJECT_PRIVATE_TEXT'));
    assert.equal(JSON.stringify(fixture.requests[0]).split(f.input.prompt).length - 1, 1);
    const savedIndex = activities.findIndex(activity => activity.type === 'saved'); assert.ok(savedIndex > activities.findIndex(activity => activity.type === 'validated'));
    assert.deepEqual(activities.map(activity => activity.sequence), activities.map((_, index) => index + 1));
    assert.ok(!JSON.stringify({ result, activities }).includes(marker)); assert.ok(!JSON.stringify({ result, activities }).includes('OPAQUE_CONTINUATION_ONLY'));
    assert.ok(!JSON.stringify({ result, activities }).includes(sentinel));
    const before = f.store.inspectGeneration(f.input); assert.ok(before?.candidateVersion);
    const current = f.store.getProject(f.session.id, f.input.projectId); assert.equal(current.currentVersion.id, f.detail.currentVersion.id);
    const messages = f.store.listMessages(f.session.id, f.input.projectId, 0, 20);
    assert.equal(messages.items.length, 3); assert.match(messages.items[2]?.content ?? '', /候选已保存.*预览未验证/);
    assert.ok(!JSON.stringify(messages).includes('OPAQUE_CONTINUATION_ONLY'));
    f.store.close(); const reopened = openStore(f.filename); t.after(() => reopened.close());
    assert.deepEqual(reopened.inspectGeneration(f.input), before);
  } finally { await fixture.close(); }
});

test('strict preflight rejects invalid/foreign/expired/configuration requests without acceptance or model calls', async t => {
  const f = await generationFixture(t); let calls = 0;
  const transport: typeof fetch = async () => { calls++; throw new Error('Unexpected transport'); };
  const other = f.store.createSession(); const expired = f.store.createSession(0);
  for (const [input, env, code] of [
    [{ ...f.input, files: {} }, fixtureEnv, 'INVALID_INPUT'],
    [{ ...f.input, sessionId: other.id }, fixtureEnv, 'NOT_FOUND'],
    [{ ...f.input, sessionId: expired.id }, fixtureEnv, 'SESSION_REQUIRED'],
    [{ ...f.input, baseVersionId: randomUUID() }, fixtureEnv, 'BASE_VERSION_CHANGED'],
    [f.input, {}, 'MODEL_CONFIGURATION'],
  ] as const) {
    const result = await generateProject(input, { store: f.store, env, transport });
    assert.equal(result.errorCode, code, JSON.stringify(result)); assert.equal(result.runId, null); assert.equal(result.metrics.requestCount, 0);
  }
  assert.equal(calls, 0); assert.equal(f.store.getProject(f.session.id, f.input.projectId).latestRun, null);
  assert.equal(f.store.listMessages(f.session.id, f.input.projectId, 0, 20).items.length, 0);
});

test('same request concurrent/repeated execution does not bill twice; replay precedes new baseline/config checks', async t => {
  const f = await generationFixture(t);
  let received: () => void = () => {}; let release: () => void = () => {};
  const active = new Promise<void>(resolve => { received = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  const fixture = await startFixture((_, res, index) => {
    if (index === 1) { received(); void gate.then(() => res.end(JSON.stringify(generationCall('read_files', { paths: ['/src/App.tsx'] }, 1)))); }
    else res.end(JSON.stringify(submitCall(index)));
  });
  try {
    const first = generateProject(f.input, { store: f.store, env: { ...fixtureEnv, MODEL_TIMEOUT_MS: '3000' }, transport: fixture.transport });
    await active;
    const writer = new Database(f.filename);
    writer.prepare('UPDATE projects SET title=? WHERE id=?').run('write while model waits', f.input.projectId);
    writer.close(); // A real independent write proves the model wait holds no write transaction.
    const secondConnection = openStore(f.filename); t.after(() => secondConnection.close());
    const repeat = await generateProject(f.input, { store: secondConnection, env: {}, transport: fixture.transport });
    assert.equal(repeat.status, 'running'); assert.equal(repeat.replayed, true); assert.equal(repeat.metrics.requestCount, null);
    assert.equal((await generateProject({ ...f.input, prompt: 'different requirement' }, { store: secondConnection, env: fixtureEnv, transport: fixture.transport })).errorCode, 'REQUEST_CONFLICT');
    release(); const done = await first; assert.equal(done.status, 'succeeded'); assert.equal(fixture.requests.length, 2);
    const sql = new Database(f.filename); t.after(() => sql.close());
    sql.prepare('UPDATE projects SET current_version_id=? WHERE id=?').run(done.candidateVersionId, f.input.projectId);
    const replay = await generateProject(f.input, { store: f.store, env: {}, transport: fixture.transport });
    assert.equal(replay.status, 'succeeded'); assert.equal(replay.candidateVersionId, done.candidateVersionId); assert.equal(replay.metrics.usage, null);
    assert.deepEqual(replay.changedFiles, done.changedFiles);
    assert.equal((await generateProject({ ...f.input, baseVersionId: done.candidateVersionId }, { store: f.store, env: fixtureEnv, transport: fixture.transport })).errorCode, 'REQUEST_CONFLICT');
    assert.equal((await generateProject({ ...f.input, requestId: randomUUID() }, { store: f.store, env: fixtureEnv, transport: fixture.transport })).errorCode, 'BASE_VERSION_CHANGED');
    assert.equal(fixture.requests.length, 2); assert.equal(f.store.listMessages(f.session.id, f.input.projectId, 0, 50).items.length, 2);
  } finally { release(); await fixture.close(); }
});

test('invalid tool batches, no submission, refusal and truncation never create a candidate or auto-repair', async t => {
  for (const [name, body, code] of [
    ['unknown', generationCall('read_environment', {}, 1), 'TOOL_ERROR'],
    ['extra arg', generationCall('list_files', { secret: true }, 1), 'TOOL_ERROR'],
    ['parallel', response([...(generationCall('list_files', {}, 1).output as object[]), ...(generationCall('read_files', { paths: ['/src/App.tsx'] }, 2).output as object[])]), 'TOOL_ERROR'],
    // SDK 7 enforces required tool choice before returning a plain-text response.
    ['plain text', textResponse('I have generated a site.'), 'INVALID_OUTPUT'],
    ['truncated', generationCall('list_files', {}, 1, { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }), 'MODEL_TRUNCATED'],
    ['refused', response([{ type: 'message', id: 'msg', role: 'assistant', content: [{ type: 'refusal', refusal: sentinel }] }]), 'MODEL_REFUSAL'],
    ['no read', submitCall(1), 'FILE_POLICY'],
  ] as const) await t.test(name, async t => {
    const f = await generationFixture(t); const fixture = await startFixture((_, res) => res.end(JSON.stringify(body)));
    try {
      const result = await generateProject(f.input, { store: f.store, env: fixtureEnv, transport: fixture.transport });
      assert.equal(result.status, 'failed'); assert.equal(result.errorCode, code, JSON.stringify(result));
      assert.equal(result.metrics.requestCount, 1); assert.equal(result.candidateVersionId, null); assert.equal(result.terminalStatePersisted, true);
      assert.equal(f.store.listMessages(f.session.id, f.input.projectId, 0, 20).items.length, 1);
      assert.equal(f.store.getProject(f.session.id, f.input.projectId).currentVersion.id, f.input.baseVersionId);
      assert.ok(!JSON.stringify(result).includes(sentinel));
    } finally { await fixture.close(); }
  });
});

test('duplicate call IDs and six requests without submit stop without any extra request', async t => {
  for (const duplicate of [true, false]) await t.test(String(duplicate), async t => {
    const f = await generationFixture(t);
    const activities: GenerationActivity[] = [];
    const fixture = await startFixture((_, res, index) => res.end(JSON.stringify(generationCall('list_files', {}, duplicate ? 1 : index))));
    try {
      const result = await generateProject(f.input, { store: f.store, env: fixtureEnv, transport: fixture.transport, observe: activity => activities.push(activity) });
      assert.equal(result.errorCode, duplicate ? 'TOOL_ERROR' : 'STEP_LIMIT');
      assert.equal(result.metrics.requestCount, duplicate ? 2 : 6); assert.equal(fixture.requests.length, duplicate ? 2 : 6);
      assert.ok(activities.every(activity => activity.step <= 6));
    } finally { await fixture.close(); }
  });
});

test('context is bounded after complete read results without truncating files or sending the next request', async t => {
  const f = await generationFixture(t, base => modify(base, { '/src/generated/Large.ts': 'x'.repeat(90 * 1024) }));
  const fixture = await startFixture((_, res, index) => res.end(JSON.stringify(generationCall('read_files', { paths: ['/src/generated/Large.ts'] }, index))));
  try {
    const result = await generateProject(f.input, { store: f.store, env: fixtureEnv, transport: fixture.transport });
    assert.equal(result.errorCode, 'CONTEXT_LIMIT'); assert.equal(fixture.requests.length, 3);
  } finally { await fixture.close(); }
});

test('deadline and external cancellation abort actual delayed HTTP connections and retain accepted input', async t => {
  for (const cancel of [false, true]) await t.test(String(cancel), async t => {
    const f = await generationFixture(t); const controller = new AbortController();
    const fixture = await startFixture(() => { if (cancel) controller.abort(); });
    try {
      const result = await generateProject(f.input, { store: f.store, env: fixtureEnv, transport: fixture.transport, signal: controller.signal });
      await delay(30); assert.equal(fixture.aborted(), 1);
      assert.equal(result.errorCode, cancel ? 'CANCELLED' : 'GENERATION_TIMEOUT'); assert.equal(result.metrics.requestCount, 1);
      assert.equal(f.store.getProject(f.session.id, f.input.projectId).latestRun?.status, cancel ? 'cancelled' : 'failed');
      assert.equal(f.store.listMessages(f.session.id, f.input.projectId, 0, 20).items.length, 1);
    } finally { await fixture.close(); }
  });
});

test('transaction checkpoints roll back a candidate whose deadline expires before commit', async t => {
  const f = await generationFixture(t); let clock = 0;
  const complete = f.store.completeGeneration.bind(f.store);
  t.mock.method(f.store, 'completeGeneration', (...args: Parameters<typeof complete>) => {
    const [input, runId, snapshot, summary, check, now] = args;
    let checkpoints = 0;
    return complete(input, runId, snapshot, summary, () => { if (++checkpoints === 2) clock = 1001; check(); }, now);
  });
  const fixture = await startFixture((_, res, index) => res.end(JSON.stringify(index === 1 ? generationCall('read_files', { paths: ['/src/App.tsx'] }, index) : submitCall(index))));
  try {
    const result = await generateProject(f.input, { store: f.store, env: fixtureEnv, transport: fixture.transport, clock: () => clock });
    assert.equal(result.errorCode, 'GENERATION_TIMEOUT'); assert.equal(result.candidateVersionId, null);
    assert.equal(f.store.inspectGeneration(f.input)?.candidateVersion, null);
    assert.equal(f.store.listMessages(f.session.id, f.input.projectId, 0, 20).items.length, 1);
  } finally { await fixture.close(); }
});

test('pre-aborted requests and failed acceptance leave no run/user message or model request', async t => {
  const f = await generationFixture(t); let calls = 0;
  const transport: typeof fetch = async () => { calls++; throw new Error('Unexpected transport'); };
  const controller = new AbortController(); controller.abort();
  const cancelled = await generateProject(f.input, { store: f.store, env: fixtureEnv, transport, signal: controller.signal });
  assert.equal(cancelled.errorCode, 'CANCELLED'); assert.equal(cancelled.runId, null);
  const sql = new Database(f.filename); t.after(() => sql.close());
  sql.exec("CREATE TRIGGER reject_input BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT,'PRIVATE_ACCEPTANCE_FAILURE'); END;");
  const failed = await generateProject(f.input, { store: f.store, env: fixtureEnv, transport });
  assert.equal(failed.errorCode, 'STORAGE_UNAVAILABLE'); assert.equal(failed.runId, null); assert.equal(calls, 0);
  assert.deepEqual(sql.prepare('SELECT count(*) AS count FROM generation_runs').get(), { count: 0 });
  assert.equal(f.store.listMessages(f.session.id, f.input.projectId, 0, 20).items.length, 0);
});

test('late non-cooperative transport cannot execute tools, save or emit events after termination', async t => {
  const f = await generationFixture(t); const events: GenerationActivity[] = []; let calls = 0;
  const transport: typeof fetch = async () => {
    calls++; await delay(1150);
    return new Response(JSON.stringify(generationCall('read_files', { paths: ['/src/App.tsx'] }, 1)), { headers: { 'content-type': 'application/json' } });
  };
  const result = await generateProject(f.input, { store: f.store, env: fixtureEnv, transport, observe: event => events.push(event) });
  assert.equal(result.errorCode, 'GENERATION_TIMEOUT'); const eventCount = events.length;
  await delay(250); assert.equal(events.length, eventCount); assert.equal(calls, 1);
  assert.equal(f.store.inspectGeneration(f.input)?.candidateVersion, null);
  assert.equal(f.store.inspectGeneration(f.input)?.run.status, 'failed');
});

test('candidate/summary write failures roll back all success records; terminal write failure is explicitly unconfirmed', async t => {
  for (const target of ['versions', 'assistant-message', 'terminal']) await t.test(target, async t => {
    const f = await generationFixture(t); const sql = new Database(f.filename); t.after(() => sql.close());
    const trigger = target === 'versions' ? "BEFORE INSERT ON versions" : target === 'assistant-message'
      ? "BEFORE INSERT ON messages WHEN NEW.role='assistant'" : 'BEFORE UPDATE ON generation_runs';
    sql.exec(`CREATE TRIGGER failure ${trigger} BEGIN SELECT RAISE(ABORT,'PRIVATE_SQL_FAILURE'); END;`);
    const fixture = await startFixture((_, res, index) => res.end(JSON.stringify(index === 1 ? generationCall('read_files', { paths: ['/src/App.tsx'] }, index) : submitCall(index))));
    try {
      const result = await generateProject(f.input, { store: f.store, env: fixtureEnv, transport: fixture.transport });
      assert.equal(result.errorCode, 'STORAGE_UNAVAILABLE'); assert.equal(result.terminalStatePersisted, target !== 'terminal');
      const record = f.store.inspectGeneration(f.input); assert.equal(record?.run.status, target === 'terminal' ? 'running' : 'failed');
      assert.equal(record?.candidateVersion, null); assert.equal(f.store.listMessages(f.session.id, f.input.projectId, 0, 20).items.length, 1);
      assert.deepEqual(sql.prepare('SELECT count(*) AS count FROM versions').get(), { count: 1 });
      assert.ok(!JSON.stringify(result).includes('PRIVATE_SQL_FAILURE'));
    } finally { await fixture.close(); }
  });
});

test('base changed during generation rejects candidate while observer errors and late cancellation cannot undo committed success', async t => {
  for (const action of ['base-change', 'late-cancel', 'observer-throw'] as const) await t.test(action, async t => {
    const f = await generationFixture(t); const controller = new AbortController();
    const old = f.store.createRun({ projectId: f.input.projectId, requestId: randomUUID(), baseVersionId: f.input.baseVersionId });
    const alternative = f.store.saveCandidate({ projectId: f.input.projectId, runId: old.id, snapshot: f.bundle }).version;
    const sql = new Database(f.filename); t.after(() => sql.close());
    const fixture = await startFixture((_, res, index) => res.end(JSON.stringify(index === 1 ? generationCall('read_files', { paths: ['/src/App.tsx'] }, index) : submitCall(index))));
    try {
      const result = await generateProject(f.input, { store: f.store, env: fixtureEnv, transport: fixture.transport, signal: controller.signal,
        observe: event => {
          if (action === 'base-change' && event.type === 'validated') sql.prepare('UPDATE projects SET current_version_id=? WHERE id=?').run(alternative.id, f.input.projectId);
          if (action === 'late-cancel' && event.type === 'saved') controller.abort();
          if (action === 'observer-throw') throw new Error('PRIVATE_OBSERVER_FAILURE');
        } });
      assert.equal(result.status, action === 'base-change' ? 'failed' : 'succeeded', JSON.stringify(result));
      if (action === 'base-change') assert.equal(result.errorCode, 'BASE_VERSION_CHANGED');
      else assert.ok(f.store.inspectGeneration(f.input)?.candidateVersion);
      if (action === 'observer-throw') assert.ok(result.observerErrors > 0);
      assert.ok(!JSON.stringify(result).includes('PRIVATE_OBSERVER_FAILURE'));
    } finally { await fixture.close(); }
  });
});

test('partial/failed model usage is unknown and sensitive prompts, code and provider errors never enter activity or errors', async t => {
  const f = await generationFixture(t); const activities: GenerationActivity[] = [];
  const fixture = await startFixture((_, res, index) => {
    if (index === 1) res.end(JSON.stringify(generationCall('read_files', { paths: ['/src/App.tsx'] }, 1)));
    else { res.statusCode = 401; res.end(JSON.stringify({ error: { message: `${sentinel} PRIVATE_PROMPT RAW_PROVIDER`, type: 'fixture', code: 'fixture' } })); }
  });
  const logs: unknown[] = []; t.mock.method(console, 'warn', (...args: unknown[]) => logs.push(args)); t.mock.method(console, 'error', (...args: unknown[]) => logs.push(args));
  try {
    const result = await generateProject({ ...f.input, prompt: 'PRIVATE_PROMPT' }, { store: f.store, env: fixtureEnv, transport: fixture.transport, observe: event => activities.push(event) });
    assert.equal(result.errorCode, 'MODEL_AUTHENTICATION'); assert.equal(result.metrics.requestCount, 2); assert.equal(result.metrics.usage, null);
    assert.equal(result.metrics.requests?.[1], null); assert.equal(result.metrics.requests?.[0]?.inputTokens, 12);
    const visible = JSON.stringify({ result, activities, logs });
    for (const secret of [sentinel, 'PRIVATE_PROMPT', 'RAW_PROVIDER', 'function App()']) assert.ok(!visible.includes(secret));
  } finally { await fixture.close(); }
});


test('unlimited default survives multiple old deadlines across real SDK HTTP tool steps', async t => {
  const f = await generationFixture(t);let elapsed = 0;const started = performance.now();
  t.mock.method(performance, 'now', () => started + elapsed);
  const fixture = await startFixture((body, res, index) => {
    elapsed += 180_000;
    res.end(JSON.stringify(successfulGeneration(body, index)));
  });
  try {
    const result = await generateProject(f.input, { store: f.store, env: { ...fixtureEnv, MODEL_TIMEOUT_MS: undefined }, transport: fixture.transport, clock: () => elapsed });
    assert.equal(result.status, 'succeeded');assert.equal(result.errorCode, null);assert.equal(result.metrics.requestCount, 3);assert.equal(elapsed, 540_000);
    assert.ok(result.candidateVersionId);assert.equal(f.store.getProject(f.session.id, f.input.projectId).currentVersion.id, f.input.baseVersionId);
  } finally { await fixture.close(); }
});

test('unlimited generation still cancels its real upstream connection and never saves late output', async t => {
  const f = await generationFixture(t);const controller = new AbortController();
  const fixture = await startFixture(() => { controller.abort('USER_CANCELLED'); });
  try {
    const result = await generateProject(f.input, {store:f.store,env:{...fixtureEnv,MODEL_TIMEOUT_MS:'0'},transport:fixture.transport,signal:controller.signal});
    await delay(30);assert.equal(fixture.aborted(),1);assert.equal(result.status,'cancelled');assert.equal(result.errorCode,'USER_CANCELLED');assert.equal(result.candidateVersionId,null);assert.equal(fixture.requests.length,1);
    assert.equal(f.store.getProject(f.session.id,f.input.projectId).currentVersion.id,f.input.baseVersionId);
  } finally { await fixture.close(); }
});
