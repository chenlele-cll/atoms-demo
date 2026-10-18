import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmod, copyFile, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { buildApp } from '../src/app.js';
import { generationEventSchema, generationStatusSchema } from '../src/contracts/generations.js';
import type { GenerationEvent } from '../src/contracts/generations.js';
import type { GenerationActivity } from '../src/generation/contracts.js';
import { generateProject } from '../src/generation/service.js';
import { openStore } from '../src/storage/store.js';
import { generationFixture } from './helpers/generation.js';

const edit = '\nexport function OpenCodeFixture() { return <aside>Fixture change</aside>; }\n';
const metrics = { requestCount: null, usage: null, requests: null };
const origin = 'http://127.0.0.1:5173';
const reportSchema = z.object({ pid: z.number().int().positive(), root: z.string(), project: z.string(), args: z.array(z.string()),
  messages: z.array(z.object({ role: z.string(), content: z.string() })), original: z.string(), backendSecret: z.null() });

async function fixture(t: TestContext, mode = 'success') {
  const f = await generationFixture(t);
  const executable = join(f.directory, 'opencode');
  await copyFile(new URL('./fixtures/opencode-service.cjs', import.meta.url), executable);
  await chmod(executable, 0o700);
  const input = { ...f.input, prompt: `PRIVATE_CURRENT_REQUEST_${randomUUID()} ATOMS_FIXTURE:${mode}` };
  const env = { OPENAI_API_KEY: 'fake-opencode-api-secret', MODEL_ID: 'fixture-model', MODEL_TIMEOUT_MS: '0', ATOMS_OPENCODE_BIN: executable };
  const reports = async () => (await readFile(executable + '.reports', 'utf8')).trim().split('\n')
    .map(line => reportSchema.parse(JSON.parse(line) as unknown));
  const logs: unknown[] = [];
  t.mock.method(console, 'warn', (...args: unknown[]) => { logs.push(args); });
  t.mock.method(console, 'error', (...args: unknown[]) => { logs.push(args); });
  return { ...f, input, env, executable, reports, logs };
}

async function until(work: () => boolean | Promise<boolean>) {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (await work()) return;
    await delay(10);
  }
  assert.fail('Timed out waiting for fixture evidence');
}

async function started(f: Awaited<ReturnType<typeof fixture>>) {
  await until(async () => {
    try { return (await f.reports()).length > 0; } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
      throw error;
    }
  });
  const report = (await f.reports())[0]; assert.ok(report);
  assert.doesNotThrow(() => process.kill(report.pid, 0));
  return report;
}

async function cleaned(report: z.infer<typeof reportSchema>) {
  await assert.rejects(stat(report.root), { code: 'ENOENT' });
  assert.throws(() => process.kill(report.pid, 0), { code: 'ESRCH' });
}

function privateOutput(value: unknown, f: Awaited<ReturnType<typeof fixture>>) {
  const visible = JSON.stringify({ value, logs: f.logs });
  for (const secret of [f.input.prompt, f.session.token, f.env.OPENAI_API_KEY, 'PRIVATE_AGENT_STDOUT', 'PRIVATE_STDERR',
    'PRIVATE_PROVIDER_ERROR', 'PRIVATE_TOOL_INPUT', 'PRIVATE_TOOL_OUTPUT', 'PRIVATE_PROTECTED_CHANGE', 'export function OpenCodeFixture']) {
    assert.ok(!visible.includes(secret), `Exposed private value: ${secret}`);
  }
}

