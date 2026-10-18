/* global document */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash, randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import workspace from '../verification/workspace-path.cjs';
import {baselineInteractions, geometry} from '../live/browser.mjs';
import {business} from './browser.mjs';
import {cases} from './cases.mjs';
import {files} from './fixture.mjs';
const {api, waitCompiled, createViaForm} = workspace;
export const origin = 'http://127.0.0.1:4173';
const button = (page, name) => page.getByRole('button', {name, exact: true});
export function digest(value) {
  const canonical = item => Array.isArray(item) ? item.map(canonical) : item && typeof item === 'object'
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, canonical(item[key])])) : item;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export async function fixtureProvider(check = () => {}) {
  const state = {stage: 'v1', mode: 'normal', requests: 0, captures: [], waiters: [], errors: []};
  const server = createServer(async (req, res) => {
    try {
      check(); assert.equal(req.url, '/v1/responses'); assert.equal(req.method, 'POST');
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks)); state.requests++;
      state.captures.push({stage: state.stage, body});
      const outputs = body.input.filter(item => item.type === 'function_call_output'); const step = outputs.length;
      assert.ok(step < 3); assert.equal(body.store, false);
      if (state.mode === 'hold') await new Promise(resolve => { state.waiters.push(resolve); res.once('close', resolve); });
      if (res.destroyed) return;
      let name = 'list_files', input = {};
      if (step === 1) {
        const directory = JSON.parse(outputs[0].output);
        input = {paths: directory.files.map(file => file.path).filter(name => name === '/src/App.tsx' || name.startsWith('/src/generated/'))}; name = 'read_files';
      } else if (step === 2) {
        name = 'submit_files'; input = {files: files(state.stage, JSON.parse(outputs.at(-1).output).files)};
      }
      const output = state.mode === 'refusal' ? [{type: 'message', id: 'msg_revision', role: 'assistant', status: 'completed', content: [{type: 'refusal', refusal: 'Explicit revision fixture rejection'}]}]
        : [{type: 'function_call', id: `fc_${step}`, call_id: `call_${step}`, name, arguments: JSON.stringify(input), status: 'completed'}];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({id: 'resp_revision_fixture', object: 'response', created_at: 1790000000, status: 'completed', model: 'gpt-6.1-sol', output,
        usage: {input_tokens: 12, output_tokens: 7, total_tokens: 19}}));
    } catch (error) { state.errors.push(error.stack); if (!res.destroyed) { res.statusCode = 500; res.end('{}'); } }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {state, origin: `http://127.0.0.1:${server.address().port}`,
    abort() { server.closeAllConnections(); this.release(); },
    release() { state.mode = 'normal'; for (const release of state.waiters.splice(0)) release(); },
    async close() { this.release(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }};
}
async function select(page, id) {
  await button(page, '历史').click();
  await page.locator(`[data-history-version="${id}"] > button`).click();
  await page.waitForFunction(id => document.querySelector('[data-viewed-version]')?.getAttribute('data-viewed-version') === id && !document.body.textContent.includes('正在读取所选版本完整快照'), id);
  await button(page, '预览').click(); await waitCompiled(page);
}
async function confirm(page) {
  await button(page, '恢复此版本').click(); await page.getByRole('dialog').waitFor();
  await button(page, '确认恢复此版本').click(); await page.locator('[data-restore-state="confirmed"]').waitFor();
}
export async function mainPath({page, context, report, provider, phase, count, restart, privateDir, check, audit}) {
  let projectId; const versions = []; let template; const posts = []; let active; let restorePosts = 0; let fatal;
  const detail = async () => { const response = await api(page, 'GET', `/api/projects/${projectId}`); assert.equal(response.status, 200); return response.body; };
  const review = async id => { const response = await api(page, 'GET', `/api/projects/${projectId}/versions/${id}`); assert.equal(response.status, 200); return response.body; };
  const unchanged = async () => { for (const version of versions) assert.deepEqual((await review(version.id)).version, version); };
  await page.route('**/generations', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    try {
      check(); assert.ok(active); assert.equal(posts.filter(post => post.stage === active.id).length, 0); assert.ok(posts.length < 3);
      const body = route.request().postDataJSON();
      assert.deepEqual(Object.keys(body).sort(), ['baseVersionId', 'prompt', 'requestId']); assert.equal(body.prompt, active.prompt.trim());
      assert.equal(body.baseVersionId, active.base.id); assert.ok(!posts.some(post => post.requestId === body.requestId));
      posts.push({...body, stage: active.id}); await route.continue();
    } catch (error) { fatal = error; await route.abort('blockedbyclient'); }
  });
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/restore')) restorePosts++; });
  try {
    for (const item of cases) {
      check(); const record = report.cases.find(row => row.id === item.id); record.status = 'running';
      const generationBefore = await count();
      if (item.id === 'v1') {
        await page.goto(origin);
        await page.locator('select#template-choice').waitFor();
        await page.waitForFunction(() => !!document.querySelector('select#template-choice')?.value);
        // The first POST is held until its freshly created template is read.
        const match = '**/api/projects'; let created;
        await page.route(match, async route => {
          if (route.request().method() !== 'POST') return route.continue();
          const response = await route.fetch(); created = await response.json();
          template = created.currentVersion; active = {...item, base: template}; await route.fulfill({response});
        });
        if (provider) provider.state.stage = item.id;
        projectId = await createViaForm(page, item.title, item.prompt); await page.unroute(match);
        assert.equal(template.kind, 'template'); assert.equal(template.sequence, 0); report.projectId = projectId;
      } else {
        active = {...item, base: versions[0]};
        if (provider) provider.state.stage = item.id;
        await button(page, '聊天').click(); await page.getByRole('textbox', {name: '描述下一步需求', exact: true}).fill(item.prompt);
        await button(page, '生成候选').click();
      }
      await phase(`${item.id}-generation`, false, async () => {
        await page.waitForFunction(() => ['terminal', 'unknown'].includes(document.querySelector('[data-task-phase]')?.getAttribute('data-task-phase')), undefined, {timeout: 145000});
        check(); if (fatal) throw fatal;
        assert.equal(await page.locator('[data-task-phase]').getAttribute('data-task-phase'), 'terminal', 'GENERATION_UNKNOWN');
        const saved = await detail(); assert.equal(saved.latestRun?.status, 'succeeded', 'GENERATION_FAILED');
        const candidate = await review(saved.latestRun.resultVersionId); const version = candidate.version;
        const post = posts.at(-1); assert.equal(post.stage, item.id); assert.equal(saved.latestRun.requestId, post.requestId);
        assert.equal(saved.latestRun.baseVersionId, active.base.id); assert.equal(version.parentVersionId, active.base.id);
        assert.equal(saved.currentVersion.id, active.base.id); assert.equal(version.sequence, item.id === 'v1' ? 1 : Math.max(...versions.map(value => value.sequence)) + 1);
        assert.equal(candidate.successfulRun.id, saved.latestRun.id); assert.notEqual(version.snapshot.digest, active.base.snapshot.digest);
        assert.deepEqual(version.snapshot.dependencies, template.snapshot.dependencies); assert.equal(version.snapshot.entry, template.snapshot.entry);
        record.versionId = version.id; record.runId = saved.latestRun.id; record.requestId = post.requestId;
        record.baseVersionId = post.baseVersionId; record.parentVersionId = version.parentVersionId; record.sequence = version.sequence;
        record.snapshotDigest = version.snapshot.digest; record.contentHash = digest(version.snapshot.files); record.metrics = await audit(record);
        if (provider) {
          const captured = provider.state.captures.filter(value => value.stage === item.id).map(value => value.body);
          assert.equal(captured.length, 3); const initial = captured[0].input;
          const content = initial.map(value => typeof value.content === 'string' ? value.content : (value.content ?? []).map(part => part.text ?? '').join(''));
          assert.equal(content.filter(text => text === item.prompt.trim()).length, 1);
          if (item.id !== 'v1') {
            const messages = (await api(page, 'GET', `/api/projects/${projectId}/messages?direction=backward&limit=50`)).body.items;
            const aRun = report.cases[0].runId;
            for (const message of messages.filter(message => message.runId === aRun)) assert.equal(content.filter(text => text === message.content).length, 1);
            if (item.id === 'v3') for (const message of messages.filter(message => message.runId === report.cases[1].runId)) {
              const inherited = messages.filter(value => value.runId === aRun && value.content === message.content).length;
              // Generic saved summaries may be byte-identical on different branches.
              assert.equal(content.filter(text => text === message.content).length, inherited);
            }
          }
          const read = JSON.parse(captured[2].input.filter(value => value.type === 'function_call_output').at(-1).output).files;
          assert.ok(read.length); for (const file of read) assert.equal(file.content, active.base.snapshot.files[file.path]);
          record.context = {initialHash: digest(initial), initialBytes: Buffer.byteLength(JSON.stringify(initial)), frozenFiles: read.map(file => ({path: file.path, digest: digest(file.content)})), branchIsolation: true};
        }
        versions.push(version);
      }, generationBefore);
      await phase(`${item.id}-business-adoption`, true, async () => {
        await button(page, '预览').click(); await waitCompiled(page); await business(page, item.id); await baselineInteractions(page);
        record.geometry = [];
        for (const width of [1366, 320, 375]) {
          record.geometry.push(await geometry(page, width)); await business(page, item.id);
          await page.screenshot({path: path.join(privateDir, `${item.id}-${width}.png`), fullPage: true, animations: 'disabled'});
        }
        await page.setViewportSize({width: 1366, height: 900});
        assert.equal((await detail()).currentVersion.id, active.base.id);
        await button(page, '使用这个版本').click(); await page.locator('[data-adoption-state="confirmed"]').waitFor();
        assert.deepEqual((await detail()).currentVersion, versions.at(-1)); await unchanged();
      }); record.status = 'passed'; active = undefined;
      if (item.id === 'v2') {
        await phase('history-pagination-preview-cancel', true, async () => {
          const historyMessages = (await api(page, 'GET', `/api/projects/${projectId}/messages?direction=backward&limit=50`)).body.items;
          const all = []; let before; const pages = [];
          do {
            const response = await api(page, 'GET', `/api/projects/${projectId}/versions?limit=1${before === undefined ? '' : `&beforeSequence=${before}`}`);
            assert.equal(response.status, 200); assert.equal(response.cache, 'no-store');
            const body = response.body; assert.equal(body.currentVersionId, versions[1].id); assert.equal(body.items.length, 1);
            for (const row of body.items) {
              assert.equal(row.snapshot, undefined); assert.equal(row.files, undefined);
              const full = row.sequence === 0 ? template : versions.find(value => value.id === row.id); assert.ok(full); assert.equal(row.parentVersionId, full.parentVersionId); assert.equal(row.isCurrent, row.id === versions[1].id);
              const complete = await review(row.id); assert.deepEqual(row.changedFiles, complete.changedFiles); assert.equal(row.runId, complete.successfulRun?.id ?? null);
              if (row.runId) {
                const request = historyMessages.find(message => message.runId === row.runId && message.role === 'user');
                const summary = historyMessages.find(message => message.runId === row.runId && message.role === 'assistant'); assert.ok(request); assert.ok(summary);
                assert.deepEqual(row.request, {messageId: request.id, excerpt: Array.from(request.content).slice(0, 240).join(''), truncated: Array.from(request.content).length > 240});
                assert.deepEqual(row.summary, {source: 'stored', text: Array.from(summary.content).slice(0, 240).join('')});
              }
            }
            pages.push(body); all.push(...body.items); before = body.nextBeforeSequence;
          } while (before !== null);
          assert.deepEqual(all.map(value => value.sequence), [2, 1, 0]); assert.equal(new Set(all.map(value => value.id)).size, 3); report.history = pages;
          // Exercise UI pagination on the same three real versions with a smaller API page.
          const listMatch = `**/api/projects/${projectId}/versions?*`; const uiPages = [];
          await page.route(listMatch, async route => {
            const url = new URL(route.request().url()); url.searchParams.set('limit', '1');
            const response = await route.fetch({url: url.href}); const body = await response.json(); uiPages.push(body.items.map(row => row.id));
            await route.fulfill({response});
          });
          try {
            await button(page, '历史').click(); await page.locator('[data-history-version]').first().waitFor();
            // A previous pane may have populated its cache before the smaller page was installed.
            await button(page, '刷新历史').click();
            await page.waitForFunction(() => document.querySelectorAll('[data-history-version]').length === 1);
            for (const expected of [2, 3]) { await button(page, '加载更早版本').click(); await page.waitForFunction(n => document.querySelectorAll('[data-history-version]').length === n, expected); }
            assert.equal(await button(page, '加载更早版本').count(), 0); report.uiHistoryPages = uiPages;
          } finally { await page.unroute(listMatch); }
          assert.equal(await page.locator('[data-history-version]').count(), 3);
          await select(page, versions[0].id); await business(page, 'v1'); await baselineInteractions(page);
          const beforeRestore = restorePosts;
          await button(page, '恢复此版本').focus(); await page.keyboard.press('Enter'); await page.getByRole('dialog').waitFor();
          await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({state: 'hidden'});
          assert.ok(await button(page, '恢复此版本').evaluate(element => element === document.activeElement));
          assert.equal(restorePosts, beforeRestore); assert.equal((await detail()).currentVersion.id, versions[1].id); await unchanged();
          report.cancelRestorePosts = restorePosts - beforeRestore;
        });
        await phase('explicit-restore', true, async () => {
          await confirm(page); await page.locator(`[data-input-base="${versions[0].id}"]`).waitFor({state: 'attached'});
          assert.equal(restorePosts, 1); assert.deepEqual((await detail()).currentVersion, versions[0]); await unchanged();
          assert.equal((await api(page, 'GET', `/api/projects/${projectId}/versions?limit=50`)).body.items.length, 3);
        });
        await phase('refresh-owned-restart', true, async () => {
          await page.reload(); await waitCompiled(page); assert.deepEqual((await detail()).currentVersion, versions[0]);
          await restart(); await page.reload(); await waitCompiled(page); assert.deepEqual((await detail()).currentVersion, versions[0]);
          await business(page, 'v1'); await unchanged();
        });
      }
    }
    await phase('v2-preserved-preview', true, async () => {
      await unchanged(); await select(page, versions[1].id); await business(page, 'v2'); await baselineInteractions(page);
      assert.equal((await detail()).currentVersion.id, versions[2].id);
      await button(page, '当前版本').click(); await button(page, '预览').click(); await waitCompiled(page); await business(page, 'v3');
      assert.equal(posts.length, 3); assert.equal(restorePosts, 1); assert.ok(await count() >= 3);
    });
    await context.storageState({path: path.join(privateDir, 'author-storage.json')});
    return {projectId, versions, template};
  } finally { await page.unroute('**/generations'); }
}

