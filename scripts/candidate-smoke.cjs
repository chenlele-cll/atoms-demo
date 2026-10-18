/* global document, window, getComputedStyle, requestAnimationFrame */
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const { cp, mkdir, rm, symlink, writeFile, access, readFile } = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { setTimeout: delay } = require('node:timers/promises');
const { createServer } = require('node:http');
const { createRequire } = require('node:module');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const runId = randomUUID();
const output = path.join(root, 'test-results/candidate-review', runId);
const runtime = path.join(output, 'runtime');
const deploy = path.join(runtime, 'deploy/backend');
const browserRepo = path.join(runtime, 'browser-repo');
const database = path.join(runtime, 'data/atoms.sqlite');
const children = new Set();
const report = { runId, suite: 'candidate-review', source: 'fixture', status: 'running', cases: [], cleanup: 'not-run', realModelCalls: 0, fixtureModelRequests: 0 };
let browser; let interrupted; let logs = ''; let backend; let upstream; let upstreamOrigin; let tools; let bundle;

function signalGroup(child, signal) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}
function groupAlive(child) {
  if (!child?.pid) return false;
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
  backend = launch(path.join(root, 'scripts/generation-stream-server.mjs'), [path.join(deploy, 'dist'), database, '3001', upstreamOrigin], deploy);
  await ready('http://127.0.0.1:3001/api/health', backend);
}
async function scenario(name, work) {
  check(); const started = Date.now();
  try { await work(); } catch (error) { report.cases.push({ name, status: 'failed', durationMs: Date.now() - started }); console.error(error.stack); throw new Error(`${name}: ${error.message}`, { cause: error }); }
  report.cases.push({ name, status: 'passed', durationMs: Date.now() - started });
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
async function seed(name, kind = 'normal', session) {
  const store = tools.openStore(database);
  try {
    const owner = session ?? store.createSession();
    return { ...tools.seedCandidate(store, owner.id, bundle, name, kind), owner };
  } finally { store.close(); }
}
async function setSession(context, owner) {
  await context.addCookies([{ name: 'atoms_session', value: owner.token, domain: '127.0.0.1', path: '/api', httpOnly: true, sameSite: 'Strict', secure: false }]);
}
const candidateUrl = (origin, item, version = item.first) => `${origin}/projects/${item.detail.project.id}/candidates/${version.id}`;
const versionUrl = (item, version = item.first) => `/api/projects/${item.detail.project.id}/versions/${version.id}`;
const projectUrl = item => `/api/projects/${item.detail.project.id}`;
async function waitPreview(page, expected = 'compiled') {
  await page.waitForFunction(() => {
    const status = document.querySelector('[data-preview-state]')?.getAttribute('data-preview-state');
    return ['compiled', 'compileError', 'runtimeError', 'timeout', 'loadError'].includes(status);
  }, undefined, { timeout: 70_000 });
  assert.equal(await page.locator('[data-preview-state]').getAttribute('data-preview-state'), expected,
    await page.locator('[data-preview-state]').textContent());
  return page.frameLocator('iframe');
}
async function assertCurrent(page, item, expected, snapshot) {
  const current = await api(page, 'GET', projectUrl(item)); assert.equal(current.status, 200);
  assert.equal(current.body.project.currentVersionId, expected); assert.equal(current.body.currentVersion.id, expected);
  assert.equal(digest(current.body.currentVersion.snapshot), digest(snapshot));
}
async function quoteInteraction(page, base = 5000) {
  const frame = page.frameLocator('iframe');
  assert.equal(await frame.getByTestId('quote-total').textContent(), String(base));
  await frame.getByLabel('页面数量', { exact: true }).fill('3');
  assert.equal(await frame.getByTestId('quote-total').textContent(), String(base + 2000));
  await frame.getByLabel('服务类型', { exact: true }).selectOption('commerce');
  assert.equal(await frame.getByTestId('quote-total').textContent(), String(base + 5000));
}
async function noOverflow(page) {
  const sizes = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  assert.ok(sizes.scroll <= sizes.width + 1, 'Host horizontal overflow');
  const bounds = await page.locator('iframe').boundingBox(); assert.ok(bounds && bounds.width <= sizes.width);
  const child = page.frames().find(frame => frame.parentFrame() === page.mainFrame() && frame.url().includes('sandpack.codesandbox.io'));
  await child.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const inner = await child.evaluate(() => ({ width: window.innerWidth, scroll: document.documentElement.scrollWidth }));
  if (inner.scroll > inner.width + 1) {
    const overflow = await child.evaluate(() => [...document.querySelectorAll('body *')].map(element => ({ tag: element.tagName, class: element.className,
      left: Math.round(element.getBoundingClientRect().left), right: Math.round(element.getBoundingClientRect().right), width: Math.round(element.getBoundingClientRect().width) }))
      .filter(item => item.right > window.innerWidth + 1 || item.left < -1).slice(0, 24));
    console.error(JSON.stringify({ frameOverflow: inner, elements: overflow }));
  }
  assert.ok(inner.scroll <= inner.width + 1, `Frame horizontal overflow: ${JSON.stringify(inner)}`); assert.ok(Math.abs(inner.width - bounds.width) <= 2);
}
async function mode(name, port) {
  const frontend = launch(path.join(root, 'frontend/node_modules/vite/bin/vite.js'), name === 'preview' ? ['preview'] : [], path.join(browserRepo, 'frontend'));
  await ready(`http://127.0.0.1:${port}`, frontend); const origin = `http://127.0.0.1:${port}`;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const item = await seed(`${name} normal`); await setSession(context, item.owner); const page = await context.newPage();
  let leakedCredential = false;
  context.on('request', request => {
    if (new URL(request.url()).origin === origin || new URL(request.url()).origin === 'http://127.0.0.1:3001') return;
    const content = request.url() + (request.postData() ?? '') + JSON.stringify(request.headers());
    if (content.includes(item.owner.token) || content.includes('OPENAI_API_KEY')) leakedCredential = true;
  });
  let postCount = 0; page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/adopt')) postCount++; });
  try {
    await scenario(`${name}: actual quote compilation/interaction, isolation, retry/reset and explicit adoption`, async () => {
      await page.goto(candidateUrl(origin, item)); await waitPreview(page);
      const primary = page.getByRole('button', { name: '使用这个版本', exact: true }); assert.equal(await primary.isEnabled(), true);
      await quoteInteraction(page); await assertCurrent(page, item, item.detail.currentVersion.id, item.detail.currentVersion.snapshot); assert.equal(postCount, 0);
      const frame = page.frameLocator('iframe');
      const host = await page.evaluate(() => ({ color: getComputedStyle(document.body).color, theme: document.documentElement.className }));
      await frame.getByRole('button', { name: '检查隔离', exact: true }).click();
      assert.equal(await frame.getByTestId('isolation-result').textContent(), '隔离有效'); assert.equal(postCount, 0);
      await page.evaluate(() => window.postMessage({ type: 'done', compilatonError: false, verified: true, action: 'adopt' }, '*'));
      await assertCurrent(page, item, item.detail.currentVersion.id, item.detail.currentVersion.snapshot); assert.equal(postCount, 0);
      await frame.getByRole('button', { name: 'Toggle theme', exact: true }).click(); await frame.getByRole('menuitem', { name: 'Dark', exact: true }).click();
      assert.deepEqual(await page.evaluate(() => ({ color: getComputedStyle(document.body).color, theme: document.documentElement.className })), host);
      await frame.locator('header').getByRole('link', { name: 'FAQ', exact: true }).click();
      const faq = frame.getByRole('button', { name: 'Is this template free?', exact: true }); await faq.focus(); await faq.press('Space');
      assert.equal(await faq.getAttribute('aria-expanded'), 'true');
      assert.equal(await page.locator('iframe').getAttribute('sandbox'), 'allow-scripts allow-same-origin');
      assert.equal(await page.locator('iframe').getAttribute('allow'), ''); assert.equal(await page.locator('iframe').getAttribute('referrerpolicy'), 'no-referrer');
      const previewDocument = page.frames().find(frame => frame.parentFrame() === page.mainFrame() && frame.url().includes('sandpack.codesandbox.io'));
      assert.notEqual(new URL(previewDocument.url()).origin, origin);
      assert.equal(await previewDocument.evaluate(() => document.cookie.includes('atoms_session=')), false);
      await page.getByRole('button', { name: '当前版本', exact: true }).click(); await waitPreview(page);
      assert.equal(await page.frameLocator('iframe').getByTestId('quote-total').count(), 0); assert.equal(await primary.isDisabled(), true);
      await page.getByRole('button', { name: '候选版本', exact: true }).click(); await waitPreview(page);
      assert.equal(await page.frameLocator('iframe').getByTestId('quote-total').textContent(), '5000');
      await page.getByRole('button', { name: '重新加载预览', exact: true }).click(); await waitPreview(page); assert.equal(await page.locator('iframe').count(), 1);
      assert.equal(await page.frameLocator('iframe').getByLabel('页面数量', { exact: true }).inputValue(), '1');
      for (const width of [1280, 320, 375]) {
        await page.setViewportSize({ width, height: 900 }); await noOverflow(page);
        await page.keyboard.press('Tab'); await primary.focus(); assert.equal(await primary.evaluate(element => getComputedStyle(element).outlineStyle !== 'none'), true);
        assert.ok((await primary.boundingBox()).height >= 44); await page.screenshot({ path: path.join(output, `${name}-${width}.png`), animations: 'disabled' });
      }
      await page.setViewportSize({ width: 1280, height: 900 }); await quoteInteraction(page);
      await primary.click(); await page.waitForFunction(() => document.querySelector('[data-adoption-state]')?.getAttribute('data-adoption-state') === 'confirmed');
      assert.equal(postCount, 1); await assertCurrent(page, item, item.first.id, item.first.snapshot);
      await stop(backend); await startBackend(); await page.reload(); await waitPreview(page);
      assert.equal(await page.locator('[data-current-version]').getAttribute('data-current-version'), item.first.id);
      await assertCurrent(page, item, item.first.id, item.first.snapshot);
      await page.frameLocator('iframe').getByRole('button', { name: '触发运行错误', exact: true }).click();
      await page.locator('[data-preview-state="runtimeError"]').waitFor(); assert.equal(await primary.isDisabled(), true);
      await assertCurrent(page, item, item.first.id, item.first.snapshot);
      await page.reload(); await waitPreview(page); await assertCurrent(page, item, item.first.id, item.first.snapshot);
      await page.locator('iframe').evaluate(element => { element.setAttribute('src', element.src); });
      await page.locator('[data-preview-state="runtimeError"]').waitFor(); assert.equal(await primary.isDisabled(), true);
      await page.getByRole('button', { name: '重新加载预览', exact: true }).click(); await waitPreview(page);
      await assertCurrent(page, item, item.first.id, item.first.snapshot);
    });
    for (const kind of ['syntax', 'runtime']) await scenario(`${name}: actual ${kind} candidate fails and original current remains readable`, async () => {
      const broken = await seed(`${name} ${kind}`, kind, item.owner); await page.goto(candidateUrl(origin, broken));
      await page.waitForFunction(() => ['compileError', 'runtimeError'].includes(document.querySelector('[data-preview-state]')?.getAttribute('data-preview-state')), undefined, { timeout: 70_000 });
      assert.equal(await page.getByRole('button', { name: '使用这个版本', exact: true }).isDisabled(), true);
      await page.evaluate(() => window.postMessage({ type: 'done', compilatonError: false }, '*')); await delay(50);
      assert.equal(await page.getByRole('button', { name: '使用这个版本', exact: true }).isDisabled(), true);
      await assertCurrent(page, broken, broken.detail.currentVersion.id, broken.detail.currentVersion.snapshot);
      await page.getByRole('button', { name: '当前版本', exact: true }).click(); await waitPreview(page);
    });
    await scenario(`${name}: session isolation and same-owner tabs cannot overwrite the winning candidate`, async () => {
      const competing = await seed(`${name} competition`, 'normal', item.owner);
      const outsider = await browser.newContext(); const otherPage = await outsider.newPage();
      try { await otherPage.goto(candidateUrl(origin, competing)); await otherPage.locator('[data-preview-state="loadError"]').waitFor();
        assert.match(await otherPage.locator('[data-preview-state="loadError"]').textContent(), /HTTP 401/);
        assert.equal(await otherPage.locator('iframe').count(), 0); await api(otherPage, 'POST', '/api/session', {}); await otherPage.reload();
        await otherPage.locator('[data-preview-state="loadError"]').waitFor();
        assert.match(await otherPage.locator('[data-preview-state="loadError"]').textContent(), /HTTP 404/);
        assert.equal((await api(otherPage, 'GET', versionUrl(competing))).status, 404);
      } finally { await outsider.close(); }
      const tab = await context.newPage();
      try {
        await Promise.all([page.goto(candidateUrl(origin, competing)), tab.goto(candidateUrl(origin, competing, competing.second))]);
        await Promise.all([waitPreview(page), waitPreview(tab)]);
        const responses = await Promise.all([page.waitForResponse(response => response.url().endsWith('/adopt')), tab.waitForResponse(response => response.url().endsWith('/adopt')),
          page.getByRole('button', { name: '使用这个版本', exact: true }).click(), tab.getByRole('button', { name: '使用这个版本', exact: true }).click()]);
        assert.deepEqual(responses.slice(0, 2).map(response => response.status()).sort(), [200, 409]);
        const actual = (await api(page, 'GET', projectUrl(competing))).body.currentVersion;
        const winner = actual.id === competing.first.id ? competing.first : competing.second; assert.equal(digest(actual.snapshot), digest(winner.snapshot));
        await page.getByRole('button', { name: '刷新版本状态', exact: true }).click();
        await page.waitForFunction(id => document.querySelector('[data-current-version]')?.getAttribute('data-current-version') === id, actual.id);
      } finally { await tab.close(); }
    });
    await scenario(`${name}: server committed but POST response lost is confirmed by GET without second write`, async () => {
      const lost = await seed(`${name} lost response`, 'normal', item.owner); await page.goto(candidateUrl(origin, lost)); await waitPreview(page);
      let sent = 0;
      await page.route(`**${versionUrl(lost)}/adopt`, async route => { sent++; const response = await route.fetch(); assert.equal(response.status(), 200); await route.abort('connectionreset'); });
      await page.getByRole('button', { name: '使用这个版本', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('[data-adoption-state]')?.getAttribute('data-adoption-state') === 'confirmed');
      assert.equal(sent, 1); await assertCurrent(page, lost, lost.first.id, lost.first.snapshot); await page.unroute(`**${versionUrl(lost)}/adopt`);
    });
    await scenario(`${name}: unknown survives unavailable confirmation and manual same-payload retry succeeds`, async () => {
      const uncertain = await seed(`${name} unknown`, 'normal', item.owner); await page.goto(candidateUrl(origin, uncertain)); await waitPreview(page);
      const payloads = [];
      await page.route(`**${versionUrl(uncertain)}/adopt`, async route => { payloads.push(route.request().postDataJSON()); await route.abort('connectionreset'); });
      await page.route(`**${projectUrl(uncertain)}`, route => route.abort('connectionreset'));
      await page.getByRole('button', { name: '使用这个版本', exact: true }).click();
      await page.locator('[data-adoption-state="unknown"]').waitFor(); await page.getByRole('button', { name: '查询采用结果', exact: true }).click();
      await page.locator('[role="alert"]').waitFor(); assert.equal(payloads.length, 1);
      await page.unroute(`**${projectUrl(uncertain)}`); await page.getByRole('button', { name: '查询采用结果', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('[data-adoption-state]')?.textContent?.includes('当前仍是原版本'));
      await page.unroute(`**${versionUrl(uncertain)}/adopt`);
      page.on('request', request => { if (request.url().endsWith(versionUrl(uncertain) + '/adopt')) payloads.push(request.postDataJSON()); });
      await page.getByRole('button', { name: '重试同一采用请求', exact: true }).click(); await page.locator('[data-adoption-state="confirmed"]').waitFor();
      assert.deepEqual(payloads[1], payloads[0]); await assertCurrent(page, uncertain, uncertain.first.id, uncertain.first.snapshot);
    });
    await scenario(`${name}: running/unconfirmed and write failure reject adoption with exact snapshots preserved`, async () => {
      const guarded = await seed(`${name} guarded`, 'normal', item.owner); const store = tools.openStore(database); let orphan;
      try { orphan = store.createRun({ projectId: guarded.detail.project.id, requestId: randomUUID(), baseVersionId: guarded.detail.currentVersion.id }); } finally { store.close(); }
      const response = await api(page, 'POST', versionUrl(guarded) + '/adopt', { expectedCurrentVersionId: guarded.detail.currentVersion.id });
      assert.equal(response.status, 503); assert.equal(response.body.error.code, 'RUN_STATE_UNCONFIRMED');
      const repair = tools.openStore(database); repair.finishRun({ projectId: guarded.detail.project.id, runId: orphan.id, status: 'interrupted', errorCode: 'PROCESS_RESTARTED' }); repair.close();
      const sql = new tools.Database(database); sql.exec("CREATE TRIGGER fixture_adopt_failure BEFORE UPDATE OF current_version_id ON projects BEGIN SELECT RAISE(ABORT,'EXPLICIT_FIXTURE_WRITE_FAILURE'); END");
      try { assert.equal((await api(page, 'POST', versionUrl(guarded) + '/adopt', { expectedCurrentVersionId: guarded.detail.currentVersion.id })).status, 503);
        await assertCurrent(page, guarded, guarded.detail.currentVersion.id, guarded.detail.currentVersion.snapshot);
      } finally { sql.exec('DROP TRIGGER fixture_adopt_failure'); sql.close(); }
      await page.goto(candidateUrl(origin, guarded)); await waitPreview(page);
      const controllerName = 'atomsBusyCandidateFixture';
      await page.evaluate(async ({ item, controllerName }) => {
        const controller = new AbortController(); window[controllerName] = controller;
        const response = await fetch(`/api/projects/${item.detail.project.id}/generations`, { method: 'POST', signal: controller.signal,
          headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify({ requestId: crypto.randomUUID(), baseVersionId: item.detail.currentVersion.id, prompt: 'EXPLICIT ACTIVE ADOPTION GUARD FIXTURE' }) });
        window.atomsBusyReaderFixture = response.body.getReader(); await window.atomsBusyReaderFixture.read();
      }, { item: guarded, controllerName });
      try { const busy = await api(page, 'POST', versionUrl(guarded) + '/adopt', { expectedCurrentVersionId: guarded.detail.currentVersion.id }); assert.equal(busy.status, 409); assert.equal(busy.body.error.code, 'PROJECT_BUSY'); }
      finally { await page.evaluate(controllerName => window[controllerName].abort(), controllerName); }
      await assertCurrent(page, guarded, guarded.detail.currentVersion.id, guarded.detail.currentVersion.snapshot);
    });
    await stop(backend); await startBackend();
    await scenario(`${name}: duplicate primary activation submits once and preserves pending base`, async () => {
      const duplicate = await seed(`${name} duplicate activation`, 'normal', item.owner); await page.goto(candidateUrl(origin, duplicate)); await waitPreview(page);
      let release; const gate = new Promise(resolve => { release = resolve; }); let sent = 0;
      await page.route(`**${versionUrl(duplicate)}/adopt`, async route => { sent++; await gate; await route.continue(); });
      try {
        await page.getByRole('button', { name: '使用这个版本', exact: true }).evaluate(element => { element.click(); element.click(); });
        await page.locator('[data-adoption-state="submitting"]').waitFor(); assert.equal(await page.getByRole('button', { name: '使用这个版本', exact: true }).isDisabled(), true);
        await assertCurrent(page, duplicate, duplicate.detail.currentVersion.id, duplicate.detail.currentVersion.snapshot); release();
        await page.locator('[data-adoption-state="confirmed"]').waitFor(); assert.equal(sent, 1);
      } finally { release(); await page.unroute(`**${versionUrl(duplicate)}/adopt`); }
    });
    await scenario(`${name}: lost response followed by another legitimate selection reports conflict, never rewrites`, async () => {
      const changed = await seed(`${name} later selection`, 'normal', item.owner); await page.goto(candidateUrl(origin, changed)); await waitPreview(page); let successor;
      await page.route(`**${versionUrl(changed)}/adopt`, async route => {
        const response = await route.fetch(); assert.equal(response.status(), 200);
        const store = tools.openStore(database);
        try {
          const run = store.createRun({ projectId: changed.detail.project.id, requestId: randomUUID(), baseVersionId: changed.first.id });
          successor = store.saveCandidate({ projectId: changed.detail.project.id, runId: run.id,
            snapshot: tools.candidateSnapshot(changed.first.snapshot, 'normal', 7000) }).version;
        } finally { store.close(); }
        const adopted = await context.request.post(`http://127.0.0.1:3001/api/projects/${changed.detail.project.id}/versions/${successor.id}/adopt`,
          { headers: { origin }, data: { expectedCurrentVersionId: changed.first.id } }); assert.equal(adopted.status(), 200);
        await route.abort('connectionreset');
      });
      await page.getByRole('button', { name: '使用这个版本', exact: true }).click(); await page.locator('[data-adoption-state="conflict"]').waitFor();
      await assertCurrent(page, changed, successor.id, successor.snapshot); assert.equal(await page.getByRole('button', { name: '使用这个版本', exact: true }).isDisabled(), true);
      await page.unroute(`**${versionUrl(changed)}/adopt`);
    });
    await scenario(`${name}: invalid/offline version responses stay load errors and retry reads real data`, async () => {
      const invalid = await seed(`${name} invalid response`, 'normal', item.owner);
      for (const kind of ['offline', 'json', 'digest', 'error-text']) {
        await page.route(`**${versionUrl(invalid)}`, async route => {
          if (kind === 'offline') return route.abort('connectionreset');
          if (kind === 'json') return route.fulfill({ status: 200, contentType: 'application/json', body: '<script>unsafe fixture</script>' });
          if (kind === 'error-text') return route.fulfill({ status: 503, contentType: 'application/json', json: { error: { code: 'STORAGE_UNAVAILABLE', message: '<img data-owned-injection src=x onerror="window.fixtureXss=true">' + 'long-error-'.repeat(80) }, requestId: 'fixture' } });
          const response = await route.fetch(); const body = await response.json(); body.version.snapshot.digest = '0'.repeat(64);
          return route.fulfill({ response, json: body });
        });
        await page.goto(candidateUrl(origin, invalid)); await page.locator('[data-preview-state="loadError"]').waitFor(); assert.equal(await page.locator('iframe').count(), 0);
        if (kind === 'error-text') {
          await page.setViewportSize({ width: 320, height: 900 });
          assert.equal(await page.locator('img[data-owned-injection]').count(), 0); assert.equal(await page.evaluate(() => window.fixtureXss), undefined);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
          await page.setViewportSize({ width: 1280, height: 900 });
        }
        await page.unroute(`**${versionUrl(invalid)}`); await page.getByRole('button', { name: '重试加载版本', exact: true }).click(); await waitPreview(page);
        await assertCurrent(page, invalid, invalid.detail.currentVersion.id, invalid.detail.currentVersion.snapshot);
      }
    });
    if (name === 'dev') await scenario('dev: blocked real bundler times out, old success cannot enable adoption, retry really recompiles', async () => {
      const blocked = await seed('external bundler blocked', 'normal', item.owner);
      const isolated = await browser.newContext(); await setSession(isolated, item.owner); const blockedPage = await isolated.newPage();
      try {
        await isolated.route('https://2-19-8-sandpack.codesandbox.io/**', route => route.abort('connectionreset'));
        await blockedPage.goto(candidateUrl(origin, blocked)); await waitPreview(blockedPage, 'timeout');
        await blockedPage.evaluate(() => window.postMessage({ type: 'done', compilatonError: false }, '*'));
        assert.equal(await blockedPage.getByRole('button', { name: '使用这个版本', exact: true }).isDisabled(), true);
        await isolated.unroute('https://2-19-8-sandpack.codesandbox.io/**'); await blockedPage.getByRole('button', { name: '重新加载预览', exact: true }).click(); await waitPreview(blockedPage);
        await assertCurrent(blockedPage, blocked, blocked.detail.currentVersion.id, blocked.detail.currentVersion.snapshot);
      } finally { await isolated.close(); }
    });
    assert.equal(leakedCredential, false, 'Platform credentials must not be transferred to external preview requests');
  } catch (error) { await page.screenshot({ path: path.join(output, `${name}-failure.png`), fullPage: true }).catch(() => {}); throw error; }
  finally { await context.close(); await stop(frontend); }
}
async function main() {
  await mkdir(output, { recursive: true }); for (const port of [3001, 5173, 4173]) await portFree(port);
  await setup();
  const { openStore } = await import(pathToFileURL(path.join(deploy, 'dist/storage/store.js')).href);
  const fixtures = await import('./candidate-fixtures.mjs');
  const requireDeployment = createRequire(path.join(deploy, 'package.json')); const Database = requireDeployment('better-sqlite3');
  tools = { openStore, Database, ...fixtures }; bundle = JSON.parse(await readFile(path.join(deploy, 'dist/template-assets/company-landing.bundle.json'), 'utf8'));
  upstream = createServer(async (req, res) => { for await (const chunk of req) void chunk; report.fixtureModelRequests++; void res; });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve)); upstreamOrigin = `http://127.0.0.1:${upstream.address().port}`;
  await startBackend(); browser = await chromium.launch({ channel: 'chrome', headless: true, handleSIGINT: false, handleSIGTERM: false });
  await mode('dev', 5173); await stop(backend); await startBackend(); await mode('preview', 4173); report.status = 'passed';
}
main().catch(error => { report.status = interrupted ? 'cancelled' : 'failed'; report.error = error.message; console.error(`Candidate smoke ${report.status}: ${error.message}`); process.exitCode = interrupted === 'SIGINT' ? 130 : interrupted ? 143 : 1; })
  .finally(async () => {
    await browser?.close().catch(() => {});
    const results = await Promise.allSettled([...children].map(stop));
    upstream?.closeAllConnections(); if (upstream?.listening) await new Promise(resolve => upstream.close(resolve));
    if (results.some(result => result.status === 'rejected')) { report.cleanup = 'failed'; process.exitCode = 1; }
    else { report.cleanup = 'passed'; await rm(runtime, { recursive: true, force: true }); }
    void logs; await mkdir(output, { recursive: true }); await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log(`Candidate review report: ${path.relative(root, path.join(output, 'report.json'))}`);
  });
