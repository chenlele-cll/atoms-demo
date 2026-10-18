/* global document, window, MutationObserver, getComputedStyle, requestAnimationFrame */
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const runId = randomUUID();
const artifacts = path.join(root, 'test-results/template-baseline', runId);
const children = new Set();
const ownedPorts = new Set();
const report = { runId, suite: 'template-baseline', source: 'template', status: 'running', cases: [], cleanup: 'not-run' };
let browser;
let interrupted;
let phase;

function signalReceived(signal) {
  interrupted = signal;
  for (const child of children) signalGroup(child, 'SIGTERM');
  if (browser) void browser.close().catch(() => undefined);
}
process.once('SIGINT', () => signalReceived('SIGINT'));
process.once('SIGTERM', () => signalReceived('SIGTERM'));

async function portFree(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error(`Port ${port} is occupied; its owner was left untouched.`)));
    server.listen({ host: '127.0.0.1', port }, () => server.close(resolve));
  });
}

function groupExists(child) {
  if (!child.pid) return false;
  try { process.kill(-child.pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

function signalGroup(child, signal) {
  if (!child.pid) return;
  try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}

async function stop(child) {
  signalGroup(child, 'SIGTERM');
  let deadline = Date.now() + 5000;
  while (groupExists(child) && Date.now() < deadline) await delay(50);
  if (groupExists(child)) {
    signalGroup(child, 'SIGKILL');
    deadline = Date.now() + 2000;
    while (groupExists(child) && Date.now() < deadline) await delay(50);
  }
  assert.equal(groupExists(child), false, 'Owned process group was not cleaned up');
  children.delete(child);
}

async function bounded(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

async function cleanupOwned() {
  const cleanup = await Promise.allSettled([
    ...(browser ? [bounded(browser.close(), 3000, 'Browser cleanup timed out')] : []),
    ...Array.from(children, (child) => stop(child)),
  ]);
  const errors = cleanup.filter((result) => result.status === 'rejected');
  if (errors.length) throw new AggregateError(errors.map((result) => result.reason), 'Owned process/browser cleanup failed');
  for (const port of ownedPorts) await portFree(port);
}

async function launch(mode) {
  if (interrupted) throw new Error('Interrupted');
  const args = ['--filter', '@atoms/frontend', mode];
  const child = spawn('pnpm', args, { cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  let output = '';
  child.stdout.on('data', (data) => { output = (output + data).slice(-128 * 1024); });
  child.stderr.on('data', (data) => { output = (output + data).slice(-128 * 1024); });
  let spawnError;
  child.once('error', (error) => { spawnError = error; });
  const origin = `http://127.0.0.1:${mode === 'dev' ? 5173 : 4173}`;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (interrupted || spawnError || child.exitCode !== null) throw new Error(`Frontend startup failed (${mode}). ${spawnError?.message || output}`);
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(1000) });
      if (response.ok && (await response.text()).includes('<title>Atoms Demo</title>')) {
        ownedPorts.add(mode === 'dev' ? 5173 : 4173);
        return { child, origin, log: () => output };
      }
    } catch { /* readiness is bounded and checks the owned process on the next iteration */ }
    await delay(100);
  }
  throw new Error(`Frontend startup timed out (${mode}).`);
}

async function check(id, fn) {
  if (interrupted) throw new Error('Interrupted');
  phase = id;
  const started = Date.now();
  try {
    await fn();
    report.cases.push({ id, status: 'passed', durationMs: Date.now() - started });
    console.log(`PASS ${id}`);
  } catch (error) {
    report.cases.push({ id, status: 'failed', durationMs: Date.now() - started });
    throw error;
  } finally {
    await writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
}

async function pageContext(viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    const messageListeners = new Set();
    const add = window.addEventListener.bind(window);
    const remove = window.removeEventListener.bind(window);
    window.addEventListener = (type, listener, options) => {
      if (type === 'message') messageListeners.add(listener);
      return add(type, listener, options);
    };
    window.removeEventListener = (type, listener, options) => {
      if (type === 'message') messageListeners.delete(listener);
      return remove(type, listener, options);
    };
    window.__messageListenerCount = () => messageListeners.size;
    window.__templateStates = [];
    window.__templateMessages = [];
    window.addEventListener('message', (event) => {
      if (event.origin.endsWith('sandpack.codesandbox.io') && event.data && typeof event.data === 'object') {
        const { type, status, action, compilatonError } = event.data;
        window.__templateMessages.push({ type, status, action, compilatonError });
        if (window.__templateMessages.length > 100) window.__templateMessages.shift();
      }
    });
    new MutationObserver(() => {
      const status = document.querySelector('[data-preview-state]')?.getAttribute('data-preview-state');
      if (status && window.__templateStates.at(-1) !== status) window.__templateStates.push(status);
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-preview-state'] });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const remoteImages = [];
  context.on('request', (request) => {
    if (/pravatar\.cc|github\.com\/shadcn\.png/.test(request.url())) remoteImages.push(request.url());
  });
  return { context, page, errors, remoteImages };
}

async function ready(page) {
  await page.waitForFunction(() => {
    const state = document.querySelector('[data-preview-state]')?.getAttribute('data-preview-state');
    return state === 'ready' || state === 'error';
  }, undefined, { timeout: 70000 });
  assert.equal(await page.locator('[data-preview-state]').getAttribute('data-preview-state'), 'ready', await page.locator('[data-preview-state]').textContent());
  const frame = await page.locator('iframe[title="企业官网模板隔离预览"]').contentFrame();
  // Locator.contentFrame() returns a FrameLocator in the pinned Playwright.
  await frame.getByRole('heading', { name: 'Shadcn landing page', exact: true }).waitFor();
  return frame;
}

async function noOverflow(page) {
  const host = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(host.scroll <= host.width + 1, `Host overflow: ${JSON.stringify(host)}`);
  const child = page.frames().find((frame) => frame.parentFrame() === page.mainFrame() && frame.url().includes('sandpack.codesandbox.io'));
  assert.ok(child, 'Expected an actual cross-origin preview frame');
  const preview = await child.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  assert.ok(preview.scroll <= preview.width + 1, `Preview overflow: ${JSON.stringify(preview)}`);
  const box = await page.locator('iframe').boundingBox();
  assert.ok(box && Math.abs(box.width - preview.innerWidth) <= 1, 'Preview must actually use the measured narrow width');
}

async function interactions(page, frame, mobile) {
  const host = await page.evaluate(() => ({ color: getComputedStyle(document.body).color, background: getComputedStyle(document.documentElement).backgroundColor, theme: document.documentElement.className }));
  const theme = frame.getByRole('button', { name: 'Toggle theme', exact: true });
  await theme.click();
  await frame.getByRole('menuitem', { name: 'Light', exact: true }).click();
  assert.match(await frame.locator('html').getAttribute('class'), /light/);
  await theme.focus();
  await theme.press('Enter');
  await frame.getByRole('menuitem', { name: 'Dark', exact: true }).click();
  assert.match(await frame.locator('html').getAttribute('class'), /dark/);
  assert.deepEqual(await page.evaluate(() => ({ color: getComputedStyle(document.body).color, background: getComputedStyle(document.documentElement).backgroundColor, theme: document.documentElement.className })), host);
  const menu = frame.getByRole('button', { name: 'Open navigation menu', exact: true });
  if (mobile) {
    await menu.focus();
    await menu.press('Enter');
    await frame.getByRole('dialog').getByRole('link', { name: 'Pricing', exact: true }).press('Enter');
    await frame.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(await menu.evaluate((element) => element === document.activeElement), true, 'Menu restores keyboard focus');
    assert.notEqual(await menu.evaluate((element) => getComputedStyle(element).outlineStyle), 'none');
  } else await frame.locator('header').getByRole('link', { name: 'Pricing', exact: true }).click();
  assert.ok((await frame.locator('#pricing').boundingBox())?.height > 0);
  if (mobile) {
    await menu.press('Enter');
    await frame.getByRole('dialog').getByRole('link', { name: 'FAQ', exact: true }).press('Enter');
    await frame.getByRole('dialog').waitFor({ state: 'hidden' });
  } else await frame.locator('header').getByRole('link', { name: 'FAQ', exact: true }).click();
  const faq = frame.getByRole('button', { name: 'Is this template free?', exact: true });
  await faq.focus();
  await faq.press('Space');
  assert.equal(await faq.getAttribute('aria-expanded'), 'true');
  await frame.getByRole('region', { name: 'Is this template free?' }).waitFor({ state: 'visible' });
  await faq.press('Space');
  assert.equal(await faq.getAttribute('aria-expanded'), 'false');
  assert.equal(await frame.locator('form').count(), 0, 'No unconnected subscription form');
  await noOverflow(page);
}

async function normal(origin, mode) {
  for (const width of [1280, 320, 375]) {
    await check(`${mode}-${width}-navigation-theme-faq-keyboard`, async () => {
      const { context, page, errors, remoteImages } = await pageContext({ width, height: 900 });
      try {
        await page.goto(`${origin}/templates/company-landing`);
        let frame = await ready(page);
        assert.equal(await page.locator('iframe').getAttribute('sandbox'), 'allow-scripts allow-same-origin');
        assert.equal(await page.locator('iframe').getAttribute('referrerpolicy'), 'no-referrer');
        await noOverflow(page);
        const child = page.frames().find((item) => item.parentFrame() === page.mainFrame() && item.url().includes('sandpack.codesandbox.io'));
        await child.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.screenshot({ path: path.join(artifacts, `${mode}-${width}.png`), animations: 'disabled' });
        await interactions(page, frame, width < 768);
        assert.deepEqual(errors, [], 'Uncaught host/frame exceptions');
        assert.deepEqual(remoteImages, [], 'Template avatars must be local');
        if (width === 1280) {
          await page.reload();
          frame = await ready(page);
          await frame.getByRole('button', { name: 'Is this template free?', exact: true }).focus();
          assert.deepEqual(errors, []);
          assert.match(await page.locator('h1').textContent(), /企业官网/);
          await page.getByRole('link', { name: '← 返回首页' }).click();
          await page.getByRole('button', { name: '检查后端连接', exact: true }).waitFor();
          await page.getByRole('link', { name: '打开企业官网模板 →' }).click();
          await ready(page);
        }
      } catch (error) {
        await page.screenshot({ path: path.join(artifacts, `${mode}-${width}-failure.png`), fullPage: true }).catch(() => undefined);
        const details = await page.evaluate(() => ({ states: window.__templateStates, messages: window.__templateMessages }));
        await writeFile(path.join(artifacts, `${mode}-${width}-failure.json`), JSON.stringify({ errors, ...details }, null, 2));
        throw error;
      } finally { await context.close(); }
    });
  }
}

async function failures(origin, bundle, contentDigest) {
  await check('retry-during-client-import-cleans-old-instance', async () => {
    const baseline = await pageContext();
    let expectedListeners;
    try {
      await baseline.page.goto(`${origin}/templates/company-landing`);
      await ready(baseline.page);
      expectedListeners = await baseline.page.evaluate(() => window.__messageListenerCount());
    } finally { await baseline.context.close(); }
    const { context, page, errors } = await pageContext();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let held = false;
    await context.route(/\/runtime-[^/]+\.js(?:\?|$)/, async (route) => {
      held = true;
      await gate;
      await route.continue().catch(() => undefined);
    });
    try {
      await page.goto(`${origin}/templates/company-landing`);
      const deadline = Date.now() + 10000;
      while (!held && Date.now() < deadline) await delay(25);
      assert.equal(held, true, 'Delay the real runtime module before client creation');
      await page.getByRole('button', { name: '重新加载预览' }).click();
      await page.waitForFunction(() => document.querySelector('[data-attempt]')?.getAttribute('data-attempt') === '1');
      release();
      await ready(page);
      assert.equal(await page.locator('iframe').count(), 1);
      assert.equal(await page.evaluate(() => window.__messageListenerCount()), expectedListeners, 'Late old client must not leak message listeners');
      assert.deepEqual(errors, []);
    } finally {
      release();
      await context.close();
    }
  });
  const invalid = structuredClone(bundle);
  invalid.files['/src/../escape.ts'] = 'export {};';
  const syntaxError = structuredClone(bundle);
  syntaxError.files[syntaxError.entry] = 'export default ( ;';
  const syntaxContent = { ...syntaxError };
  delete syntaxContent.digest;
  syntaxError.digest = await contentDigest(syntaxContent);
  const cases = [
    { name: 'resource-404', status: 404, body: '{}', message: /HTTP 404/ },
    { name: 'resource-json', status: 200, body: '{invalid', message: /有效的 JSON/ },
    { name: 'resource-structure', status: 200, body: '{"id":"wrong"}', message: /结构无效/ },
    { name: 'resource-path', status: 200, body: JSON.stringify(invalid), message: /文件路径无效/ },
    { name: 'real-compilation-error', status: 200, body: JSON.stringify(syntaxError), message: /编译或运行失败/ },
  ];
  for (const failure of cases) {
    await check(`${failure.name}-and-retry`, async () => {
      const { context, page } = await pageContext();
      let broken = true;
      await context.route('**/template-assets/company-landing.bundle.json', (route) => broken
        ? route.fulfill({ status: failure.status, contentType: 'application/json', body: failure.body }) : route.continue());
      try {
        await page.goto(`${origin}/templates/company-landing`);
        await page.locator('[data-preview-state="error"]').waitFor({ timeout: 70000 });
        assert.match(await page.locator('[data-preview-state]').textContent(), failure.message);
        if (failure.name === 'real-compilation-error') {
          assert.equal(await page.evaluate(() => window.__templateMessages.some((event) =>
            (event.type === 'done' && event.compilatonError === true) ||
            (event.type === 'action' && event.action === 'show-error'))), true, 'The real bundler must report the compilation error');
        } else assert.equal(await page.locator('iframe').count(), 0, 'Invalid resources must not start a preview');
        assert.equal(await page.evaluate(() => window.__templateStates.includes('ready')), false, 'Failure must never show ready');
        await page.getByRole('link', { name: '← 返回首页' }).waitFor();
        await page.screenshot({ path: path.join(artifacts, `${failure.name}.png`), fullPage: true });
        broken = false;
        await page.getByRole('button', { name: '重新加载预览' }).click();
        const frame = await ready(page);
        await frame.getByRole('button', { name: 'Is this template free?', exact: true }).click();
        assert.equal(await frame.getByRole('button', { name: 'Is this template free?', exact: true }).getAttribute('aria-expanded'), 'true');
      } finally { await context.close(); }
    });
  }
  await check('bundler-unreachable-deadline-and-retry', async () => {
    const { context, page } = await pageContext();
    let blocked = true;
    await context.route('https://**/*', (route) => blocked && new URL(route.request().url()).hostname.endsWith('sandpack.codesandbox.io') ? route.abort('connectionfailed') : route.continue());
    try {
      await page.goto(`${origin}/templates/company-landing`);
      await page.locator('[data-preview-state="error"]').waitFor({ timeout: 70000 });
      assert.match(await page.locator('[data-preview-state]').textContent(), /60 秒/);
      assert.equal(await page.evaluate(() => window.__templateStates.includes('ready')), false);
      blocked = false;
      await page.getByRole('button', { name: '重新加载预览' }).click();
      await ready(page);
    } finally { await context.close(); }
  });
}

async function main() {
  await mkdir(artifacts, { recursive: true });
  const watchdog = setTimeout(() => signalReceived('TIMEOUT'), 12 * 60 * 1000);
  watchdog.unref();
  try {
    assert.equal(process.argv.length, 2, 'smoke:template accepts no arguments and requires a prior build');
    await portFree(5173);
    await portFree(4173);
    const source = JSON.parse(await readFile(path.join(root, 'frontend/public/template-assets/company-landing.bundle.json'), 'utf8'));
    const built = JSON.parse(await readFile(path.join(root, 'frontend/dist/template-assets/company-landing.bundle.json'), 'utf8'));
    assert.equal(source.digest, built.digest, 'Build is missing or stale; run pnpm build first');
    report.digest = source.digest;
    const { contentDigest } = await import(pathToFileURL(path.join(root, 'templates/bundle.mjs')).href);
    browser = await chromium.launch({ channel: 'chrome', headless: true, handleSIGINT: false, handleSIGTERM: false });
    for (const mode of ['dev', 'preview']) {
      const app = await launch(mode);
      try {
        await normal(app.origin, mode);
        if (mode === 'dev') await failures(app.origin, source, contentDigest);
      } finally {
        await stop(app.child);
        await writeFile(path.join(artifacts, `${mode}.log`), app.log());
      }
    }
    report.status = 'passed';
  } catch (error) {
    report.status = interrupted && interrupted !== 'TIMEOUT' ? 'cancelled' : 'failed';
    report.failedPhase = phase || 'preflight';
    await writeFile(path.join(artifacts, 'failure.txt'), error.stack || String(error));
    console.error(`Template smoke ${report.status}: ${phase || 'preflight'}: ${error.message}`);
    process.exitCode = interrupted === 'SIGINT' ? 130 : interrupted === 'SIGTERM' ? 143 : 1;
  } finally {
    clearTimeout(watchdog);
    try {
      await cleanupOwned();
      report.cleanup = 'passed';
    } catch (error) {
      report.cleanup = 'failed';
      report.status = 'failed';
      console.error(`Cleanup: ${error.message}`);
      process.exitCode ||= 1;
    }
    await writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`Template smoke report: ${path.relative(root, path.join(artifacts, 'report.json'))}`);
  }
}

void main();
