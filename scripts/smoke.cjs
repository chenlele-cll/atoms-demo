/* global document, window, requestAnimationFrame */
const assert = require('node:assert/strict');
const { existsSync, mkdirSync, mkdtempSync, rmSync } = require('node:fs');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('playwright-core');
const net = require('node:net');
const { ownChild, signalOwned, groupAlive, closeBrowser } = require('./verification/processes.cjs');
const { createEvidence } = require('./verification/evidence.cjs');
const evidence = createEvidence('smoke');
const report = { status: 'running', cleanup: 'not-run', cases: [] };
let ownedBrowser; let interrupted;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  interrupted = signal;
  for (const child of children) signalOwned(child, 'SIGTERM');
  void ownedBrowser?.close().catch(() => {});
});

const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'test-results', 'smoke');
const children = [];
const backendWorkingDirectory = mkdtempSync(path.join(os.tmpdir(), 'atoms-connection-smoke-'));
const backendEnvironment = { PATH: process.env.PATH ?? '', HOST: '127.0.0.1', PORT: '3001', DATABASE_PATH: path.join(backendWorkingDirectory, 'data/atoms.sqlite') };

function launch(args, cwd, node = false) {
  const child = spawn(node ? process.execPath : 'pnpm', args, { cwd, detached: true, ...(node ? { env: backendEnvironment } : {}), stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  children.push(child);
  ownChild(child);
  return { child, output: () => output };
}

function groupExists(child) {
  return groupAlive(child);
}
async function stop(child) {
  if (!groupExists(child)) return;
  signalOwned(child, 'SIGTERM');
  const deadline = Date.now() + 5000;
  while (groupExists(child) && Date.now() < deadline) await delay(50);
  if (groupExists(child)) signalOwned(child, 'SIGKILL');
  const hardDeadline = Date.now() + 2000;
  while (groupExists(child) && Date.now() < hardDeadline) await delay(50);
  assert.equal(groupExists(child), false, 'Owned smoke process group leaked');
}

async function waitForReady(url, proc) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (proc.child.exitCode !== null) throw new Error(`Process exited early:\n${proc.output()}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      await delay(100);
      continue;
    }
    await delay(100);
  }
  throw new Error(`Startup timeout: ${url}\n${proc.output()}`);
}

async function assertPortFree(port) {
  await new Promise((resolve, reject) => { const listener = net.createServer(); listener.once('error', () => reject(new Error(`Port ${port} is already in use`))); listener.listen(port, '127.0.0.1', () => listener.close(resolve)); });
}

async function openBrowser() {
  try {
    return await chromium.launch({ channel: 'chrome', headless: true, handleSIGINT: false, handleSIGTERM: false });
  } catch (error) {
    throw new Error(
      'Cannot launch Google Chrome via playwright-core. Install Chrome or set another browser channel.',
      { cause: error },
    );
  }
}

async function run() {
  for (const port of [3001, 5173, 4173]) {
    await assertPortFree(port);
  }
  if (!existsSync(path.join(root, 'backend', 'dist', 'server.js'))) {
    throw new Error('backend/dist/server.js is missing; run `pnpm build` first');
  }

  mkdirSync(artifacts, { recursive: true });

  const backend = launch(['--import', require.resolve('tsx', { paths: [path.join(root, 'backend')] }), path.join(root, 'backend/src/server.ts')], backendWorkingDirectory, true);
  const frontend = launch(['dev'], path.join(root, 'frontend'));
  await Promise.all([
    waitForReady('http://127.0.0.1:3001/api/health', backend),
    waitForReady('http://127.0.0.1:5173', frontend),
  ]);

  const browser = await openBrowser();
  ownedBrowser = browser;
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const runtimeErrors = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));

    await page.goto('http://127.0.0.1:5173/diagnostics/connection');
    await page.getByRole('button', { name: '检查后端连接' }).click();
    await page.getByText('连接正常，前端已通过 /api 访问独立的 Fastify 服务。').waitFor();
    await page.screenshot({ path: path.join(artifacts, 'dev-desktop.png'), fullPage: true });

    for (const width of [320, 375, 768]) {
      await page.setViewportSize({ width, height: 812 });
      const overflows = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.equal(overflows <= 0, true, `horizontal overflow at ${width}px: ${overflows}px`);
    }
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: path.join(artifacts, 'dev-mobile.png'), fullPage: true });
    report.cases.push({ id: 'dev-connection-and-layout', status: 'passed', durationMs: null });

    await page.route('**/api/health', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ status: 'unexpected' }),
    }));
    await page.getByRole('button', { name: '检查后端连接' }).click();
    await page.getByText('后端健康检查响应格式不正确').waitFor();
    await page.unroute('**/api/health');

    await stop(backend.child);
    await delay(300);
    await page.getByRole('button', { name: '检查后端连接' }).click();
    await page.getByText(/后端返回 HTTP/).waitFor();
    assert.equal(await page.getByRole('button', { name: '检查后端连接' }).isEnabled(), true);
    await page.screenshot({ path: path.join(artifacts, 'dev-backend-offline.png'), fullPage: true });
    report.cases.push({ id: 'invalid-response-and-offline-recovery', status: 'passed', durationMs: null });

    const production = launch([path.join(root, 'backend/dist/server.js')], backendWorkingDirectory, true);
    const preview = launch(['preview'], path.join(root, 'frontend'));
    await Promise.all([
      waitForReady('http://127.0.0.1:3001/api/health', production),
      waitForReady('http://127.0.0.1:4173', preview),
    ]);
    await page.goto('http://127.0.0.1:4173/diagnostics/connection');
    await page.getByRole('button', { name: '检查后端连接' }).click();
    await page.getByText('连接正常，前端已通过 /api 访问独立的 Fastify 服务。').waitFor();

    await page.goto('http://127.0.0.1:4173');
    await page.getByRole('heading', { name: /把你的想法/ }).waitFor();
    await page.getByRole('button', { name: '创建并生成', exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: '你想创建什么？', exact: true }).isVisible(), true);

    assert.deepEqual(runtimeErrors, []);
    report.cases.push({ id: 'production-proxy-and-creation-entry', status: 'passed', durationMs: null });
    report.status = 'passed';
    console.log('PASS: independent dev startup, /api proxy, 320/375/768/1280px layout,');
    console.log('PASS: invalid response handling, backend-offline error and recovery,');
    console.log('PASS: production backend + frontend preview; no browser runtime errors.');
  } finally {
    await closeBrowser(browser);
  }
}

run().catch((error) => {
  console.error(error);
  report.status = interrupted ? 'cancelled' : 'failed';
  process.exitCode = interrupted === 'SIGINT' ? 130 : interrupted ? 143 : 1;
}).finally(async () => {
  const stopped = await Promise.allSettled(children.map(child => stop(child)));
  rmSync(backendWorkingDirectory, { recursive: true, force: true });
  report.cleanup = stopped.some(result => result.status === 'rejected') ? 'failed' : 'passed';
  if (report.cleanup === 'failed') { report.status = 'failed'; process.exitCode = 1; }
  evidence.finish(report);
});