test('default CLI persists an unadopted SQLite candidate, reopens it and replays with the executable deleted', { timeout: 15_000 }, async t => {
  const f = await fixture(t, 'add');
  const previousSecret = process.env['ATOMS_BACKEND_TEST_SECRET'];
  process.env['ATOMS_BACKEND_TEST_SECRET'] = 'PRIVATE_BACKEND_SECRET';
  t.after(() => { if (previousSecret === undefined) delete process.env['ATOMS_BACKEND_TEST_SECRET']; else process.env['ATOMS_BACKEND_TEST_SECRET'] = previousSecret; });
  const activities: GenerationActivity[] = [];
  const result = await generateProject(f.input, { store: f.store, env: f.env, observe: event => activities.push(event) });
  assert.equal(result.status, 'succeeded', JSON.stringify(result));
  assert.equal(result.errorCode, null); assert.equal(result.replayed, false);
  assert.equal(result.terminalStatePersisted, true); assert.equal(result.previewStatus, 'unverified');
  assert.deepEqual(result.metrics, metrics);
  assert.deepEqual(result.changedFiles, ['/src/App.tsx', '/src/generated/fixture.ts']);
  assert.deepEqual(activities.map(event => event.type), ['agent-started', 'agent-tool-finished', 'agent-tool-finished',
    'agent-tool-finished', 'agent-finished', 'validated', 'saved', 'ended']);
  assert.deepEqual(activities.map(event => event.sequence), activities.map((_, i) => i + 1));
  assert.deepEqual(activities.filter(event => event.type === 'agent-tool-finished').map(event => event.agentTool), ['read', 'edit', 'write']);
  const record = f.store.inspectGeneration(f.input); assert.ok(record?.candidateVersion);
  assert.equal(record.run.resultVersionId, result.candidateVersionId);
  assert.equal(record.candidateVersion.parentVersionId, f.input.baseVersionId);
  assert.equal(record.candidateVersion.snapshot.digest, result.candidateDigest);
  assert.deepEqual(record.candidateVersion.snapshot.files, { ...f.bundle.files,
    '/src/App.tsx': f.bundle.files['/src/App.tsx'] + edit, '/src/generated/fixture.ts': 'export const fixture = true;\n' });
  assert.deepEqual(f.store.getProject(f.session.id, f.input.projectId).currentVersion, f.detail.currentVersion);
  const messages = f.store.listMessages(f.session.id, f.input.projectId, 0, 20);
  assert.deepEqual(messages.items.map(message => message.role), ['user', 'assistant']);
  assert.equal(messages.items[0]?.content, f.input.prompt); assert.match(messages.items[1]?.content ?? '', /预览未验证/);
  const reports = await f.reports(); assert.equal(reports.length, 1);
  const report = reports[0]; assert.ok(report);
  assert.equal(report.original, f.bundle.files['/src/App.tsx']);
  assert.deepEqual(report.args, ['run', '--format', 'json', '--model', 'openai/fixture-model', '--agent', 'atoms', '--dir', report.project, '--pure']);
  assert.equal(report.messages.filter(message => message.content === f.input.prompt).length, 1);
  assert.equal(report.messages[0]?.role, 'system');
  await cleaned(report); privateOutput({ result, activities }, f);
  f.store.close();
  const reopened = openStore(f.filename); t.after(() => reopened.close());
  assert.deepEqual(reopened.inspectGeneration(f.input), record);
  assert.deepEqual(reopened.listMessages(f.session.id, f.input.projectId, 0, 20), messages);
  await rm(f.executable);
  const replay = await generateProject(f.input, { store: reopened, env: { ATOMS_OPENCODE_BIN: f.executable },
    observe: () => assert.fail('Replay must not emit execution activity') });
  assert.deepEqual(replay, { ...result, replayed: true });
  assert.equal((await f.reports()).length, 1);
  assert.deepEqual(reopened.inspectGeneration(f.input), record);
  assert.deepEqual(reopened.getProject(f.session.id, f.input.projectId).currentVersion, f.detail.currentVersion);
});

