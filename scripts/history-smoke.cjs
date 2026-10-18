/* global document, window, getComputedStyle, requestAnimationFrame */
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const { cp, mkdir, rm, symlink, readFile, writeFile } = require('node:fs/promises');
const { createRequire } = require('node:module');
const net = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('playwright-core');
const { ownChild, signalOwned, groupAlive, closeBrowser } = require('./verification/processes.cjs');
const { api, waitCompiled, assertQuote } = require('./verification/workspace-path.cjs');

const root = path.resolve(__dirname, '..');
const runId = randomUUID();
const output = path.join(root, 'test-results/history-workspace', runId);
const runtime = path.join(output, 'runtime');
const deploy = path.join(runtime, 'deploy/backend');
const browserRepo = path.join(runtime, 'browser-repo');
const database = path.join(runtime, 'data/atoms.sqlite');
const children = new Set();
const serviceOutput = new WeakMap();
const sessionTokens = new Set();
const startedAt = Date.now();
const report = { runId, suite: 'history-workspace', source: 'fixture', status: 'running', cases: [], cleanup: 'not-run',
  realModelCalls: 0, generationPosts: 0, restorePosts: 0,
  limitations: ['PROJECT_BUSY is an injected HTTP transport response; no active model generation is started.', 'No live-model or deployment acceptance.'] };
let browser; let backend; let tools; let bundle; let interrupted; let deadline;

