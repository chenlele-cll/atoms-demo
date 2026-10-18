/* global document */
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const { cp, mkdir, rm, symlink, writeFile, access, rename } = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const runId = randomUUID();
const output = path.join(root, 'test-results/project-persistence', runId);
const runtime = path.join(output, 'runtime');
const deploy = path.join(runtime, 'deploy/backend');
const browserRepo = path.join(runtime, 'browser-repo');
const database = path.join(runtime, 'data/atoms.sqlite');
const children = new Set();
const report = { runId, suite: 'project-persistence', source: 'explicit-test-fixture', status: 'running', cases: [], cleanup: 'not-run', modelRequests: 0 };
let browser; let interrupted; let logs = ''; let backend;

function signalGroup(child, signal) {
  if (!child.pid) return;
  try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}
function groupAlive(child) {
  if (!child.pid) return false;
  try { process.kill(-child.pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
async function stop(child) {
  if (!child) return;
  signalGroup(child, 'SIGTERM');
  const deadline = Date.now() + 5000;
  while (groupAlive(child) && Date.now() < deadline) await delay(40);
  if (groupAlive(child)) signalGroup(child, 'SIGKILL');
  const hardDeadline = Date.now() + 2000;
  while (groupAlive(child) && Date.now() < hardDeadline) await delay(40);
  assert.equal(groupAlive(child), false, 'Owned process group leaked'); children.delete(child);
}
function cancelled(signal) {
  interrupted = signal;
  for (const child of children) signalGroup(child, 'SIGTERM');
  if (browser) void browser.close().catch(() => {});
}
process.once('SIGINT', () => cancelled('SIGINT'));
process.once('SIGTERM', () => cancelled('SIGTERM'));
function check() { if (interrupted) throw new Error('Cancelled'); }
async function portFree(port) {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', () => reject(new Error(`Port ${port} is occupied; its owner was left untouched.`)));
    listener.listen(port, '127.0.0.1', resolve);
  });
  await new Promise(resolve => listener.close(resolve));
}
function launch(script, args, cwd, extra = {}) {
  check();
  const child = spawn(process.execPath, [script, ...args], { cwd, detached: true,
    env: { PATH: process.env.PATH ?? '', HOST: '127.0.0.1', PORT: '3001', DATABASE_PATH: database,
      API_PROXY_TARGET: 'http://127.0.0.1:3001', ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  child.on('error', () => { logs += 'Owned subprocess could not start.\n'; });
  child.stdout.on('data', data => { logs += data.toString(); }); child.stderr.on('data', data => { logs += data.toString(); });
  return child;
}
async function ready(url, child) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    check(); if (child.exitCode !== null || child.signalCode !== null) throw new Error('Owned process exited before readiness');
    try { if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) return; } catch { /* waiting */ }
    await delay(100);
  }
  throw new Error('Owned process readiness timed out');
}
async function startBackend() {
  backend = launch(path.join(deploy, 'dist/server.js'), [], deploy);
  await ready('http://127.0.0.1:3001/api/health', backend);
}
async function scenario(name, work) {
  check(); const started = Date.now();
  await work(); report.cases.push({ name, status: 'passed', durationMs: Date.now() - started });
  console.log(`PASS: ${name}`);
}
function digest(value) {
  const canonical = input => Array.isArray(input) ? `[${input.map(canonical).join(',')}]`
    : input !== null && typeof input === 'object' ? `{${Object.keys(input).sort().map(key => `${JSON.stringify(key)}:${canonical(input[key])}`).join(',')}}` : JSON.stringify(input);
  return createHash('sha256').update(canonical(value)).digest('hex');
}
async function api(page, method, url, body) {
  check();
  return page.evaluate(async input => {
    const response = await fetch(input.url, { method: input.method, credentials: 'same-origin',
      ...(input.body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(input.body) }),
      signal: AbortSignal.timeout(10_000) });
    return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
  }, { method, url, body });
}
async function setup() {
  // Deployment layout deliberately has no frontend or root template source.
  const { prepareBackendRuntime } = await import('./prepare-backend-runtime.mjs');
  await prepareBackendRuntime(root, deploy);
  await assert.rejects(access(path.join(runtime, 'deploy/frontend')));
  await assert.rejects(access(path.join(runtime, 'deploy/templates')));
  await mkdir(browserRepo, { recursive: true });
  await cp(path.join(root, 'package.json'), path.join(browserRepo, 'package.json'));
  await cp(path.join(root, 'tsconfig.base.json'), path.join(browserRepo, 'tsconfig.base.json'));
  await cp(path.join(root, 'templates'), path.join(browserRepo, 'templates'), { recursive: true });
  await cp(path.join(root, 'frontend'), path.join(browserRepo, 'frontend'), { recursive: true,
    filter: source => !['node_modules', '.env', 'data'].includes(path.basename(source)) && !path.basename(source).startsWith('.env.') });
  await symlink(path.join(root, 'node_modules'), path.join(browserRepo, 'node_modules'), 'dir');
  await symlink(path.join(root, 'frontend/node_modules'), path.join(browserRepo, 'frontend/node_modules'), 'dir');
}
async function mode(name, port) {
  const frontend = launch(path.join(root, 'frontend/node_modules/vite/bin/vite.js'), name === 'preview' ? ['preview'] : [], path.join(browserRepo, 'frontend'));
  await ready(`http://127.0.0.1:${port}`, frontend);
  const a = await browser.newContext(); const b = await browser.newContext();
  const page = await a.newPage(); const other = await b.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.name)); other.on('pageerror', error => errors.push(error.name));
  let created; let originalHash; let cookie;
  try {
    await page.goto(`http://127.0.0.1:${port}/diagnostics/connection`); await other.goto(`http://127.0.0.1:${port}/diagnostics/connection`);
    await scenario(`${name}: relative API, HttpOnly cookie, template project and empty conversation`, async () => {
      const templates = await api(page, 'GET', '/api/templates'); assert.equal(templates.status, 200);
      assert.equal((await a.cookies()).length, 0);
      const session = await api(page, 'POST', '/api/session', {}); assert.equal(session.status, 201);
      cookie = (await a.cookies()).find(item => item.name === 'atoms_session'); assert.ok(cookie);
      assert.equal(cookie.httpOnly, true); assert.equal(cookie.sameSite, 'Strict'); assert.equal(cookie.path, '/api');
      assert.equal(await page.evaluate(() => document.cookie.includes('atoms_session=')), false);
      assert.equal((await api(page, 'POST', '/api/session', {})).status, 200);
      const template = templates.body.items[0];
      const result = await api(page, 'POST', '/api/projects', { title: `${name} explicit browser fixture`, templateId: template.id,
        templateVersion: template.version, templateDigest: template.digest });
      assert.equal(result.status, 201); created = result.body; originalHash = digest(created.currentVersion.snapshot);
      assert.equal(created.currentVersion.sequence, 0); assert.equal(created.latestRun, null);
      assert.equal((await api(page, 'GET', '/api/projects')).body.items[0].id, created.project.id);
      const messages = await api(page, 'GET', `/api/projects/${created.project.id}/messages`);
      assert.equal(messages.body.items.length, 0); assert.equal(messages.body.nextAfterSequence, null); assert.equal(messages.cache, 'no-store');
      await page.reload(); const restored = await api(page, 'GET', `/api/projects/${created.project.id}`);
      assert.equal(digest(restored.body.currentVersion.snapshot), originalHash);
    });
    await scenario(`${name}: independent browser sessions cannot read each other's project`, async () => {
      assert.equal((await api(other, 'GET', '/api/projects')).status, 401);
      assert.equal((await api(other, 'POST', '/api/session', {})).status, 201);
      assert.equal((await api(other, 'GET', '/api/projects')).body.items.length, 0);
      for (const suffix of ['', '/messages']) {
        const denied = await api(other, 'GET', `/api/projects/${created.project.id}${suffix}`);
        const missing = await api(other, 'GET', `/api/projects/${randomUUID()}${suffix}`);
        assert.equal(denied.status, 404); assert.equal(missing.status, 404); assert.equal(digest(denied.body.error), digest(missing.body.error));
      }
    });
    await scenario(`${name}: dist restart restores full snapshot and explicit message/run/candidate fixtures`, async () => {
      await stop(backend);
      const { openStore } = await import(pathToFileURL(path.join(deploy, 'dist/storage/store.js')).href);
      const asset = path.join(deploy, 'dist/template-assets/company-landing.bundle.json');
      await rename(asset, `${asset}.held`);
      const store = openStore(database);
      try {
        const owner = store.findSession(cookie.value); assert.ok(owner);
        const detail = store.getProject(owner.id, created.project.id); assert.equal(digest(detail.currentVersion.snapshot), originalHash);
        store.appendMessages(created.project.id, [{ role: 'user', content: 'EXPLICIT FIXTURE: stored before run' }]);
        const run = store.createRun({ projectId: created.project.id, requestId: randomUUID(), baseVersionId: created.currentVersion.id,
          messages: [{ role: 'user', content: 'EXPLICIT FIXTURE: candidate request; no model call' }] });
        const candidate = structuredClone(created.currentVersion.snapshot);
        candidate.files[candidate.entry] += '\n// EXPLICIT PERSISTENCE FIXTURE\n';
        const { digest: old, ...content } = candidate; void old; candidate.digest = digest(content);
        store.saveCandidate({ projectId: created.project.id, runId: run.id, snapshot: candidate,
          messages: [{ role: 'assistant', content: 'EXPLICIT FIXTURE: stored candidate; not model output' }] });
      } finally { store.close(); await rename(`${asset}.held`, asset); }
      await startBackend();
      assert.equal((await api(page, 'POST', '/api/session', {})).status, 200);
      const after = await api(page, 'GET', `/api/projects/${created.project.id}`);
      assert.equal(after.status, 200); assert.equal(after.body.project.id, created.project.id);
      assert.equal(digest(after.body.currentVersion.snapshot), originalHash);
      assert.equal(after.body.project.currentVersionId, created.currentVersion.id);
      assert.equal(after.body.latestRun.status, 'succeeded'); assert.notEqual(after.body.latestRun.resultVersionId, created.currentVersion.id);
      const sequences = []; let cursor = 0;
      do {
        const pageResult = await api(page, 'GET', `/api/projects/${created.project.id}/messages?limit=1&afterSequence=${cursor}`);
        sequences.push(...pageResult.body.items.map(message => message.sequence)); cursor = pageResult.body.nextAfterSequence;
      } while (cursor !== null);
      assert.deepEqual(sequences, [1, 2, 3]);
      assert.deepEqual(errors, []);
    });
  } finally { await Promise.allSettled([a.close(), b.close(), stop(frontend)]); }
}
async function main() {
  await mkdir(output, { recursive: true });
  for (const port of [3001, 5173, 4173]) await portFree(port);
  await setup(); await startBackend();
  browser = await chromium.launch({ channel: 'chrome', headless: true, handleSIGINT: false, handleSIGTERM: false });
  await mode('dev', 5173); await mode('preview', 4173);
  report.status = 'passed';
}
main().catch(error => {
  report.status = interrupted ? 'cancelled' : 'failed'; report.error = error.message;
  console.error(`Project smoke ${report.status}: ${error.message}`); process.exitCode = interrupted === 'SIGINT' ? 130 : interrupted ? 143 : 1;
}).finally(async () => {
  let timer;
  try {
    const cleanup = await Promise.allSettled([
      ...(browser ? [Promise.race([browser.close(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Browser cleanup timeout')), 3000); })])] : []),
      ...Array.from(children, child => stop(child)),
    ]);
    await rm(runtime, { recursive: true, force: true });
    assert.ok(cleanup.every(result => result.status === 'fulfilled')); report.cleanup = 'passed';
  } catch { report.cleanup = 'failed'; process.exitCode = 1; }
  finally { clearTimeout(timer); }
  if (interrupted) {
    report.status = 'cancelled';
    process.exitCode = interrupted === 'SIGINT' ? 130 : 143;
  }
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== 'passed') await writeFile(path.join(output, 'diagnostic.log'), logs);
  console.log(`Project persistence report: ${path.relative(root, path.join(output, 'report.json'))}`);
});