test('default CLI context follows adopted lineage and includes each current prompt exactly once', { timeout: 15_000 }, async t => {
  const f = await fixture(t);
  const foreign = f.store.createProject(f.session.id, 'foreign', f.bundle);
  f.store.appendMessages(foreign.project.id, [{ role: 'user', content: 'PRIVATE_FOREIGN_HISTORY' }]);
  const abandoned = await generateProject(f.input, { store: f.store, env: f.env });
  assert.equal(abandoned.status, 'succeeded');
  const adoptedInput = { ...f.input, requestId: randomUUID(), prompt: 'ADOPTED_LINEAGE_REQUIREMENT ATOMS_FIXTURE:success' };
  const adopted = await generateProject(adoptedInput, { store: f.store, env: f.env });
  assert.equal(adopted.status, 'succeeded'); assert.ok(adopted.candidateVersionId);
  f.store.adoptVersion(f.session.id, f.input.projectId, adopted.candidateVersionId, f.input.baseVersionId, () => null);
  const next = { ...f.input, requestId: randomUUID(), baseVersionId: adopted.candidateVersionId,
    prompt: 'NEW_LINEAGE_REQUIREMENT ATOMS_FIXTURE:add' };
  const result = await generateProject(next, { store: f.store, env: f.env });
  assert.equal(result.status, 'succeeded');
  const reports = await f.reports(); assert.equal(reports.length, 3);
  const report = reports[2]; assert.ok(report);
  assert.equal(report.original, f.bundle.files['/src/App.tsx'] + edit);
  assert.equal(report.messages.filter(message => message.content === adoptedInput.prompt).length, 1);
  assert.equal(report.messages.filter(message => message.content === next.prompt).length, 1);
  assert.equal(report.messages.at(-1)?.content, next.prompt);
  assert.ok(!JSON.stringify(report.messages).includes(f.input.prompt));
  assert.ok(!JSON.stringify(report.messages).includes('PRIVATE_FOREIGN_HISTORY'));
  assert.equal(f.store.inspectGeneration(next)?.candidateVersion?.parentVersionId, adopted.candidateVersionId);
  assert.equal(f.store.getProject(f.session.id, f.input.projectId).currentVersion.id, adopted.candidateVersionId);
  for (const item of reports) await cleaned(item);
});

for (const mode of ['protected', 'noop', 'error']) test(`default CLI ${mode} failure saves no version and exposes no provider output`, { timeout: 10_000 }, async t => {
  const f = await fixture(t, mode); const activities: GenerationActivity[] = [];
  const before = f.store.listVersions(f.session.id, f.input.projectId, 20);
  const result = await generateProject(f.input, { store: f.store, env: f.env, observe: event => activities.push(event) });
  assert.equal(result.status, 'failed'); assert.equal(result.errorCode, mode === 'error' ? 'MODEL_UPSTREAM' : 'FILE_POLICY');
  assert.equal(result.candidateVersionId, null); assert.equal(result.terminalStatePersisted, true);
  assert.deepEqual(result.metrics, metrics); assert.deepEqual(result.changedFiles, []);
  assert.equal(f.store.inspectGeneration(f.input)?.run.status, 'failed');
  assert.equal(f.store.inspectGeneration(f.input)?.candidateVersion, null);
  assert.deepEqual(f.store.listVersions(f.session.id, f.input.projectId, 20), before);
  assert.deepEqual(f.store.getProject(f.session.id, f.input.projectId).currentVersion, f.detail.currentVersion);
  assert.deepEqual(f.store.listMessages(f.session.id, f.input.projectId, 0, 20).items.map(message => message.content), [f.input.prompt]);
  assert.ok(!activities.some(event => ['validated', 'saved'].includes(event.type)));
  assert.equal(activities.filter(event => event.type === 'ended').length, 1);
  const report = (await f.reports())[0]; assert.ok(report); await cleaned(report);
  privateOutput({ result, activities }, f);
});

