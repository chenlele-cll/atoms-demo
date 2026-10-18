/* global window */
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { cp, mkdir, rm, symlink, access, writeFile } = require('node:fs/promises');
const { createServer } = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..'); const runId = randomUUID();
const output = path.join(root, 'test-results/generation-stream', runId); const runtime = path.join(output, 'runtime');
const deploy = path.join(runtime, 'backend'); const browserRepo = path.join(runtime, 'browser-repo');
const database = path.join(runtime, 'data/atoms.sqlite'); const children = new Set();
const report = { runId, suite: 'generation-stream', source: 'fixture', status: 'running', cases: [], cleanup: 'not-run',
  upstreamRequests: 0, upstreamAborts: 0, realModelCalls: 0, preview: 'unverified', finalReverseProxy: 'unverified' };
let browser; let backend; let interrupted; let upstream; let upstreamOrigin; let releaseNormal = false;
const normalWaiters = []; let bufferedLogs = '';
function signalGroup(child, signal) { if (child?.pid) try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
function alive(child) { if (!child?.pid) return false; try { process.kill(-child.pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } }
async function stop(child) {
  if (!child) return; signalGroup(child, 'SIGTERM'); const deadline = Date.now() + 6000;
  while (alive(child) && Date.now() < deadline) await delay(40);
  if (alive(child)) signalGroup(child, 'SIGKILL'); const hard = Date.now() + 2000;
  while (alive(child) && Date.now() < hard) await delay(40);
  assert.equal(alive(child), false, 'Owned group did not stop'); children.delete(child);
}
function check() { if (interrupted) throw new Error('Cancelled'); }
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  interrupted = signal; for (const child of children) signalGroup(child, 'SIGTERM'); void browser?.close().catch(() => {});
});
async function portFree(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', () => reject(new Error(`Port ${port} is occupied; its owner was left untouched.`))); server.listen(port, '127.0.0.1', resolve); });
  await new Promise(resolve => server.close(resolve));
}
function launch(script, args, cwd) {
  check(); const child = spawn(process.execPath, [script, ...args], { cwd, detached: true,
    env: { PATH: process.env.PATH ?? '', API_PROXY_TARGET: 'http://127.0.0.1:3001' }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child); child.on('error', () => { bufferedLogs += 'Owned process failed.\n'; });
  child.stdout.on('data', data => { bufferedLogs += data.toString(); }); child.stderr.on('data', data => { bufferedLogs += data.toString(); }); return child;
}
async function ready(url, child) {
  for (let i = 0; i < 200; i++) {
    check(); if (child.exitCode !== null || child.signalCode !== null) throw new Error('Owned process exited before readiness');
    try { if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) return; } catch { /* Wait for owned service. */ }
    await delay(50);
  } throw new Error('Owned service readiness timed out');
}
async function startBackend() {
  backend = launch(path.join(root, 'scripts/generation-stream-server.mjs'), [path.join(deploy, 'dist'), database, '3001', upstreamOrigin], deploy);
  await ready('http://127.0.0.1:3001/api/health', backend);
}
async function scenario(name, work) { check(); const start = Date.now(); await work(); report.cases.push({ name, status: 'passed', durationMs: Date.now() - start }); console.log(`PASS: ${name}`); }
async function api(page, method, url, body) {
  check(); return page.evaluate(async args => {
    const response = await fetch(args.url, { method: args.method, ...(args.body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(args.body) }), signal: AbortSignal.timeout(5000) });
    return { status: response.status, body: await response.json() };
  }, { method, url, body });
}
async function startStream(page, project, hold = false) {
  const requestId = randomUUID();
  const first = await page.evaluate(async ({ project, requestId, hold }) => {
    const controller = new AbortController();
    const response = await fetch(`/api/projects/${project.project.id}/generations`, { method: 'POST', signal: controller.signal,
      headers: { accept: 'text/event-stream', 'content-type': 'application/json' },
      body: JSON.stringify({ requestId, baseVersionId: project.currentVersion.id, prompt: hold ? 'STREAM_SMOKE_WAIT_FOR_ABORT' : 'STREAM_SMOKE_NORMAL' }) });
    if (response.status !== 200 || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('Expected SSE');
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = ''; const events = []; const wire = [];
    const parse = () => {
      let end; while ((end = pending.indexOf('\n\n')) >= 0) {
        const frame = pending.slice(0, end); pending = pending.slice(end + 2);
        if (frame.startsWith(':')) continue;
        const line = frame.split('\n').find(item => item.startsWith('data: '));
        if (!line) throw new Error('Invalid frame'); const event = JSON.parse(line.slice(6));
        if (event.seq !== events.length + 1 || event.requestId !== requestId || event.projectId !== project.project.id) throw new Error('Invalid event association');
        events.push(event);
      }
    };
    async function next() {
      const chunk = await reader.read();
      if (chunk.done) { pending += decoder.decode(); parse(); return false; }
      wire.push(...chunk.value); pending += decoder.decode(chunk.value, { stream: true }); parse(); return true;
    }
    while (!events.length && await next()) { /* Wait only for the first frame. */ }
    if (events[0]?.event !== 'accepted') throw new Error('Missing first accepted');
    window.atomsStreamFixture = { controller, reader, events, next, wire };
    return events[0];
  }, { project, requestId, hold });
  return { first, requestId, query: `/api/projects/${project.project.id}/generations/by-request/${requestId}` };
}
async function finishStream(page) {
  return page.evaluate(async () => {
    const stream = window.atomsStreamFixture;
    while (await stream.next()) { /* EOF itself is not a success. */ }
    const terminal = stream.events.filter(event => event.event === 'terminal');
    if (terminal.length !== 1) throw new Error('Expected exactly one terminal');
    // Reparse captured real frames at every byte boundary; UTF-8 comments are an explicit decoder fixture.
    const bytes = new Uint8Array([...new TextEncoder().encode(': UTF-8 fixture 测试🙂\n\n'), ...stream.wire]);
    const decoder = new TextDecoder('utf-8', { fatal: true }); let text = '';
    for (const byte of bytes) text += decoder.decode(new Uint8Array([byte]), { stream: true }); text += decoder.decode();
    if (!text.includes('测试🙂')) throw new Error('Split UTF-8 lost');
    const reparsed = text.split('\n\n').filter(frame => frame.startsWith('event:')).map(frame => JSON.parse(frame.split('\n').find(line => line.startsWith('data: ')).slice(6)));
    if (JSON.stringify(reparsed) !== JSON.stringify(stream.events)) throw new Error('Byte split frames changed');
    return { terminal: terminal[0].state, events: stream.events.length };
  });
}
async function waitStatus(page, query, expected) {
  for (let i = 0; i < 100; i++) { check(); const state = await api(page, 'GET', query); if (state.status === 200 && state.body.status === expected) return state.body; await delay(30); }
  throw new Error('Persisted generation state timed out');
}
async function mode(name, port) {
  const frontend = launch(path.join(root, 'frontend/node_modules/vite/bin/vite.js'), name === 'preview' ? ['preview'] : [], path.join(browserRepo, 'frontend'));
  await ready(`http://127.0.0.1:${port}`, frontend); const context = await browser.newContext(); const page = await context.newPage();
  const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.name));
  try {
    await page.goto(`http://127.0.0.1:${port}`); await api(page, 'POST', '/api/session', {});
    const templates = await api(page, 'GET', '/api/templates'); const template = templates.body.items[0];
    const created = await api(page, 'POST', '/api/projects', { title: `${name} stream fixture`, templateId: template.id, templateVersion: template.version, templateDigest: template.digest });
    assert.equal(created.status, 201); const project = created.body; let success;
    await scenario(`${name}: accepted before gated upstream, actual terminal and byte-split UTF-8 decoder`, async () => {
      releaseNormal = false; success = await startStream(page, project);
      assert.equal((await api(page, 'GET', success.query)).body.status, 'running');
      releaseNormal = true; for (const resolve of normalWaiters.splice(0)) resolve();
      const finished = await finishStream(page); assert.equal(finished.terminal.status, 'succeeded'); assert.equal(finished.terminal.previewStatus, 'unverified');
      assert.ok(finished.events > 3); assert.ok(finished.terminal.candidateVersionId);
    });
    await scenario(`${name}: explicit cancel confirms cancelled via relative API`, async () => {
      const running = await startStream(page, project, true);
      const cancelled = await api(page, 'POST', running.query + '/cancel', {}); assert.equal(cancelled.status, 202); assert.equal(cancelled.body.cancellationRequested, true);
      const finished = await finishStream(page); assert.equal(finished.terminal.status, 'cancelled');
      assert.equal((await waitStatus(page, running.query, 'cancelled')).errorCode, 'USER_CANCELLED');
    });
    await scenario(`${name}: browser abort propagates through actual proxy and requestId query confirms disconnect`, async () => {
      const running = await startStream(page, project, true);
      await page.evaluate(() => window.atomsStreamFixture.controller.abort());
      assert.equal((await waitStatus(page, running.query, 'cancelled')).errorCode, 'CLIENT_DISCONNECTED');
    });
    await scenario(`${name}: owned backend restart retains success and unchanged current version`, async () => {
      await stop(backend); await startBackend();
      assert.equal((await waitStatus(page, success.query, 'succeeded')).previewStatus, 'unverified');
      const restored = await api(page, 'GET', `/api/projects/${project.project.id}`); assert.equal(restored.body.currentVersion.id, project.currentVersion.id);
      assert.equal(restored.body.currentVersion.snapshot.digest, project.currentVersion.snapshot.digest); assert.deepEqual(pageErrors, []);
    });
  } finally { await Promise.allSettled([context.close(), stop(frontend)]); }
}
async function main() {
  await mkdir(output, { recursive: true }); for (const port of [3001, 5173, 4173]) await portFree(port);
  await access(path.join(root, 'backend/dist/storage/ownership.js')); await access(path.join(root, 'frontend/dist/index.html'));
  const { prepareBackendRuntime } = await import('./prepare-backend-runtime.mjs');
  await prepareBackendRuntime(root, deploy);
  await mkdir(browserRepo, { recursive: true });
  for (const name of ['package.json', 'tsconfig.base.json', 'templates']) await cp(path.join(root, name), path.join(browserRepo, name), { recursive: true });
  await cp(path.join(root, 'frontend'), path.join(browserRepo, 'frontend'), { recursive: true, filter: source => !['node_modules', '.env', 'data'].includes(path.basename(source)) && !path.basename(source).startsWith('.env.') });
  await symlink(path.join(root, 'node_modules'), path.join(browserRepo, 'node_modules'), 'dir');
  await symlink(path.join(root, 'frontend/node_modules'), path.join(browserRepo, 'frontend/node_modules'), 'dir');
  upstream = createServer(async (req, res) => {
    res.once('close', () => { if (!res.writableEnded) report.upstreamAborts++; }); const chunks = [];
    for await (const chunk of req) chunks.push(chunk); report.upstreamRequests++;
    const body = JSON.parse(Buffer.concat(chunks).toString()); const input = JSON.stringify(body.input);
    if (input.includes('STREAM_SMOKE_WAIT_FOR_ABORT')) return;
    if (!releaseNormal) await new Promise(resolve => normalWaiters.push(resolve));
    const step = body.input.filter(item => item.type === 'function_call_output').length;
    const name = step === 0 ? 'list_files' : step === 1 ? 'read_files' : 'submit_files';
    const args = step === 0 ? {} : step === 1 ? { paths: ['/src/App.tsx'] } : { files: [{ path: '/src/generated/StreamFixture.tsx', content: 'export const streamFixture = "Explicit transport fixture";' }] };
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: 'resp_stream_fixture', object: 'response', created_at: 1_790_000_000, status: 'completed', model: 'gpt-6.1-sol',
      output: [{ type: 'function_call', id: `fc_${step}`, call_id: `call_${step}`, name, arguments: JSON.stringify(args), status: 'completed' }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve)); upstreamOrigin = `http://127.0.0.1:${upstream.address().port}`;
  await startBackend(); browser = await chromium.launch({ channel: 'chrome', headless: true, handleSIGINT: false, handleSIGTERM: false });
  await mode('dev', 5173); await mode('preview', 4173); assert.ok(report.upstreamAborts >= 2); report.status = 'passed';
}
main().catch(error => { report.status = interrupted ? 'cancelled' : 'failed'; report.error = error.message; console.error(`Generation stream smoke ${report.status}: ${error.message}`); process.exitCode = interrupted === 'SIGINT' ? 130 : interrupted ? 143 : 1; })
  .finally(async () => {
    await browser?.close().catch(() => {}); for (const resolve of normalWaiters.splice(0)) resolve();
    const results = await Promise.allSettled([...children].map(stop));
    upstream?.closeAllConnections(); if (upstream?.listening) await new Promise(resolve => upstream.close(resolve));
    if (results.some(result => result.status === 'rejected')) { report.cleanup = 'failed'; process.exitCode = 1; }
    else { report.cleanup = 'passed'; await rm(runtime, { recursive: true, force: true }); }
    // Raw logs remain in memory: reports contain only protocol observations, never requests/cookies/SQL.
    void bufferedLogs; await mkdir(output, { recursive: true }); await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log(`Report: ${path.relative(root, path.join(output, 'report.json'))}`);
  });