// Independent projects below are explicit storage fixtures, never main-path candidates.
export async function negativePath({browser, deploy, database, phase, provider, count, check, restart}) {
  const {openStore} = await import(pathToFileURL(path.join(deploy, 'dist/storage/store.js')).href);
  const Database = createRequire(path.join(deploy, 'package.json'))('better-sqlite3');
  const db = new Database(database);
  const work = fn => { const store = openStore(database); try { return fn(store); } finally { store.close(); } };
  const owner = work(store => store.createSession());
  const {readFile} = await import('node:fs/promises');
  const bundle = JSON.parse(await readFile(path.join(deploy, 'dist/template-assets/company-landing.bundle.json'), 'utf8'));
  const {candidateSnapshot} = await import('../candidate-fixtures.mjs');
  const seeded = work(store => {
    const detail = store.createProject(owner.id, 'Explicit independent revision guards', bundle, 100);
    const candidates = [];
    for (let i = 0; i < 2; i++) {
      const run = store.createRun({projectId: detail.project.id, requestId: randomUUID(), baseVersionId: detail.currentVersion.id});
      candidates.push(store.saveCandidate({projectId: detail.project.id, runId: run.id, snapshot: candidateSnapshot(bundle, 'normal', 5000 + i * 100)}).version);
    }
    return {detail, candidates};
  });
  const id = seeded.detail.project.id, template = seeded.detail.currentVersion, [a, b] = seeded.candidates;
  const context = await browser.newContext();
  await context.addCookies([{name: 'atoms_session', value: owner.token, domain: '127.0.0.1', path: '/api', httpOnly: true, sameSite: 'Strict'}]);
  const target = await context.newPage(); await target.goto(origin + '/diagnostics/connection');
  const project = `/api/projects/${id}`;
  const restore = (version, expected) => api(target, 'POST', `${project}/versions/${version.id}/restore`, {expectedCurrentVersionId: expected.id});
  const immutable = excludedRun => digest(['versions', 'messages', 'generation_runs'].map(table => db.prepare(`SELECT * FROM ${table} WHERE project_id=? ORDER BY id`).all(id).filter(row => row.id !== excludedRun)));
  try {
    await phase('negative-storage-cas-unknown-access', true, async () => {
      const before = immutable();
      const invalid = await restore({id: randomUUID()}, template); assert.equal(invalid.status, 404);
      const races = await Promise.all([restore(a, template), restore(b, template)]); assert.deepEqual(races.map(value => value.status).sort(), [200, 409]);
      const current = (await api(target, 'GET', project)).body.currentVersion;
      const loser = current.id === a.id ? b : a;
      assert.equal((await restore(loser, template)).status, 409);
      db.exec("CREATE TRIGGER revision_restore_failure BEFORE UPDATE OF current_version_id ON projects BEGIN SELECT RAISE(ABORT,'EXPLICIT_REVISION_FAILURE'); END");
      try { assert.equal((await restore(template, current)).status, 503); assert.equal((await api(target, 'GET', project)).body.currentVersion.id, current.id); }
      finally { db.exec('DROP TRIGGER revision_restore_failure'); }
      const orphan = work(store => store.createRun({projectId: id, requestId: randomUUID(), baseVersionId: current.id}));
      const unknown = await restore(template, current); assert.equal(unknown.status, 503); assert.equal(unknown.body.error.code, 'RUN_STATE_UNCONFIRMED');
      work(store => store.finishRun({projectId: id, runId: orphan.id, status: 'interrupted', errorCode: 'PROCESS_RESTARTED'}));
      assert.equal(immutable(orphan.id), before, 'Existing history changed');
      const stranger = await browser.newContext(); const alien = await stranger.newPage();
      try {
        await alien.goto(origin + '/diagnostics/connection'); assert.equal((await api(alien, 'GET', project)).status, 401);
        await api(alien, 'POST', '/api/session', {});
        for (const url of [project, `${project}/versions?limit=1`, `${project}/versions/${a.id}`]) assert.equal((await api(alien, 'GET', url)).status, 404);
        assert.equal((await api(alien, 'POST', `${project}/versions/${a.id}/restore`, {expectedCurrentVersionId: current.id})).status, 404);
      } finally { await stranger.close(); }
      await context.clearCookies(); assert.equal((await api(target, 'GET', project)).status, 401);
      await context.addCookies([{name: 'atoms_session', value: owner.token, domain: '127.0.0.1', path: '/api', httpOnly: true, sameSite: 'Strict'}]);
    });
    await phase('negative-refusal', false, async () => {
      provider.state.mode = 'refusal'; provider.state.stage = 'negative';
      const current = (await api(target, 'GET', project)).body.currentVersion;
      const requestId = randomUUID();
      const response = await context.request.post(origin + project + '/generations', {headers: {origin, accept: 'text/event-stream'}, data: {requestId, baseVersionId: current.id, prompt: 'Explicit negative refusal'}});
      assert.equal(response.status(), 200);
      assert.equal((await api(target, 'GET', project + '/generations/by-request/' + requestId)).body.status, 'failed');
      assert.equal((await api(target, 'GET', project)).body.currentVersion.id, current.id); provider.release();
    });
    await phase('negative-busy-cancel-stale', false, async () => {
      check(); const current = (await api(target, 'GET', project)).body.currentVersion; const requestId = randomUUID();
      provider.state.mode = 'hold'; const before = await count();
      // Separate HTTP connection remains pending while real SDK transport is held.
      const pending = context.request.post(origin + project + '/generations', {headers: {origin, accept: 'text/event-stream'}, data: {requestId, baseVersionId: current.id, prompt: 'Explicit negative cancellation'}, timeout: 15000});
      try {
        const deadline = Date.now() + 10000; while (await count() === before && Date.now() < deadline) { check(); await delay(50); }
        assert.equal(await count(), before + 1); const busy = await restore(template, current); assert.equal(busy.status, 409); assert.equal(busy.body.error.code, 'PROJECT_BUSY');
        const query = await api(target, 'GET', project + '/generations/by-request/' + requestId); assert.equal(query.status, 200);
        assert.ok([200, 202].includes((await api(target, 'POST', project + '/generations/by-request/' + requestId + '/cancel', {})).status));
        provider.release(); const response = await pending; assert.equal(response.status(), 200);
        assert.equal((await api(target, 'GET', project + '/generations/by-request/' + requestId)).body.status, 'cancelled');
        const actual = (await api(target, 'GET', project)).body.currentVersion; assert.equal(actual.id, current.id);
        assert.equal((await restore(template, current)).status, 200);
        const calls = await count(); const stale = await context.request.post(origin + project + '/generations', {headers: {origin, accept: 'text/event-stream'}, data: {requestId: randomUUID(), baseVersionId: current.id, prompt: 'Explicit stale baseline'}});
        assert.equal(stale.status(), 409); assert.equal((await stale.json()).error.code, 'BASE_VERSION_CHANGED'); assert.equal(await count(), calls);
      } finally { provider.release(); await pending.catch(() => {}); }
    });
    await phase('negative-terminal-unknown', false, async () => {
      const current = (await api(target, 'GET', project)).body.currentVersion; const requestId = randomUUID();
      provider.state.mode = 'refusal';
      db.exec("CREATE TRIGGER revision_terminal_failure BEFORE UPDATE OF status ON generation_runs BEGIN SELECT RAISE(ABORT,'EXPLICIT_TERMINAL_FAILURE'); END");
      try {
        const response = await context.request.post(origin + project + '/generations', {headers: {origin, accept: 'text/event-stream'}, data: {requestId, baseVersionId: current.id, prompt: 'Explicit terminal storage failure'}});
        assert.equal(response.status(), 200); assert.match(await response.text(), /unknown/);
        const unknown = await api(target, 'GET', project + '/generations/by-request/' + requestId); assert.equal(unknown.status, 503); assert.equal(unknown.body.error.code, 'RUN_STATE_UNCONFIRMED');
        assert.equal((await api(target, 'GET', project)).body.currentVersion.id, current.id);
        const denied = await restore(a, current); assert.equal(denied.status, 503); assert.equal(denied.body.error.code, 'RUN_STATE_UNCONFIRMED');
      } finally {
        db.exec('DROP TRIGGER revision_terminal_failure'); provider.release();
        const run = db.prepare('SELECT id FROM generation_runs WHERE request_id=?').get(requestId);
        if (run) work(store => store.finishRun({projectId: id, runId: run.id, status: 'interrupted', errorCode: 'PROCESS_RESTARTED'}));
      }
    });
    await phase('negative-response-loss-preview', true, async () => {
      await restart(); await target.goto(origin + '/projects/' + id); await select(target, a.id);
      const match = `**${project}/versions/${a.id}/restore`, query = `**${project}`; let posts = 0, reads = 0;
      await target.route(match, async route => { posts++; const response = await route.fetch(); assert.equal(response.status(), 200); await route.abort('connectionreset'); });
      await target.route(query, route => { reads++; return route.abort('connectionreset'); });
      try {
        await button(target, '恢复此版本').click(); await button(target, '确认恢复此版本').click();
        await target.locator('[data-restore-state="unknown"]').waitFor(); await target.getByRole('alert').filter({hasText: '项目查询失败'}).waitFor();
        assert.equal(posts, 1); assert.equal(reads, 1); assert.equal(await button(target, '恢复此版本').isDisabled(), true);
        await target.unroute(query); await button(target, '查询恢复结果').scrollIntoViewIfNeeded(); await button(target, '查询恢复结果').click();
        await target.locator('[data-restore-state="confirmed"]').waitFor(); assert.equal(posts, 1);
        assert.equal((await api(target, 'GET', project)).body.currentVersion.id, a.id);
      } finally { await target.unroute(match); await target.unroute(query); }
      const broken = work(store => {
        const run = store.createRun({projectId: id, requestId: randomUUID(), baseVersionId: a.id});
        return store.saveCandidate({projectId: id, runId: run.id, snapshot: candidateSnapshot(a.snapshot, 'syntax')}).version;
      });
      await target.reload(); await button(target, '历史').click(); await target.locator(`[data-history-version="${broken.id}"] > button`).click(); await button(target, '预览').click();
      await target.waitForFunction(() => ['compileError', 'runtimeError'].includes(document.querySelector('[data-preview-state]')?.getAttribute('data-preview-state')), undefined, {timeout: 70000});
      assert.equal(await button(target, '恢复此版本').isDisabled(), true);
      assert.equal((await api(target, 'GET', project)).body.currentVersion.id, a.id);
    });
    return {source: 'explicit-negative-fixture', projectId: id, templateVersionId: template.id, seededVersionIds: [a.id, b.id], protectionOnly: true};
  } catch (error) {
    await target.screenshot({path: path.join(path.dirname(database), 'negative-failure.png'), timeout: 2000}).catch(() => {});
    const {writeFile} = await import('node:fs/promises');
    await writeFile(path.join(path.dirname(database), 'negative-failure-state.json'), JSON.stringify({preview: await target.locator('[data-preview-state]').getAttribute('data-preview-state').catch(() => null), viewed: await target.locator('[data-viewed-version]').getAttribute('data-viewed-version').catch(() => null)}), {mode: 0o600});
    throw error;
  } finally { db.close(); await context.close(); }
}