test('default CLI cancellation kills a live SIGTERM-resistant writer before cleanup and persists no candidate', { timeout: 10_000 }, async t => {
  const f = await fixture(t, 'cancel'); const controller = new AbortController();
  t.after(() => controller.abort());
  const activities: GenerationActivity[] = [];
  const running = generateProject(f.input, { store: f.store, env: f.env, signal: controller.signal, observe: event => activities.push(event) });
  const report = await started(f);
  await until(() => activities.some(event => event.type === 'agent-tool-finished' && event.agentTool === 'edit'));
  assert.equal(f.store.inspectGeneration(f.input)?.run.status, 'running');
  controller.abort('USER_CANCELLED');
  const result = await running;
  assert.equal(result.status, 'cancelled'); assert.equal(result.errorCode, 'USER_CANCELLED');
  assert.equal(result.terminalStatePersisted, true); assert.deepEqual(result.metrics, metrics);
  assert.equal(await readFile(f.executable + '.term', 'utf8'), 'ignored');
  await cleaned(report);
  assert.equal(f.store.inspectGeneration(f.input)?.candidateVersion, null);
  assert.equal(f.store.inspectGeneration(f.input)?.run.status, 'cancelled');
  assert.equal(f.store.listVersions(f.session.id, f.input.projectId, 20).items.length, 1);
  assert.deepEqual(f.store.getProject(f.session.id, f.input.projectId).currentVersion, f.detail.currentVersion);
  assert.ok(!activities.some(event => ['validated', 'saved', 'agent-finished'].includes(event.type)));
  privateOutput({ result, activities }, f);
});

