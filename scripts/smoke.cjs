/* global document, window, requestAnimationFrame */
const assert = require('node:assert/strict');
const { existsSync, mkdirSync } = require('node:fs');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'test-results', 'smoke');
const children = [];

function launch(args, cwd) {
  const child = spawn('pnpm', args, { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  children.push(child);
  return { child, output: () => output };
}

function stop(child) {
  try {
    if (child.exitCode === null && child.signalCode === null) {
      process.kill(-child.pid, 'SIGTERM');
    }
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
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
  try {
    await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(500) });
  } catch {
    return;
  }
  throw new Error(`Port ${port} is already in use`);
}

async function openBrowser() {
  try {
    return await chromium.launch({ channel: 'chrome', headless: true });
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

  const backend = launch(['dev'], path.join(root, 'backend'));
  const frontend = launch(['dev'], path.join(root, 'frontend'));
  await Promise.all([
    waitForReady('http://127.0.0.1:3001/api/health', backend),
    waitForReady('http://127.0.0.1:5173', frontend),
  ]);

  const browser = await openBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const runtimeErrors = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));

    await page.goto('http://127.0.0.1:5173');
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

    await page.route('**/api/health', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ status: 'unexpected' }),
    }));
    await page.getByRole('button', { name: '检查后端连接' }).click();
    await page.getByText('后端健康检查响应格式不正确').waitFor();
    await page.unroute('**/api/health');

    stop(backend.child);
    await new Promise((resolve) => backend.child.once('exit', resolve));
    await delay(300);
    await page.getByRole('button', { name: '检查后端连接' }).click();
    await page.getByText(/后端返回 HTTP/).waitFor();
    assert.equal(await page.getByRole('button', { name: '检查后端连接' }).isEnabled(), true);
    await page.screenshot({ path: path.join(artifacts, 'dev-backend-offline.png'), fullPage: true });

    const production = launch(['start'], path.join(root, 'backend'));
    const preview = launch(['preview'], path.join(root, 'frontend'));
    await Promise.all([
      waitForReady('http://127.0.0.1:3001/api/health', production),
      waitForReady('http://127.0.0.1:4173', preview),
    ]);
    await page.goto('http://127.0.0.1:4173');
    await page.getByRole('button', { name: '检查后端连接' }).click();
    await page.getByText('连接正常，前端已通过 /api 访问独立的 Fastify 服务。').waitFor();

    assert.deepEqual(runtimeErrors, []);
    console.log('PASS: independent dev startup, /api proxy, 320/375/768/1280px layout,');
    console.log('PASS: invalid response handling, backend-offline error and recovery,');
    console.log('PASS: production backend + frontend preview; no browser runtime errors.');
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  for (const child of children) stop(child);
});