function check() { if (interrupted) throw new Error(interrupted === 'TIMEOUT' ? 'Suite budget exceeded' : 'Cancelled'); }
function cancel(signal) {
  interrupted = signal;
  for (const child of children) signalOwned(child, 'SIGTERM');
  if (browser) void browser.close().catch(() => {});
}
process.once('SIGINT', () => cancel('SIGINT'));
process.once('SIGTERM', () => cancel('SIGTERM'));
process.on('unhandledRejection', () => { report.asyncFailure = 'Asynchronous fixture handler failed'; cancel('ASYNC_FAILURE'); });
async function stop(child) {
  if (!child) return;
  signalOwned(child, 'SIGTERM');
  const end = Date.now() + 5000;
  while (groupAlive(child) && Date.now() < end) await delay(40);
  if (groupAlive(child)) signalOwned(child, 'SIGKILL');
  const hardEnd = Date.now() + 2000;
  while (groupAlive(child) && Date.now() < hardEnd) await delay(40);
  assert.equal(groupAlive(child), false, 'Owned process leaked'); children.delete(child);
}
async function portFree(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', () => reject(new Error(`Port ${port} is occupied; its owner was left untouched.`)));
    server.listen(port, '127.0.0.1', resolve);
  });
  await new Promise(resolve => server.close(resolve));
}
function launch(script, args, cwd) {
  check();
  const child = spawn(process.execPath, [script, ...args], { cwd, detached: true,
    env: { PATH: process.env.PATH ?? '', HOST: '127.0.0.1', PORT: '3001', DATABASE_PATH: database, API_PROXY_TARGET: 'http://127.0.0.1:3001' },
    stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child); ownChild(child);
  serviceOutput.set(child, '');
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => serviceOutput.set(child, (serviceOutput.get(child) + data.toString()).slice(-8000)));
  child.on('error', () => {});
  return child;
}
async function ready(url, child) {
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    check();
    if (child.exitCode !== null || child.signalCode !== null) {
      console.error(serviceOutput.get(child)); throw new Error('Owned service exited before readiness');
    }
    try { if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) return; } catch { /* readiness */ }
    await delay(100);
  }
  throw new Error('Owned service readiness timed out');
}
async function startBackend() {
  backend = launch(path.join(deploy, 'dist/server.js'), [], deploy);
  await ready('http://127.0.0.1:3001/api/health', backend);
}
async function scenario(name, work) {
  check(); const started = Date.now();
  try { await work(); report.cases.push({ name, status: 'passed', durationMs: Date.now() - started }); console.log(`PASS: ${name}`); }
  catch (error) { report.cases.push({ name, status: 'failed', durationMs: Date.now() - started }); throw new Error(`${name}: ${error.message}`, { cause: error }); }
}
async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Fixture route did not arrive')), 12_000); })]); }
  finally { clearTimeout(timer); }
}
// Gates also expire if a browser abort prevents a route callback from completing.
function gate() {
  let release; const promise = new Promise(resolve => { release = resolve; });
  const timer = setTimeout(release, 12_000);
  return { promise, release: () => { clearTimeout(timer); release(); } };
}
function storeWork(work) { const store = tools.openStore(database); try { return work(store); } finally { store.close(); } }
function addVersion(store, item, kind = 'normal', base = 5000, metadata = false) {
  const run = store.createRun({ projectId: item.detail.project.id, requestId: randomUUID(), baseVersionId: item.detail.currentVersion.id,
    ...(metadata ? { messages: [{ role: 'user', content: '<img data-history-injection src=x> ' + 'Explicit long history request '.repeat(24) }] } : {}) });
  return store.saveCandidate({ projectId: item.detail.project.id, runId: run.id,
    snapshot: tools.candidateSnapshot(bundle, kind, base),
    ...(metadata ? { messages: [{ role: 'assistant', content: 'Explicit stored summary ' + 'long-summary-'.repeat(32) }] } : {}) }).version;
}
function seed(name, count = 2) {
  return storeWork(store => {
    const owner = store.createSession();
    sessionTokens.add(owner.token);
    const detail = store.createProject(owner.id, `Explicit history fixture ${name} ${'LongTitle'.repeat(8)}`.slice(0, 120), bundle, 100);
    const item = { owner, detail, versions: [] };
    for (let index = 0; index < count; index++) item.versions.push(addVersion(store, item, 'normal', 5000 + index * 100, index === count - 1));
    return item;
  });
}
function immutable(item) {
  const db = new tools.Database(database);
  try { return createHash('sha256').update(JSON.stringify(['versions', 'messages', 'generation_runs'].map(table =>
    db.prepare(`SELECT * FROM ${table} WHERE project_id=? ORDER BY id`).all(item.detail.project.id)))).digest('hex'); }
  finally { db.close(); }
}
const projectPath = item => `/api/projects/${item.detail.project.id}`;
const versionPath = (item, version) => `${projectPath(item)}/versions/${version.id}`;
const button = (page, name) => page.getByRole('button', { name, exact: true });
const history = page => page.getByRole('region', { name: '版本历史', exact: true });
async function session(context, owner) {
  await context.addCookies([{ name: 'atoms_session', value: owner.token, domain: '127.0.0.1', path: '/api', httpOnly: true, sameSite: 'Strict', secure: false }]);
}
async function open(page, origin, item) {
  await session(page.context(), item.owner); await page.goto(`${origin}/projects/${item.detail.project.id}`);
  await page.locator('[data-viewed-version]').waitFor({ state: 'attached' }); await button(page, '历史').click();
  await history(page).locator('[data-history-version]').first().waitFor();
}
async function select(page, version, preview = true) {
  await button(page, '历史').click();
  await page.locator(`[data-history-version="${version.id}"] > button`).click();
  await page.waitForFunction(id => document.querySelector('[data-viewed-version]')?.getAttribute('data-viewed-version') === id &&
    !document.body.textContent.includes('正在读取所选版本完整快照'), version.id);
  await button(page, preview ? '预览' : '代码').click();
  if (preview) await waitCompiled(page);
}
async function current(page, item, version) {
  const actual = await api(page, 'GET', projectPath(item)); assert.equal(actual.status, 200);
  assert.equal(actual.body.project.currentVersionId, version.id); assert.deepEqual(actual.body.currentVersion, version);
}
async function restored(page, version) {
  await page.locator('[data-restore-state="confirmed"]').waitFor();
  await page.locator(`[data-current-version="${version.id}"]`).waitFor();
  await page.locator(`[data-input-base="${version.id}"]`).waitFor({ state: 'attached' });
  await button(page, '刷新版本状态').waitFor();
}
async function confirm(page) {
  await button(page, '恢复此版本').click(); await page.getByRole('dialog').waitFor();
  await button(page, '确认恢复此版本').click();
}
async function clickControl(page, name = '刷新版本状态') {
  const control = button(page, name);
  // Wait for scroll rendering before pointer input below the iframe.
  await control.scrollIntoViewIfNeeded();
  await control.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await control.click();
}
async function overflow(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Host overflow');
}
async function focusCheck(locator) {
  await locator.press('Tab');
  await locator.focus();
  const style = await locator.evaluate(element => { const css = getComputedStyle(element); return { outline: css.outlineStyle, width: css.outlineWidth, offset: css.outlineOffset }; });
  assert.deepEqual(style, { outline: 'solid', width: '2px', offset: '2px' });
}
async function touchCheck(locator) {
  const box = await locator.boundingBox(); assert.ok(box && box.height >= 44 && box.width >= 44, 'Control must be at least 44px');
}
async function mode(name, port) {
  const frontend = launch(path.join(root, 'frontend/node_modules/vite/bin/vite.js'), name === 'preview' ? ['preview'] : [], path.join(browserRepo, 'frontend'));
  await ready(`http://127.0.0.1:${port}`, frontend); const origin = `http://127.0.0.1:${port}`;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  context.setDefaultTimeout(12_000); const page = await context.newPage(); const requests = []; const hostErrors = [];
  let leakedCredential = false; let malformedWrite = false;
  context.on('request', request => {
    if (new URL(request.url()).origin !== origin) {
      const content = request.url() + (request.postData() ?? '') + JSON.stringify(request.headers());
      if ([...sessionTokens].some(token => content.includes(token))) leakedCredential = true;
      return;
    }
    if (request.method() !== 'POST') return;
    requests.push(request.url());
    if (request.url().endsWith('/generations')) report.generationPosts++;
    if (request.url().endsWith('/restore')) {
      report.restorePosts++;
      if (JSON.stringify(Object.keys(request.postDataJSON())) !== JSON.stringify(['expectedCurrentVersionId'])) malformedWrite = true;
    }
  });
  page.on('pageerror', error => { if (!error.message.includes('EXPLICIT_')) hostErrors.push(error.message); });
  const item = seed(`${name} pagination`, 55); const template = item.detail.currentVersion;
  const latest = item.versions.at(-1); let appended;
  try {
    await scenario(`${name}: visible exclusive pagination, concurrent append, failed-page retry and immutable metadata`, async () => {
      const pages = []; const listMatch = `**${projectPath(item)}/versions?*`;
      await page.route(listMatch, async route => {
        const response = await route.fetch(); const body = await response.json();
        pages.push({ before: new URL(route.request().url()).searchParams.get('beforeSequence'), sequences: body.items.map(row => row.sequence) });
        await route.fulfill({ response });
      });
      await open(page, origin, item); assert.equal(await history(page).locator('[data-history-version]').count(), 20);
      assert.match(await history(page).textContent(), /请求摘录（已截断）/); assert.match(await history(page).textContent(), /已存摘要/);
      const first = page.locator(`[data-history-version="${latest.id}"]`);
      await first.locator('summary').click(); assert.ok((await first.textContent()).includes(tools.quotePath));
      assert.equal(await page.locator('img[data-history-injection]').count(), 0);
      appended = storeWork(store => addVersion(store, item, 'normal', 11000));
      const match = `**${projectPath(item)}/versions?*beforeSequence=*`;
      await page.route(match, route => route.abort('connectionreset'));
      await button(page, '加载更早版本').click(); await history(page).getByRole('alert').waitFor();
      assert.equal(await history(page).locator('[data-history-version]').count(), 20); await page.unroute(match);
      await button(page, '重试读取历史').click(); await page.waitForFunction(() => document.querySelectorAll('[data-history-version]').length === 40);
      const scroll = history(page); await button(page, '加载更早版本').scrollIntoViewIfNeeded();
      const anchor = history(page).locator('[data-history-version]').nth(39); const y = (await anchor.boundingBox()).y;
      await button(page, '加载更早版本').focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelectorAll('[data-history-version]').length === 56);
      assert.ok(Math.abs((await anchor.boundingBox()).y - y) < 3, 'Pagination reading anchor moved');
      assert.deepEqual(await history(page).locator('[data-history-version] strong').allTextContents(), Array.from({ length: 56 }, (_, index) => `v${55 - index} · ${index === 55 ? '模板' : '生成快照'}`));
      assert.equal(await page.locator(`[data-history-version="${appended.id}"]`).count(), 0);
      assert.match(await scroll.textContent(), /无关联请求/); assert.match(await scroll.textContent(), /事实回退摘要/);
      await page.locator(`[data-history-version="${template.id}"] summary`).click(); assert.match(await scroll.textContent(), /模板起点，无修改文件/);
      assert.deepEqual(pages.map(value => value.before), [null, '36', '16']);
      assert.equal(new Set(pages.flatMap(value => value.sequences)).size, 56);
      await button(page, '刷新历史').click(); await page.locator(`[data-history-version="${appended.id}"]`).waitFor();
      assert.equal(await history(page).locator('[data-history-version]').count(), 20);
      assert.equal(requests.length, 0); await current(page, item, template);
      report.pagination ??= []; report.pagination.push({ mode: name, versions: 57, pages: pages.slice(0, 3), appendVisibleOnlyAfterRefresh: true });
      await page.unroute(listMatch);
    });
    await scenario(`${name}: GET-only history/code/current/candidate selection uses exact snapshot and one real quote preview`, async () => {
      await select(page, latest, false);
      await page.getByRole('combobox', { name: '选择文件', exact: true }).selectOption(tools.quotePath);
      assert.equal(await page.locator('pre[aria-label="文件源码"] code').textContent(), latest.snapshot.files[tools.quotePath]);
      assert.match(await page.getByRole('region', { name: '只读源码' }).textContent(), new RegExp(latest.snapshot.digest));
      await button(page, '预览').click(); await waitCompiled(page); await assertQuote(page, 10400);
      assert.equal(await page.locator('iframe').count(), 1); assert.equal(await page.locator('[data-viewed-version]').getAttribute('data-viewed-version'), latest.id);
      await button(page, '当前版本').click(); await button(page, '代码').click();
      await page.waitForFunction(entry => document.querySelector('select[aria-label="选择文件"]')?.value === entry, template.snapshot.entry);
      assert.equal(await page.locator(`option[value="${tools.quotePath}"]`).count(), 0);
      await button(page, '候选版本').click(); await waitCompiled(page);
      assert.equal(await page.locator('[data-viewed-version]').getAttribute('data-viewed-version'), latest.id);
      assert.equal(requests.length, 0); await current(page, item, template);
    });
    await scenario(`${name}: 1280/320/375 history/source/preview layout, 44px controls and keyboard dialog cancel`, async () => {
      await select(page, latest);
      for (const width of [1280, 320, 375]) {
        await page.setViewportSize({ width, height: 900 }); await button(page, '历史').click(); await overflow(page);
        await touchCheck(button(page, '刷新历史')); await focusCheck(button(page, '刷新历史'));
        const row = page.locator(`[data-history-version="${latest.id}"]`); await row.locator('summary').click(); await overflow(page);
        await touchCheck(row.locator('> button')); await touchCheck(row.locator('summary'));
        await button(page, '代码').click(); await page.getByRole('combobox', { name: '选择文件' }).selectOption(tools.quotePath);
        const source = page.locator('pre[aria-label="文件源码"]'); await overflow(page);
        const local = await source.evaluate(element => ({ scroll: element.scrollWidth, width: element.clientWidth, overflow: getComputedStyle(element).overflowX }));
        assert.ok(local.scroll > local.width); assert.equal(local.overflow, 'auto'); await focusCheck(source);
        await button(page, '预览').click(); await waitCompiled(page); await overflow(page);
        const frame = page.frameLocator('iframe'); await frame.locator('body').evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.ok(await frame.locator('html').evaluate(element => element.scrollWidth <= window.innerWidth + 1), 'Preview overflow');
        const primary = button(page, '恢复此版本'); await touchCheck(primary); await focusCheck(primary); await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog'); await dialog.waitFor(); await overflow(page);
        assert.ok(await button(page, '取消').evaluate(element => element === document.activeElement));
        await page.keyboard.press('Shift+Tab'); assert.ok(await button(page, '确认恢复此版本').evaluate(element => element === document.activeElement));
        await page.keyboard.press('Tab'); assert.ok(await button(page, '取消').evaluate(element => element === document.activeElement));
        await touchCheck(button(page, '取消')); await touchCheck(button(page, '确认恢复此版本'));
        assert.match(await dialog.textContent(), /临时业务输入可能重置/); assert.match(await dialog.textContent(), new RegExp(latest.snapshot.digest));
        await page.screenshot({ path: path.join(output, `${name}-dialog-${width}.png`), animations: 'disabled' });
        await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
        assert.ok(await primary.evaluate(element => element === document.activeElement));
        await primary.press('Enter'); await button(page, '取消').press('Enter'); assert.equal(requests.length, 0);
      }
      await page.setViewportSize({ width: 1280, height: 900 }); await current(page, item, template);
    });
    await scenario(`${name}: explicit branch restore, current fact/badge/draft, template restore, refresh and owned backend restart`, async () => {
      const before = immutable(item); await button(page, '聊天').click(); await page.getByRole('textbox', { name: '描述下一步需求' }).fill('Explicit unsent fixture draft');
      await select(page, latest); await assertQuote(page, 10400);
      const response = page.waitForResponse(value => value.url().endsWith(versionPath(item, latest) + '/restore'));
      await button(page, '恢复此版本').press('Enter'); await button(page, '取消').press('Tab'); await page.keyboard.press('Enter');
      assert.equal((await response).status(), 200); await restored(page, latest); await current(page, item, latest);
      await button(page, '聊天').click(); assert.equal(await page.getByRole('textbox', { name: '描述下一步需求' }).inputValue(), 'Explicit unsent fixture draft');
      await select(page, appended); assert.notEqual(appended.parentVersionId, latest.id);
      assert.equal((await api(page, 'GET', versionPath(item, appended))).body.adoptionAvailability, 'stale');
      await confirm(page); await restored(page, appended); await current(page, item, appended);
      await button(page, '历史').click(); while (await button(page, '加载更早版本').count()) { await button(page, '加载更早版本').click(); await history(page).getByText('正在读取版本历史…').waitFor({ state: 'hidden' }); }
      assert.equal(await history(page).locator('button span').filter({ hasText: '当前版本' }).count(), 1);
      assert.match(await page.locator(`[data-history-version="${appended.id}"] > button`).textContent(), /当前版本/);
      await select(page, template); assert.equal((await api(page, 'GET', versionPath(item, template))).body.adoptionAvailability, 'not-candidate');
      await confirm(page); await restored(page, template); await current(page, item, template);
      assert.equal(immutable(item), before, 'Restore changed immutable versions/messages/runs');
      await stop(backend); await startBackend(); const posts = requests.length;
      await page.reload(); await button(page, '当前版本').click(); await button(page, '预览').click(); await waitCompiled(page);
      await current(page, item, template); assert.equal(requests.length, posts); assert.equal(await page.frameLocator('iframe').getByTestId('quote-total').count(), 0);
    });
    await scenario(`${name}: delayed A detail cannot replace B, real compile/runtime errors and untrusted messages gate restore`, async () => {
      const broken = seed(`${name} errors`); const syntax = storeWork(store => addVersion(store, broken, 'syntax')); const runtimeError = storeWork(store => addVersion(store, broken, 'runtime'));
      await open(page, origin, broken); const hold = gate(); let captured;
      const received = new Promise(resolve => { captured = resolve; }); const match = `**${versionPath(broken, broken.versions[0])}`;
      await page.route(match, async route => { const response = await route.fetch(); captured(); await hold.promise; await route.fulfill({ response }).catch(() => {}); });
      try {
        await page.locator(`[data-history-version="${broken.versions[0].id}"] > button`).click(); await bounded(received);
        await page.locator(`[data-history-version="${broken.versions[1].id}"] > button`).click();
        await button(page, '代码').click(); await page.getByRole('combobox', { name: '选择文件' }).selectOption(tools.quotePath);
        hold.release(); await page.unroute(match);
        assert.equal(await page.locator('pre[aria-label="文件源码"] code').textContent(), broken.versions[1].snapshot.files[tools.quotePath]);
      } finally { hold.release(); await page.unroute(match); }
      for (const version of [syntax, runtimeError]) {
        await select(page, version, false); await button(page, '预览').click();
        await page.waitForFunction(() => ['compileError', 'runtimeError'].includes(document.querySelector('[data-preview-state]')?.getAttribute('data-preview-state')), undefined, { timeout: 70_000 });
        await page.evaluate(() => window.postMessage({ type: 'done', compilatonError: false, verified: true }, '*'));
        assert.equal(await button(page, '恢复此版本').isDisabled(), true); await current(page, broken, broken.detail.currentVersion);
      }
      await select(page, broken.versions[0]); await page.frameLocator('iframe').getByRole('button', { name: '触发运行错误', exact: true }).click();
      await page.locator('[data-preview-state="runtimeError"]').waitFor(); assert.equal(await button(page, '恢复此版本').isDisabled(), true);
      await button(page, '重新加载预览').click(); await waitCompiled(page); assert.equal(await button(page, '恢复此版本').isEnabled(), true);
    });
    await scenario(`${name}: competing same-owner tabs commit once and stale CAS cannot overwrite the winner`, async () => {
      const race = seed(`${name} CAS`); const tab = await context.newPage();
      try {
        await open(page, origin, race); await open(tab, origin, race);
        await select(page, race.versions[0]); await select(tab, race.versions[1]);
        await button(page, '恢复此版本').click(); await button(tab, '恢复此版本').click();
        await button(page, '确认恢复此版本').click(); await restored(page, race.versions[0]);
        const response = tab.waitForResponse(value => value.url().endsWith('/restore')); await button(tab, '确认恢复此版本').click();
        assert.equal((await response).status(), 409); await tab.locator('[data-restore-state="conflict"]').waitFor();
        await tab.locator(`[data-current-version="${race.versions[0].id}"]`).waitFor(); await current(page, race, race.versions[0]);
      } finally { await tab.close(); }
    });
    await scenario(`${name}: real SQLite storage failure rolls back; orphan running rejects; transport busy stays locked`, async () => {
      const guarded = seed(`${name} guards`); await open(page, origin, guarded); await select(page, guarded.versions[0]);
      const db = new tools.Database(database); const before = immutable(guarded);
      db.exec("CREATE TRIGGER history_fixture_failure BEFORE UPDATE OF current_version_id ON projects BEGIN SELECT RAISE(ABORT,'EXPLICIT_FIXTURE_WRITE_FAILURE'); END");
      try { const response = page.waitForResponse(value => value.url().endsWith('/restore')); await confirm(page); assert.equal((await response).status(), 503);
        await page.locator('[data-restore-state="error"]').waitFor(); await current(page, guarded, guarded.detail.currentVersion); assert.equal(immutable(guarded), before);
      } finally { db.exec('DROP TRIGGER history_fixture_failure'); db.close(); }
      const orphan = storeWork(store => store.createRun({ projectId: guarded.detail.project.id, requestId: randomUUID(), baseVersionId: guarded.detail.currentVersion.id }));
      const response = page.waitForResponse(value => value.url().endsWith('/restore')); await confirm(page);
      assert.equal((await response).status(), 503); assert.equal((await (await response).json()).error.code, 'RUN_STATE_UNCONFIRMED');
      await page.locator('[data-restore-state="unconfirmed"]').waitFor(); assert.equal(await button(page, '恢复此版本').isDisabled(), true);
      storeWork(store => store.finishRun({ projectId: guarded.detail.project.id, runId: orphan.id, status: 'interrupted', errorCode: 'PROCESS_RESTARTED' }));
      assert.equal((await api(page, 'GET', projectPath(guarded))).body.latestRun.status, 'interrupted');
      const [refreshed] = await Promise.all([
        page.waitForResponse(value => value.url() === origin + projectPath(guarded) && value.request().method() === 'GET', { timeout: 12_000 }),
        clickControl(page),
      ]);
      assert.equal((await refreshed.json()).latestRun.status, 'interrupted');
      await page.locator('[data-restore-state="error"]').waitFor(); await waitCompiled(page);
      const match = `**${versionPath(guarded, guarded.versions[0])}/restore`;
      await page.route(match, route => route.fulfill({ status: 409, contentType: 'application/json', json: { error: { code: 'PROJECT_BUSY', message: 'Explicit transport busy fixture' }, requestId: randomUUID() } }));
      try { await confirm(page); await page.locator('[data-restore-state="busy"]').waitFor(); assert.equal(await button(page, '恢复此版本').isDisabled(), true); await current(page, guarded, guarded.detail.currentVersion); }
      finally { await page.unroute(match); }
      await stop(backend); await startBackend();
    });
    await scenario(`${name}: real commit with lost POST and failed GET remains unknown; manual query confirms without automatic POST`, async () => {
      const lost = seed(`${name} unknown`); await open(page, origin, lost); await select(page, lost.versions[0]);
      const match = `**${versionPath(lost, lost.versions[0])}/restore`; const query = `**${projectPath(lost)}`; let sent = 0; let reads = 0;
      await page.route(match, async route => { sent++; const response = await route.fetch(); assert.equal(response.status(), 200); await route.abort('connectionreset'); });
      await page.route(query, route => { reads++; return route.abort('connectionreset'); });
      try {
        await confirm(page); await page.locator('[data-restore-state="unknown"]').waitFor(); await page.getByRole('alert').filter({ hasText: '项目查询失败' }).waitFor();
        assert.equal(reads, 1); assert.equal(sent, 1); assert.equal(await button(page, '恢复此版本').isDisabled(), true);
        await button(page, '聊天').click(); await page.getByRole('textbox', { name: '描述下一步需求' }).fill('Explicit unknown draft');
        assert.equal(await button(page, '生成候选').isDisabled(), true);
        await button(page, '预览').click(); await clickControl(page, '查询恢复结果'); await page.getByRole('alert').filter({ hasText: '项目查询失败' }).waitFor();
        assert.equal(reads, 2); assert.equal(sent, 1);
        await page.unroute(query); await clickControl(page, '查询恢复结果'); await restored(page, lost.versions[0]);
        await current(page, lost, lost.versions[0]); assert.equal(sent, 1);
        const count = requests.length; await page.reload(); await waitCompiled(page); await current(page, lost, lost.versions[0]); assert.equal(requests.length, count);
      } finally { await page.unroute(query); await page.unroute(match); }
    });
    await scenario(`${name}: confirmed POST survives failed calibration; explicit query obtains actual current`, async () => {
      const saved = seed(`${name} calibration`); await open(page, origin, saved); await select(page, saved.versions[0]);
      const query = `**${projectPath(saved)}`; await page.route(query, route => route.abort('connectionreset'));
      try { await confirm(page); await page.locator('[data-restore-state="confirmed"]').waitFor(); await page.getByRole('alert').filter({ hasText: '操作已确认' }).waitFor();
        assert.equal(await page.locator('[data-current-version]').getAttribute('data-current-version'), saved.versions[0].id);
      } finally { await page.unroute(query); }
      await clickControl(page); await current(page, saved, saved.versions[0]);
    });
    await scenario(`${name}: lost response automatically confirms real commit by GET with exactly one POST`, async () => {
      const lost = seed(`${name} auto confirmation`); await open(page, origin, lost); await select(page, lost.versions[0]);
      const match = `**${versionPath(lost, lost.versions[0])}/restore`; let sent = 0;
      await page.route(match, async route => { sent++; const response = await route.fetch(); assert.equal(response.status(), 200); await route.abort('connectionreset'); });
      try { await confirm(page); await restored(page, lost.versions[0]); await current(page, lost, lost.versions[0]); assert.equal(sent, 1); }
      finally { await page.unroute(match); }
    });
    await scenario(`${name}: later real restore wins after lost response; query reports different current and never rewrites`, async () => {
      const later = seed(`${name} later current`); await open(page, origin, later); await select(page, later.versions[0]);
      const match = `**${versionPath(later, later.versions[0])}/restore`; let sent = 0;
      await page.route(match, async route => {
        sent++; const response = await route.fetch(); assert.equal(response.status(), 200);
        const next = await context.request.post(`${origin}${versionPath(later, later.versions[1])}/restore`,
          { headers: { origin }, data: { expectedCurrentVersionId: later.versions[0].id } });
        assert.equal(next.status(), 200); await route.abort('connectionreset');
      });
      try {
        await confirm(page); await page.locator('[data-restore-state="unknown"]').filter({ hasText: '观察到当前版本' }).waitFor();
        await current(page, later, later.versions[1]); assert.equal(sent, 1);
        await clickControl(page, '查询恢复结果'); await page.locator('[data-restore-state="unknown"]').filter({ hasText: '观察到当前版本' }).waitFor();
        assert.equal(await button(page, '恢复此版本').isDisabled(), true); await current(page, later, later.versions[1]); assert.equal(sent, 1);
      } finally { await page.unroute(match); }
    });
    await scenario(`${name}: offline history detail clears old preview, preserves current and explicitly retries real snapshot`, async () => {
      const offline = seed(`${name} offline`); await open(page, origin, offline);
      const match = `**${versionPath(offline, offline.versions[0])}`;
      await page.route(match, route => route.abort('connectionreset'));
      try {
        await page.locator(`[data-history-version="${offline.versions[0].id}"] > button`).click(); await button(page, '预览').click();
        await button(page, '重试读取版本').waitFor(); assert.equal(await page.locator('iframe').count(), 0); assert.equal(await button(page, '恢复此版本').isDisabled(), true);
      } finally { await page.unroute(match); }
      await button(page, '重试读取版本').click(); await waitCompiled(page); await assertQuote(page);
      await current(page, offline, offline.detail.currentVersion);
    });
    await scenario(`${name}: history loading/empty transport states, 404 detail clearing and 401 cache removal without session POST`, async () => {
      const privateItem = seed(`${name} private`); await open(page, origin, privateItem);
      const list = `**${projectPath(privateItem)}/versions?*`; const hold = gate(); let captured;
      const received = new Promise(resolve => { captured = resolve; });
      await page.route(list, async route => { const response = await route.fetch(); captured(); await hold.promise; await route.fulfill({ response, json: { projectId: privateItem.detail.project.id, currentVersionId: privateItem.detail.currentVersion.id, items: [], nextBeforeSequence: null } }); });
      try { await button(page, '刷新历史').click(); await bounded(received); await history(page).getByText('正在读取版本历史…').waitFor(); hold.release(); await history(page).getByText('没有可显示的历史版本。').waitFor(); }
      finally { hold.release(); await page.unroute(list); }
      const [reloaded] = await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === projectPath(privateItem) + '/versions'),
        clickControl(page, '刷新历史'),
      ]);
      assert.equal(reloaded.status(), 200); assert.equal((await reloaded.json()).items.length, 3);
      await history(page).locator('[data-history-version]').first().waitFor();
      const missing = privateItem.versions[0]; const detail = `**${versionPath(privateItem, missing)}`;
      await page.route(detail, route => route.fulfill({ status: 404, contentType: 'application/json', json: { error: { code: 'NOT_FOUND', message: 'Not found' }, requestId: randomUUID() } }));
      try { await page.locator(`[data-history-version="${missing.id}"] > button`).click(); await page.getByRole('alert').filter({ hasText: /404|不可访问|不存在/ }).waitFor();
        assert.equal(await page.locator(`[data-history-version="${missing.id}"]`).count(), 0); assert.equal(await page.locator('iframe').count(), 0);
      } finally { await page.unroute(detail); }
      const stranger = await browser.newContext(); const alien = await stranger.newPage();
      try {
        await alien.goto(`${origin}/projects/${privateItem.detail.project.id}`); await alien.getByRole('alert').filter({ hasText: '会话' }).waitFor(); assert.equal(await alien.locator('iframe').count(), 0);
        const outsider = storeWork(store => store.createSession()); await session(stranger, outsider); await alien.reload();
        await alien.getByRole('alert').filter({ hasText: /404|不可访问/ }).waitFor();
        assert.equal((await api(alien, 'GET', versionPath(privateItem, missing))).status, 404);
      } finally { await stranger.close(); }
      const posts = requests.length; await context.clearCookies(); await button(page, '刷新历史').click();
      await page.getByRole('alert').filter({ hasText: '会话' }).waitFor(); assert.equal(await page.locator('[data-history-version]').count(), 0); assert.equal(await page.locator('iframe').count(), 0); assert.equal(requests.length, posts);
    });
    if (name === 'preview') await scenario('preview: blocked real bundler times out, fake window done cannot unlock, retry really compiles', async () => {
      const blocked = seed('bundler timeout'); const isolated = await browser.newContext({ viewport: { width: 320, height: 900 } }); const target = await isolated.newPage();
      try {
        await isolated.route('https://2-19-8-sandpack.codesandbox.io/**', route => route.abort('connectionreset'));
        await open(target, origin, blocked); await select(target, blocked.versions[0], false); await button(target, '预览').click();
        await target.locator('[data-preview-state="timeout"]').waitFor({ timeout: 70_000 });
        await target.evaluate(() => window.postMessage({ type: 'done', compilatonError: false }, '*'));
        assert.equal(await button(target, '恢复此版本').isDisabled(), true); await overflow(target);
        await isolated.unroute('https://2-19-8-sandpack.codesandbox.io/**'); await button(target, '重新加载预览').click(); await waitCompiled(target); await assertQuote(target);
        await current(target, blocked, blocked.detail.currentVersion);
      } finally { await isolated.close(); }
    });
    assert.deepEqual(hostErrors, [], 'Unexpected browser errors'); assert.equal(report.generationPosts, 0);
    assert.equal(leakedCredential, false, 'Session credential reached external preview'); assert.equal(malformedWrite, false, 'Restore body was not strict');
  } catch (error) {
    await page.screenshot({ path: path.join(output, `${name}-failure.png`), fullPage: true }).catch(() => {}); throw error;
  } finally { await context.close(); await stop(frontend); }
}
async function main() {
  await mkdir(output, { recursive: true, mode: 0o700 }); deadline = setTimeout(() => cancel('TIMEOUT'), 12 * 60_000);
  for (const port of [3001, 5173, 4173]) await portFree(port);
  const { prepareBackendRuntime } = await import('./prepare-backend-runtime.mjs'); await prepareBackendRuntime(root, deploy);
  await mkdir(browserRepo, { recursive: true });
  for (const file of ['package.json', 'tsconfig.base.json']) await cp(path.join(root, file), path.join(browserRepo, file));
  await cp(path.join(root, 'templates'), path.join(browserRepo, 'templates'), { recursive: true });
  await cp(path.join(root, 'frontend'), path.join(browserRepo, 'frontend'), { recursive: true,
    filter: source => !['node_modules', '.env', 'data'].includes(path.basename(source)) && !path.basename(source).startsWith('.env.') });
  await symlink(path.join(root, 'node_modules'), path.join(browserRepo, 'node_modules'), 'dir');
  await symlink(path.join(root, 'frontend/node_modules'), path.join(browserRepo, 'frontend/node_modules'), 'dir');
  report.inputDigests = {};
  for (const file of ['frontend/dist/index.html', 'frontend/src/workspace/controller.ts', 'frontend/src/workspace/VersionPane.tsx',
    'frontend/src/workspace/HistoryPane.tsx', 'frontend/src/workspace/Workspace.module.css', 'backend/dist/storage/store.js', 'backend/dist/routes/versions.js']) {
    const copied = path.join(file.startsWith('backend/') ? deploy : browserRepo, file.replace(/^backend\//, ''));
    report.inputDigests[file] = createHash('sha256').update(await readFile(copied)).digest('hex');
  }
  const { openStore } = await import(pathToFileURL(path.join(deploy, 'dist/storage/store.js')).href);
  const fixtures = await import('./candidate-fixtures.mjs');
  tools = { openStore, ...fixtures, Database: createRequire(path.join(deploy, 'package.json'))('better-sqlite3') };
  bundle = JSON.parse(await readFile(path.join(deploy, 'dist/template-assets/company-landing.bundle.json'), 'utf8'));
  await startBackend(); browser = await chromium.launch({ channel: 'chrome', headless: true, handleSIGINT: false, handleSIGTERM: false });
  await mode('dev', 5173); await stop(backend); await startBackend(); await mode('preview', 4173); report.status = 'passed';
}
main().catch(error => {
  report.status = ['SIGINT', 'SIGTERM'].includes(interrupted) ? 'cancelled' : 'failed';
  // Error bodies and original exceptions stay out of the persisted report.
  report.error = error.message.split('\n')[0].slice(0, 300); console.error(error.stack);
  process.exitCode = interrupted === 'SIGINT' ? 130 : interrupted === 'SIGTERM' ? 143 : 1;
}).finally(async () => {
  clearTimeout(deadline);
  const results = await Promise.allSettled([closeBrowser(browser), ...[...children].map(stop)]);
  report.cleanup = results.some(result => result.status === 'rejected') ? 'failed' : 'passed';
  if (report.cleanup === 'failed') { report.status = 'failed'; process.exitCode = 1; }
  else await rm(runtime, { recursive: true, force: true });
  report.durationMs = Date.now() - startedAt;
  if (['SIGINT', 'SIGTERM'].includes(interrupted) && report.cleanup === 'passed') {
    report.status = 'cancelled'; process.exitCode = interrupted === 'SIGINT' ? 130 : 143;
  }
  await mkdir(output, { recursive: true, mode: 0o700 });
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(`History workspace report: ${path.relative(root, path.join(output, 'report.json'))}`);
});