async function httpFixture(t: TestContext, mode = 'success') {
  const f = await fixture(t, mode);
  const logStream = new Writable({ write(chunk: Buffer, _encoding, callback) { f.logs.push(chunk.toString()); callback(); } });
  const app = buildApp({ logger: { level: 'info', stream: logStream } }, { store: f.store, catalog: f.catalog,
    origins: [origin], secureCookies: false, generation: { env: f.env,
      limits: { postPerMinute: 1000, queryPerMinute: 1000, cancelPerMinute: 1000 } } });
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  t.after(() => app.close());
  const headers = { origin, 'content-type': 'application/json', accept: 'text/event-stream', cookie: `atoms_session=${f.session.token}` };
  const path = `/api/projects/${f.input.projectId}/generations`;
  const query = `${path}/by-request/${f.input.requestId}`;
  const post = (signal?: AbortSignal) => fetch(base + path, { method: 'POST', headers,
    body: JSON.stringify({ requestId: f.input.requestId, baseVersionId: f.input.baseVersionId, prompt: f.input.prompt }),
    signal: signal ?? AbortSignal.timeout(8000) });
  const status = async () => {
    const response = await fetch(base + query, { headers, signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 200); return generationStatusSchema.parse(await response.json());
  };
  return { ...f, base, headers, query, post, status };
}

function frames(response: Response) {
  assert.ok(response.body); const reader = response.body.getReader();
  const decoder = new TextDecoder(); let pending = ''; const events: GenerationEvent[] = [];
  const next = async (): Promise<GenerationEvent | null> => {
    for (;;) {
      const end = pending.indexOf('\n\n');
      if (end >= 0) {
        const frame = pending.slice(0, end); pending = pending.slice(end + 2);
        if (frame.startsWith(':')) continue;
        const data = frame.split('\n').find(line => line.startsWith('data: ')); assert.ok(data);
        const event = generationEventSchema.parse(JSON.parse(data.slice(6)) as unknown);
        assert.equal(frame.split('\n')[0], `event: ${event.event}`); events.push(event); return event;
      }
      const chunk = await reader.read();
      if (chunk.done) { pending += decoder.decode(); assert.equal(pending, ''); return null; }
      pending += decoder.decode(chunk.value, { stream: true });
    }
  };
  return { next, events, all: async () => { while (await next()) { /* Consume through EOF, including any duplicate terminal. */ } return events; } };
}

test('real default-CLI HTTP SSE orders agent/validation/save events, emits one terminal and matches query/replay', { timeout: 15_000 }, async t => {
  const f = await httpFixture(t, 'add'); const response = await f.post();
  assert.equal(response.status, 200); assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
  const stream = frames(response); assert.equal((await stream.next())?.event, 'accepted');
  const events = await stream.all();
  assert.deepEqual(events.map(event => event.seq), events.map((_, i) => i + 1));
  for (const event of events) {
    assert.equal(event.projectId, f.input.projectId); assert.equal(event.requestId, f.input.requestId);
    assert.equal(event.runId, events[0]?.runId); assert.equal(event.baseVersionId, f.input.baseVersionId);
  }
  const activities = events.flatMap(event => event.event === 'activity' ? [event.activity] : []);
  assert.deepEqual(activities.map(activity => activity.type), ['agent-started', 'agent-tool-finished', 'agent-tool-finished',
    'agent-tool-finished', 'agent-finished', 'validated', 'saved']);
  const terminals = events.filter(event => event.event === 'terminal'); assert.equal(terminals.length, 1);
  const terminal = terminals[0]; assert.ok(terminal); assert.equal(events.at(-1), terminal);
  assert.equal(terminal.state.status, 'succeeded'); assert.equal(terminal.state.usage, null);
  assert.equal(terminal.state.previewStatus, 'unverified'); assert.equal(terminal.state.terminalStatePersisted, true);
  assert.deepEqual(terminal.state.changedFiles, ['/src/App.tsx', '/src/generated/fixture.ts']);
  assert.deepEqual(await f.status(), terminal.state);
  assert.equal(f.store.inspectGeneration(f.input)?.candidateVersion?.id, terminal.state.candidateVersionId);
  assert.deepEqual(f.store.getProject(f.session.id, f.input.projectId).currentVersion, f.detail.currentVersion);
  await rm(f.executable);
  const replay = await f.post(); assert.equal(replay.status, 200);
  assert.deepEqual(generationStatusSchema.parse(await replay.json()), terminal.state);
  const reports = await f.reports(); assert.equal(reports.length, 1); assert.ok(reports[0]); await cleaned(reports[0]);
  privateOutput({ events, state: await f.status() }, f);
});

for (const action of ['cancel-endpoint', 'original-disconnect'] as const) test(`real default-CLI HTTP ${action} kills the live process and keeps SQLite unchanged`, { timeout: 15_000 }, async t => {
  const f = await httpFixture(t, 'cancel'); const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await f.post(controller.signal); assert.equal(response.status, 200);
  const stream = frames(response); assert.equal((await stream.next())?.event, 'accepted');
  const report = await started(f);
  while (!stream.events.some(event => event.event === 'activity' && event.activity.type === 'agent-tool-finished' && event.activity.agentTool === 'edit')) {
    assert.ok(await stream.next());
  }
  assert.equal((await f.status()).status, 'running');
  if (action === 'cancel-endpoint') {
    const cancel = await fetch(f.base + f.query + '/cancel', { method: 'POST', headers: f.headers, body: '{}', signal: AbortSignal.timeout(3000) });
    assert.equal(cancel.status, 202); assert.equal(generationStatusSchema.parse(await cancel.json()).cancellationRequested, true);
    const events = await stream.all(); const terminals = events.filter(event => event.event === 'terminal');
    assert.equal(terminals.length, 1); assert.ok(terminals[0]);
    assert.equal(terminals[0].state.status, 'cancelled'); assert.equal(terminals[0].state.errorCode, 'USER_CANCELLED');
    assert.deepEqual(await f.status(), terminals[0].state);
  } else {
    controller.abort(); await assert.rejects(stream.all());
    await until(async () => (await f.status()).status === 'cancelled');
    assert.equal((await f.status()).errorCode, 'CLIENT_DISCONNECTED');
  }
  assert.equal(await readFile(f.executable + '.term', 'utf8'), 'ignored'); await cleaned(report);
  const state = await f.status(); assert.equal(state.candidateVersionId, null); assert.equal(state.terminalStatePersisted, true);
  assert.equal(f.store.inspectGeneration(f.input)?.candidateVersion, null);
  assert.equal(f.store.listVersions(f.session.id, f.input.projectId, 20).items.length, 1);
  assert.deepEqual(f.store.getProject(f.session.id, f.input.projectId).currentVersion, f.detail.currentVersion);
  assert.deepEqual(f.store.listMessages(f.session.id, f.input.projectId, 0, 20).items.map(message => message.content), [f.input.prompt]);
  assert.ok(!stream.events.some(event => event.event === 'activity' && ['validated', 'saved'].includes(event.activity.type)));
  assert.equal((await f.reports()).length, 1); privateOutput({ events: stream.events, state }, f);
});
