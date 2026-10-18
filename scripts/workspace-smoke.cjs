/* global document, window, getComputedStyle, requestAnimationFrame */
const { ownChild, signalOwned, closeBrowser, groupAlive: ownedGroupAlive } = require('./verification/processes.cjs');
const { createEvidence } = require('./verification/evidence.cjs');
const evidence = createEvidence('workspace');
const assert = require('node:assert/strict');
const {api,waitCompiled,taskFinished,createViaForm,assertQuote}=require('./verification/workspace-path.cjs');
const { spawn } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const { cp, mkdir, rm, symlink, writeFile, access } = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { createRequire } = require('node:module');
const { setTimeout: delay } = require('node:timers/promises');
const { createServer } = require('node:http');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const runId = randomUUID();
const output = path.join(root, 'test-results/workspace', runId);
const runtime = path.join(output, 'runtime');
const deploy = path.join(runtime, 'deploy/backend');
const browserRepo = path.join(runtime, 'browser-repo');
const database = path.join(runtime, 'data/atoms.sqlite');
const children = new Set();
const report = { runId, suite: 'workspace', source: 'fixture', status: 'running', cases: [], cleanup: 'not-run', realModelCalls: 0, fixtureModelRequests: 0 };
let browser; let interrupted; let logs = ''; let backend; let upstream; let upstreamOrigin; let provider;

function signalGroup(child, signal) { signalOwned(child, signal); }
function groupAlive(child) { return ownedGroupAlive(child); }
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
  children.add(child); ownChild(child);
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
async function startBackend(configured = true) {
  backend = configured ? launch(path.join(root, 'scripts/generation-stream-server.mjs'), [path.join(deploy, 'dist'), database, '3001', upstreamOrigin], deploy) : launch(path.join(deploy, 'dist/server.js'), [], deploy);
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
const quotePath = '/src/generated/WorkspaceQuote.tsx';
function toolResponse(name, input, step) {
  return { id: 'resp_workspace_fixture', object: 'response', created_at: 1_790_000_000, status: 'completed', model: 'gpt-6.1-sol',
    output: [{ type: 'function_call', id: `fc_${step}`, call_id: `call_${step}`, name, arguments: JSON.stringify(input), status: 'completed' }],
    usage: { input_tokens: 12, output_tokens: 7, total_tokens: 19 } };
}
async function setupProvider() {
  const { quoteCode } = await import('./candidate-fixtures.mjs');
  provider = { mode: 'normal', requests: 0, aborts: 0, holds: [], firstHeld: false, quoteCode, revision: 0 };
  upstream = createServer(async (req, res) => {
    try {
      res.on('close', () => { if (!res.writableEnded) provider.aborts++; }); const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString()); provider.requests++; report.fixtureModelRequests++;
      if (provider.observed) provider.observed.push(body);
      const outputs = body.input.filter(item => item.type === 'function_call_output'); const step = outputs.length;
      res.setHeader('content-type', 'application/json');
      if (provider.mode === 'hold' || provider.firstHeld && step === 0) {
        provider.firstHeld = false; await new Promise(resolve => provider.holds.push(resolve));
      }
      if (res.destroyed) return;
      if (provider.mode === 'rate') { res.statusCode = 429; res.end(JSON.stringify({ error: { message: 'PRIVATE_UPSTREAM_SENTINEL', code: 'rate_limit_exceeded' } })); return; }
      if (provider.mode === 'refusal') { res.end(JSON.stringify({ ...toolResponse('',{},0), output: [{ type: 'message', id: 'msg_fixture', role: 'assistant', content: [{ type: 'refusal', refusal: 'PRIVATE_UPSTREAM_SENTINEL' }], status: 'completed' }] })); return; }
      let result;
      if (step === 0) result = toolResponse('list_files',{},step);
      else if (step === 1) {
        const directory = JSON.parse(outputs[0].output);
        result = toolResponse('read_files',{ paths: ['/src/App.tsx', ...(directory.files.some(file => file.path === quotePath) ? [quotePath] : [])] },step);
      } else {
        const read = JSON.parse(outputs.at(-1).output); let app = read.files.find(file => file.path === '/src/App.tsx').content;
        if (!app.includes('import WorkspaceQuote ')) app = "import WorkspaceQuote from './generated/WorkspaceQuote';\n" + app.replace('<Navbar />','<Navbar /><WorkspaceQuote />');
        const code = provider.mode === 'syntax' ? 'export default function Broken(){return <div>UNFINISHED_FIXTURE' :
          quoteCode(5000 + provider.revision * 100) + `\n// revision ${provider.revision} <script>window.workspaceSourceExecuted=true</script> ` + 'long-source-'.repeat(500);
        result = toolResponse('submit_files',{ files: [{ path: '/src/App.tsx', content: app }, { path: quotePath, content: code }] },step);
      }
      res.end(JSON.stringify(result));
    } catch { if (!res.destroyed) { res.statusCode = 500; res.end('{}'); } }
  });
  await new Promise(resolve => upstream.listen(0,'127.0.0.1',resolve)); upstreamOrigin = `http://127.0.0.1:${upstream.address().port}`;
}
function releaseProvider() { if (!provider) return; for (const resolve of provider.holds.splice(0)) resolve(); provider.mode = 'normal'; }
async function mode(name, port) {
  const frontend = launch(path.join(root,'frontend/node_modules/vite/bin/vite.js'),name==='preview'?['preview']:[],path.join(browserRepo,'frontend'));
  await ready(`http://127.0.0.1:${port}`,frontend); const origin=`http://127.0.0.1:${port}`;
  const context = await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'}); const page = await context.newPage();
  const posts = []; let sessions=0;
  page.on('request',request=>{ if(request.method()==='POST') { if(request.url().endsWith('/api/session')) sessions++; if(request.url().endsWith('/generations')) posts.push({url:request.url(),body:request.postDataJSON()}); } });
  let projectId; let adopted;
  try {
    await scenario(`${name}: visible form → real SDK tools → SQLite candidate → actual quote → explicit adoption`,async()=>{
      await page.goto(origin); await page.getByRole('heading',{name:/把你的想法/}).waitFor();
      await page.getByRole('button',{name:'在线报价工具',exact:true}).click();
      const prompt=page.getByRole('textbox',{name:'你想创建什么？',exact:true}); assert.match(await prompt.inputValue(),/报价/);
      assert.equal(provider.requests,0); assert.equal(posts.length,0);
      await page.waitForFunction(()=>document.querySelector('select#template-choice')?.value!=='');
      for(const width of [1280,375,320]) {await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true);await evidence.screenshot(page,{path:path.join(output,`${name}-creation-${width}.png`),fullPage:true,animations:'disabled'});}
      await page.setViewportSize({width:1280,height:900});
      provider.firstHeld=true;
      projectId=await createViaForm(page,`${name} 企业官网报价演示`,(await prompt.inputValue())+`【${name} 主路径】`);
      await page.locator('[data-task-phase="active"]').waitFor();
      await page.getByText('模型请求已发出',{exact:false}).waitFor(); assert.equal(posts.length,1); assert.equal(sessions,1);
      const before=await api(page,'GET',`/api/projects/${projectId}`); assert.equal(before.body.currentVersion.kind,'template');
      assert.equal(before.body.latestRun.status,'running');
      releaseProvider(); await taskFinished(page,/候选已保存/); await waitCompiled(page);
      assert.equal(posts.length,1); assert.equal(provider.requests,3);
      const pending=await api(page,'GET',`/api/projects/${projectId}`); assert.equal(pending.body.currentVersion.id,before.body.currentVersion.id);
      const versionId=pending.body.latestRun.resultVersionId; const result=await api(page,'GET',`/api/projects/${projectId}/versions/${versionId}`);
      assert.deepEqual(result.body.changedFiles,['/src/App.tsx',quotePath]); assert.equal(result.body.adoptionAvailability,'eligible');
      await assertQuote(page);
      const composer=page.getByRole('textbox',{name:'描述下一步需求',exact:true}); await composer.fill('候选尚未采用时不能误用基线');
      assert.equal(await page.getByRole('button',{name:'生成候选',exact:true}).isDisabled(),true);
      await page.getByRole('button',{name:'代码',exact:true}).click(); await page.getByRole('combobox',{name:'选择文件',exact:true}).selectOption(quotePath);
      assert.equal(await page.locator('pre[aria-label="文件源码"] code').textContent(),result.body.version.snapshot.files[quotePath]);
      assert.equal(await page.evaluate(()=>window.workspaceSourceExecuted),undefined); assert.equal(posts.length,1);
      await page.getByRole('button',{name:'预览',exact:true}).click();
      assert.equal(await page.frameLocator('iframe').getByTestId('quote-total').textContent(),'10000','Internal view switching preserves preview inputs');
      await page.getByRole('button',{name:'使用这个版本',exact:true}).click(); await page.locator('[data-adoption-state="confirmed"]').waitFor();
      const current=await api(page,'GET',`/api/projects/${projectId}`); assert.equal(current.body.project.currentVersionId,versionId); assert.equal(digest(current.body.currentVersion.snapshot),digest(result.body.version.snapshot));
      adopted=current.body.currentVersion;
      await page.reload(); await waitCompiled(page); assert.equal(posts.length,1); assert.equal(provider.requests,3);
      const messages=await api(page,'GET',`/api/projects/${projectId}/messages?direction=backward&limit=50`); assert.equal(messages.body.items.length,2);
      assert.equal(await page.locator('[data-message-id]').count(),2); assert.equal(await page.locator('[data-pending-user]').count(),0);
      await evidence.screenshot(page,{path:path.join(output,`${name}-1280.png`),animations:'disabled'});
    });
    await scenario(`${name}: adopted base, IME/newline safety, active view switches and acknowledged cancellation`,async()=>{
      provider.mode='hold'; const composer=page.getByRole('textbox',{name:'描述下一步需求',exact:true});
      await composer.fill(`后续需求 ${name}`); await composer.press('Enter'); assert.match(await composer.inputValue(),/\n$/); assert.equal(posts.length,1);
      await composer.dispatchEvent('compositionstart'); await composer.press('Control+Enter'); await composer.dispatchEvent('compositionend'); assert.equal(posts.length,1);
      await page.getByRole('button',{name:'生成候选',exact:true}).click(); await page.locator('[data-task-phase="active"]').waitFor();
      assert.equal(posts.length,2); assert.equal(posts[1].body.baseVersionId,adopted.id); assert.notEqual(posts[1].body.requestId,posts[0].body.requestId);
      for(const view of ['代码','预览','聊天']) await page.getByRole('button',{name:view,exact:true}).click(); assert.equal(posts.length,2);
      await page.getByRole('button',{name:'取消生成',exact:true}).click(); await taskFinished(page,/cancelled/); releaseProvider();
      const current=await api(page,'GET',`/api/projects/${projectId}`); assert.equal(current.body.project.currentVersionId,adopted.id); assert.equal(current.body.latestRun.status,'cancelled');
      await stop(backend); await startBackend(); await page.reload(); await waitCompiled(page); assert.equal(posts.length,2);
      const restored=await api(page,'GET',`/api/projects/${projectId}`); assert.equal(digest(restored.body.currentVersion.snapshot),digest(adopted.snapshot));
    });
    await scenario(`${name}: responsive source/preview, keyboard focus and long text stay inside the host`,async()=>{
      for(const width of [1280,1024,768,375,320]) {
        await page.setViewportSize({width,height:900}); await page.getByRole('button',{name:'代码',exact:true}).click();
        await page.getByRole('combobox',{name:'选择文件',exact:true}).selectOption(quotePath);
        const bounds=await page.evaluate(()=>({host:document.documentElement.scrollWidth,viewport:window.innerWidth,
          source:(()=>{const pre=document.querySelector('pre[aria-label="文件源码"]');return {scroll:pre.scrollWidth,width:pre.clientWidth,overflow:getComputedStyle(pre).overflowX};})()}));
        assert.ok(bounds.host<=bounds.viewport+1,JSON.stringify(bounds)); assert.ok(bounds.source.scroll>bounds.source.width); assert.equal(bounds.source.overflow,'auto');
        await page.locator('pre[aria-label="文件源码"]').focus(); await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(()=>getComputedStyle(document.activeElement).outlineStyle),'solid');
        await page.getByRole('button',{name:'预览',exact:true}).click(); await waitCompiled(page);
        const frame=page.frameLocator('iframe'); const quantity=frame.getByLabel('页面数量',{exact:true}); await quantity.fill('2'); assert.equal(await frame.getByTestId('quote-total').textContent(),'6000');
        await quantity.fill('1'); assert.equal(await frame.getByTestId('quote-total').textContent(),'5000');
        await frame.locator('body').evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const frameWidth=await page.locator('iframe').evaluate(element=>element.getBoundingClientRect().width); assert.ok(frameWidth>250&&frameWidth<=width);
        await evidence.screenshot(page,{path:path.join(output,`${name}-${width}.png`),animations:'disabled'});
      }
      await page.setViewportSize({width:1280,height:900});
    });
    await scenario(`${name}: lost terminal is recovered by GET without another POST; adoption lost reply is confirmed`,async()=>{
      await page.getByRole('button',{name:'当前版本',exact:true}).click(); provider.revision++;
      let cut=false; const match=`**/api/projects/${projectId}/generations`;
      await page.route(match,async route=>{
        const response=await route.fetch(); const text=await response.text(); assert.match(text,/event: terminal/); cut=true;
        await route.fulfill({response,body:text.slice(0,text.indexOf('event: terminal'))});
      });
      const count=posts.length; await page.getByRole('textbox',{name:'描述下一步需求',exact:true}).fill('断开末帧后查询已保存报价版本');
      await page.getByRole('button',{name:'生成候选',exact:true}).click(); await taskFinished(page,/候选已保存/); assert.equal(cut,true); assert.equal(posts.length,count+1);
      await page.unroute(match); await waitCompiled(page); const pending=await api(page,'GET',`/api/projects/${projectId}`);
      const versionId=pending.body.latestRun.resultVersionId; assert.equal(pending.body.project.currentVersionId,adopted.id);
      const adoptMatch=`**/api/projects/${projectId}/versions/${versionId}/adopt`; let adoptionRequests=0;
      await page.route(adoptMatch,async route=>{adoptionRequests++;const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');});
      await page.getByRole('button',{name:'使用这个版本',exact:true}).click(); await page.locator('[data-adoption-state="confirmed"]').waitFor(); await page.unroute(adoptMatch);
      assert.equal(adoptionRequests,1); const confirmed=await api(page,'GET',`/api/projects/${projectId}`); assert.equal(confirmed.body.project.currentVersionId,versionId); adopted=confirmed.body.currentVersion;
      assert.equal(posts.length,count+1);
    });
    let otherId;
    await scenario(`${name}: creation reply loss stays unknown and refresh reads the actual saved project`,async()=>{
      await page.getByRole('link',{name:'＋ 新建项目',exact:true}).click(); const count=posts.length; const models=provider.requests; let creates=0;
      const match='**/api/projects'; await page.route(match,async route=>{if(route.request().method()!=='POST')return route.continue();creates++;const response=await route.fetch();assert.equal(response.status(),201);otherId=(await response.json()).project.id;await route.abort('failed');});
      await page.getByLabel('项目名称',{exact:false}).fill('长标题'.repeat(38)); await page.getByRole('textbox',{name:'你想创建什么？',exact:true}).fill('创建结果待确认，请保留这条需求');
      // Two native submit events in the same render exercise the synchronous command lock.
      await page.getByRole('button',{name:'创建并生成',exact:true}).dblclick().catch(()=>{});
      await page.locator('[data-create-state="unknown"]').waitFor(); await page.unroute(match);
      assert.equal(creates,1); assert.equal(posts.length,count); assert.equal(provider.requests,models); assert.equal(page.url(),origin+'/');
      assert.equal(await page.getByRole('textbox',{name:'你想创建什么？',exact:true}).inputValue(),'创建结果待确认，请保留这条需求');
      await page.getByRole('button',{name:'刷新项目列表',exact:true}).click(); await page.locator(`nav a[href="/projects/${otherId}"]`).waitFor();
      await page.locator(`nav a[href="/projects/${otherId}"]`).click(); await page.getByRole('textbox',{name:'描述下一步需求',exact:true}).waitFor();
      assert.equal(posts.length,count); assert.equal(provider.requests,models);
      await page.setViewportSize({width:320,height:900}); assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true); await page.setViewportSize({width:1280,height:900});
    });
    await scenario(`${name}: project drafts, history/new tab and late callbacks are isolated; leaving cancels the original stream`,async()=>{
      const composer=()=>page.getByRole('textbox',{name:'描述下一步需求',exact:true}); await composer().fill('B 草稿');
      await page.locator(`nav a[href="/projects/${projectId}"]`).click(); await composer().waitFor(); await composer().fill('A 草稿');
      await page.goBack(); await composer().waitFor(); assert.equal(await composer().inputValue(),'B 草稿'); await page.goForward(); await composer().waitFor(); assert.equal(await composer().inputValue(),'A 草稿');
      const newTab=await context.newPage(); await newTab.goto(`${origin}/projects/${otherId}`); await newTab.getByRole('textbox',{name:'描述下一步需求',exact:true}).waitFor(); assert.equal(await newTab.getByRole('textbox',{name:'描述下一步需求',exact:true}).inputValue(),''); await newTab.close();
      provider.mode='hold'; const count=posts.length; await page.getByRole('button',{name:'生成候选',exact:true}).click(); await page.locator('[data-task-phase="active"]').waitFor();
      await page.locator(`nav a[href="/projects/${otherId}"]`).click(); await composer().waitFor(); assert.equal(await composer().inputValue(),'B 草稿');
      await page.locator('[data-viewed-version]').waitFor(); assert.equal(await page.locator('[data-task-phase]').count(),0); releaseProvider();
      const deadline=Date.now()+10_000; let state;
      do {state=await api(page,'GET',`/api/projects/${projectId}`);if(state.body.latestRun.status!=='running')break;await delay(50);} while(Date.now()<deadline);
      assert.equal(state.body.latestRun.status,'cancelled'); assert.equal(posts.length,count+1);
      assert.equal(await page.locator('[data-task-phase]').count(),0); assert.equal(await composer().inputValue(),'B 草稿');
      await page.goto(`${origin}/unknown-workspace-route`); await page.getByRole('heading',{name:'页面不存在',exact:true}).waitFor();
    });
    await scenario(`${name}: latest/earlier persisted messages merge in order and preserve the reading anchor`,async()=>{
      // Seed only historical records, with the owned backend stopped. The new-generation path above uses visible controls throughout.
      await stop(backend); const requireBackend=createRequire(path.join(root,'backend/package.json')); const Database=requireBackend('better-sqlite3'); const db=new Database(database);
      try { const insert=db.prepare('INSERT INTO messages(id,project_id,sequence,role,content,run_id,created_at) VALUES(?,?,?,?,?,NULL,?)');
        db.transaction(()=>{for(let sequence=1;sequence<=73;sequence++)insert.run(randomUUID(),otherId,sequence,sequence%2?'user':'assistant',`历史消息 ${sequence} · ${'阅读位置验证。'.repeat(8)}`,new Date().toISOString());})();
      } finally {db.close();} await startBackend();
      await page.goto(`${origin}/projects/${otherId}`); await page.locator('[data-message-sequence="24"]').waitFor(); assert.equal(await page.locator('[data-message-id]').count(),50);
      const messages=page.getByRole('region',{name:'对话',exact:true}).locator('> div').first();
      await messages.evaluate(element=>{element.scrollTop=0;}); const anchor=page.locator('[data-message-sequence="24"]'); const y=(await anchor.boundingBox()).y;
      await page.getByRole('button',{name:'加载更早消息',exact:true}).click(); await page.locator('[data-message-sequence="1"]').waitFor();
      await page.waitForFunction(()=>document.querySelectorAll('[data-message-id]').length===73); await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.ok(Math.abs((await anchor.boundingBox()).y-y)<3,'Loading older messages preserves the previously visible message');
      assert.deepEqual(await page.locator('[data-message-sequence]').evaluateAll(elements=>elements.map(element=>Number(element.dataset.messageSequence))),Array.from({length:73},(_,i)=>i+1));
      const scroll=await messages.evaluate(element=>element.scrollTop); await page.locator(`nav a[href="/projects/${projectId}"]`).click(); await page.getByRole('textbox',{name:'描述下一步需求',exact:true}).waitFor();
      await page.locator(`nav a[href="/projects/${otherId}"]`).click(); await page.locator('[data-message-id]').first().waitFor();
      const restored=await messages.evaluate(element=>element.scrollTop); assert.ok(Math.abs(restored-scroll)<3,JSON.stringify({scroll,restored,messages:await page.locator('[data-message-id]').count()}));
    });
    await scenario(`${name}: upstream rate/refusal failures retain actual user messages and never invent an assistant answer`,async()=>{
      for(const failure of ['rate','refusal']) {
        provider.mode=failure; const count=posts.length; await page.getByRole('textbox',{name:'描述下一步需求',exact:true}).fill(`受控上游失败 ${failure}`);
        await page.getByRole('button',{name:'生成候选',exact:true}).click(); await taskFinished(page,/failed/);
        const detail=await api(page,'GET',`/api/projects/${otherId}`); assert.equal(detail.body.latestRun.status,'failed'); assert.equal(detail.body.currentVersion.kind,'template');
        const messages=await api(page,'GET',`/api/projects/${otherId}/messages?direction=backward&limit=50`); assert.equal(messages.body.items.at(-1).role,'user');
        assert.ok(!(await page.locator('main').textContent()).includes('PRIVATE_UPSTREAM_SENTINEL')); assert.equal(posts.length,count+1);
      } releaseProvider();
    });
    await scenario(`${name}: real compile error blocks adoption and current/source selection keeps its own files`,async()=>{
      provider.mode='syntax'; await page.getByRole('textbox',{name:'描述下一步需求',exact:true}).fill('生成一个有真实语法错误的受控候选');
      await page.getByRole('button',{name:'生成候选',exact:true}).click(); await taskFinished(page,/候选已保存/);
      await page.waitForFunction(()=>['compileError','runtimeError'].includes(document.querySelector('[data-preview-state]')?.getAttribute('data-preview-state')),undefined,{timeout:70_000});
      assert.equal(await page.getByRole('button',{name:'使用这个版本',exact:true}).isDisabled(),true);
      const detail=await api(page,'GET',`/api/projects/${otherId}`); assert.equal(detail.body.currentVersion.kind,'template');
      await page.getByRole('button',{name:'代码',exact:true}).click(); await page.getByRole('combobox',{name:'选择文件',exact:true}).selectOption(quotePath); assert.match(await page.locator('pre[aria-label="文件源码"]').textContent(),/UNFINISHED_FIXTURE/);
      await page.getByRole('button',{name:'当前版本',exact:true}).click(); assert.equal(await page.locator(`select option[value="${quotePath}"]`).count(),0);
      assert.equal(await page.locator('[data-viewed-version]').getAttribute('data-viewed-version'),detail.body.currentVersion.id);
      await page.getByRole('button',{name:'预览',exact:true}).click(); await waitCompiled(page); await page.getByRole('textbox',{name:'描述下一步需求',exact:true}).fill('查看当前版本后可以明确提交新需求'); assert.equal(await page.getByRole('button',{name:'生成候选',exact:true}).isDisabled(),false); releaseProvider();
    });
    await scenario(`${name}: late creation after navigation never starts generation or forces navigation`,async()=>{
      await page.getByRole('link',{name:'＋ 新建项目',exact:true}).click(); let release; const gate=new Promise(resolve=>{release=resolve;}); let saved=false;
      const match='**/api/projects'; await page.route(match,async route=>{if(route.request().method()!=='POST')return route.continue();const response=await route.fetch();saved=true;await gate;await route.fulfill({response});});
      const count=posts.length; const models=provider.requests; await page.getByRole('textbox',{name:'你想创建什么？',exact:true}).fill('离页后不得自动发起模型');
      await page.getByRole('button',{name:'创建并生成',exact:true}).click(); await page.waitForFunction(()=>document.querySelector('button[type="submit"]')?.disabled);
      const deadline=Date.now()+10_000; while(!saved&&Date.now()<deadline)await delay(10); assert.equal(saved,true);
      await page.getByRole('link',{name:'连接诊断',exact:true}).click(); await page.getByRole('button',{name:'检查后端连接',exact:true}).waitFor(); release(); await page.unroute(match,{behavior:'wait'});
      assert.equal(page.url(),`${origin}/diagnostics/connection`); assert.equal(posts.length,count); assert.equal(provider.requests,models);
    });
    await scenario(`${name}: unconfigured model preserves the created project and prompt with zero upstream requests`,async()=>{
      await stop(backend); await startBackend(false); await page.goto(origin); const count=posts.length; const models=provider.requests;
      const id=await createViaForm(page,'未配置模型仍保留项目','未配置模型的原始需求'); await taskFinished(page,/项目已创建.*生成未受理/);
      assert.equal(await page.getByRole('textbox',{name:'描述下一步需求',exact:true}).inputValue(),'未配置模型的原始需求');
      const detail=await api(page,'GET',`/api/projects/${id}`); assert.equal(detail.body.currentVersion.kind,'template'); assert.equal(detail.body.latestRun,null); assert.equal(provider.requests,models); assert.equal(posts.length,count+1);
      await stop(backend); await startBackend();
    });
    await scenario(`${name}: restored A → GET confirmation → explicit continuation → frozen SDK files → branch preview/adoption → restart`,async()=>{
      await page.goto(`${origin}/projects/${projectId}`); await page.locator('[data-input-base]').waitFor();
      const b=adopted; const a=(await api(page,'GET',`/api/projects/${projectId}/versions/${b.parentVersionId}`)).body;
      assert.notEqual(a.version.snapshot.files[quotePath],b.snapshot.files[quotePath]);
      const history=(await api(page,'GET',`/api/projects/${projectId}/versions?limit=50`)).body;
      const oldVersions=await Promise.all(history.items.map(async item=>(await api(page,'GET',`/api/projects/${projectId}/versions/${item.id}`)).body.version));
      const oldMessages=(await api(page,'GET',`/api/projects/${projectId}/messages?direction=backward&limit=50`)).body.items;
      const count=posts.length; const models=provider.requests; let restorePosts=0; let blockedReads=0;
      const stale=await context.newPage(); const stalePosts=[];
      stale.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/generations'))stalePosts.push(request.postDataJSON());});
      const projectMatch=`**/api/projects/${projectId}`; const restoreMatch=`**/api/projects/${projectId}/versions/${a.version.id}/restore`;
      try {
        await stale.goto(`${origin}/projects/${projectId}`); await stale.locator(`[data-input-base="${b.id}"]`).waitFor();
        await stale.getByRole('textbox',{name:'描述下一步需求',exact:true}).fill(`${name} stale B draft must survive`);
        await page.getByRole('button',{name:'历史',exact:true}).click();
        await page.locator(`[data-history-version="${a.version.id}"] > button`).click();
        await page.getByRole('button',{name:'预览',exact:true}).click(); await waitCompiled(page);
        await page.getByRole('button',{name:'恢复此版本',exact:true}).click();
        await page.route(restoreMatch,async route=>{restorePosts++;assert.deepEqual(route.request().postDataJSON(),{expectedCurrentVersionId:b.id});const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');});
        await page.route(projectMatch,async route=>{if(route.request().method()==='GET'){blockedReads++;await route.abort('failed');}else await route.continue();});
        await page.getByRole('button',{name:'确认恢复此版本',exact:true}).click();
        await page.locator('[data-restore-state="unknown"]').waitFor();
        await page.getByRole('button',{name:'查询恢复结果',exact:true}).waitFor({state:'visible'});
        await page.getByRole('button',{name:'聊天',exact:true}).click();
        await page.getByRole('textbox',{name:'描述下一步需求',exact:true}).fill(`${name} restored A continuation`);
        assert.equal(await page.getByRole('button',{name:'生成候选',exact:true}).isDisabled(),true);
        assert.equal(posts.length,count); assert.equal(provider.requests,models);
        await page.getByRole('alert').filter({hasText:'项目查询失败'}).waitFor();
        await page.unroute(projectMatch);
        await page.bringToFront();
        // Let the iframe compositor catch up with the host pane's scroll before clicking.
        await page.getByRole('button',{name:'查询恢复结果',exact:true}).scrollIntoViewIfNeeded();
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        await scenario(`${name}: unknown restore manual GET confirms without another write or SDK call`,async()=>{
          const [response]=await Promise.all([
            page.waitForResponse(response=>response.url()===`${origin}/api/projects/${projectId}`&&response.request().method()==='GET'),
            page.getByRole('button',{name:'查询恢复结果',exact:true}).click(),
          ]);
          assert.equal(response.status(),200);
          await page.locator('[data-restore-state="confirmed"]').waitFor(); await page.locator(`[data-input-base="${a.version.id}"]`).waitFor();
          assert.equal(restorePosts,1); assert.equal(posts.length,count); assert.equal(provider.requests,models);
        });
        assert.ok(blockedReads>0); assert.equal(restorePosts,1);
        const restored=(await api(page,'GET',`/api/projects/${projectId}`)).body;
        assert.equal(restored.project.currentVersionId,a.version.id); assert.deepEqual(restored.currentVersion,a.version);
        await page.unroute(restoreMatch);
        await stale.getByRole('button',{name:'生成候选',exact:true}).click(); await taskFinished(stale,/生成未受理/);
        assert.equal(stalePosts.length,1); assert.equal(stalePosts[0].baseVersionId,b.id); assert.equal(provider.requests,models);
        assert.equal(await stale.getByRole('textbox',{name:'描述下一步需求',exact:true}).inputValue(),`${name} stale B draft must survive`);
        await stale.getByRole('button',{name:'刷新版本状态',exact:true}).scrollIntoViewIfNeeded();
        await stale.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        await stale.getByRole('button',{name:'刷新版本状态',exact:true}).click(); await stale.locator(`[data-input-base="${a.version.id}"]`).waitFor();
        assert.equal(stalePosts.length,1); assert.equal(provider.requests,models);
        await page.reload(); await page.getByRole('button',{name:'当前版本',exact:true}).click(); await waitCompiled(page);
        assert.equal(posts.length,count); assert.equal(provider.requests,models);
        const prompt=`${name} restored A continuation`; provider.observed=[]; provider.revision++;
        await page.getByRole('textbox',{name:'描述下一步需求',exact:true}).fill(prompt);
        await page.getByRole('button',{name:'生成候选',exact:true}).click(); await taskFinished(page,/候选已保存/);
        assert.equal(posts.length,count+1); assert.equal(posts.at(-1).body.baseVersionId,a.version.id);
        assert.ok(posts.slice(0,-1).every(post=>post.body.requestId!==posts.at(-1).body.requestId));
        assert.equal(provider.requests,models+3); assert.equal(provider.observed.length,3);
        const initial=provider.observed[0].input; const text=item=>typeof item.content==='string'?item.content:(item.content??[]).map(part=>part.text??'').join('');
        const contents=initial.map(text); const eligible=oldMessages.filter(message=>message.runId===a.successfulRun.id);
        assert.equal(eligible.length,2); for(const message of eligible)assert.equal(contents.filter(content=>content===message.content).length,1);
        for(const message of oldMessages.filter(message=>message.runId!==a.successfulRun.id&&message.role==='user'))assert.equal(contents.includes(message.content),false);
        assert.equal(contents.filter(content=>content===prompt).length,1);
        const tools=provider.observed[2].input.filter(item=>item.type==='function_call_output');
        const read=JSON.parse(tools.at(-1).output); assert.equal(read.files.length,2);
        for(const file of read.files)assert.equal(file.content,a.version.snapshot.files[file.path]);
        const pending=(await api(page,'GET',`/api/projects/${projectId}`)).body;
        const candidate=(await api(page,'GET',`/api/projects/${projectId}/versions/${pending.latestRun.resultVersionId}`)).body.version;
        assert.equal(candidate.parentVersionId,a.version.id); assert.equal(candidate.sequence,Math.max(...oldVersions.map(version=>version.sequence))+1);
        const status=(await api(page,'GET',`/api/projects/${projectId}/generations/by-request/${posts.at(-1).body.requestId}`)).body;
        assert.equal(status.candidateVersionId,candidate.id); assert.equal(status.previewStatus,'unverified'); assert.equal(pending.project.currentVersionId,a.version.id);
        await page.getByRole('button',{name:'预览',exact:true}).click(); await waitCompiled(page); await assertQuote(page,5000+provider.revision*100);
        assert.equal((await api(page,'GET',`/api/projects/${projectId}`)).body.project.currentVersionId,a.version.id);
        await page.getByRole('button',{name:'使用这个版本',exact:true}).click(); await page.locator('[data-adoption-state="confirmed"]').waitFor();
        await stop(backend); await startBackend(); await page.reload(); await waitCompiled(page);
        const reopened=(await api(page,'GET',`/api/projects/${projectId}`)).body;
        assert.equal(reopened.project.currentVersionId,candidate.id); assert.deepEqual(reopened.currentVersion,candidate);
        for(const version of oldVersions)assert.deepEqual((await api(page,'GET',`/api/projects/${projectId}/versions/${version.id}`)).body.version,version);
        const messages=(await api(page,'GET',`/api/projects/${projectId}/messages?direction=backward&limit=50`)).body.items;
        assert.deepEqual(messages.slice(0,oldMessages.length),oldMessages); assert.equal(messages.length,oldMessages.length+2);
        assert.equal(posts.length,count+1); assert.equal(provider.requests,models+3);
        report.restoredContinuation??=[]; report.restoredContinuation.push({mode:name,projectId,restoredVersionId:a.version.id,previousVersionId:b.id,candidateVersionId:candidate.id,
          restorePosts,blockedConfirmationReads:blockedReads,staleGenerationPosts:stalePosts.length,staleSdkRequests:0,automaticGenerationPosts:0,continuationSdkRequests:provider.observed.length,
          firstSdkInput:{items:initial.length,bodyBytes:Buffer.byteLength(JSON.stringify(initial)),digest:digest(initial),eligibleHistoryMessages:eligible.length,currentPromptOccurrences:contents.filter(content=>content===prompt).length},
          toolOutputs:tools.length,readFiles:read.files.map(file=>({path:file.path,bodyBytes:Buffer.byteLength(file.content),digest:digest(file.content)})),parentVersionId:candidate.parentVersionId,sequence:candidate.sequence,previousMaxSequence:Math.max(...oldVersions.map(version=>version.sequence)),oldVersionsUnchanged:oldVersions.length,oldMessagesUnchanged:oldMessages.length});
        adopted=candidate; await evidence.screenshot(page,{path:path.join(output,`${name}-restored-continuation.png`),animations:'disabled'});
      } finally {provider.observed=undefined;await page.unroute(projectMatch);await page.unroute(restoreMatch);await stale.close();}
    });
    await scenario(`${name}: A/B ownership and expired session stop private display without silently creating a session`,async()=>{
      const stranger=await browser.newContext();const alien=await stranger.newPage();await alien.goto(`${origin}/projects/${projectId}`); await alien.getByRole('alert').filter({hasText:'会话'}).waitFor();
      await alien.locator('aside a[href="/"]').first().click();await alien.getByRole('button',{name:'重新开始会话',exact:true}).click();await alien.waitForFunction(()=>document.querySelector('select#template-choice')?.value!=='');
      const foreign=await api(alien,'GET',`/api/projects/${projectId}`);assert.equal(foreign.status,404);await stranger.close();
      const sessionCount=sessions; await context.clearCookies(); await page.reload(); await page.getByRole('alert').filter({hasText:'会话'}).waitFor();
      assert.equal(await page.locator('iframe').count(),0); assert.equal(await page.locator('[data-message-id]').count(),0); assert.equal(sessions,sessionCount);
      await page.locator('aside a[href="/"]').first().click();
      let releaseSession; const sessionGate=new Promise(resolve=>{releaseSession=resolve;}); let sessionReceived; const sessionResponse=new Promise(resolve=>{sessionReceived=resolve;});
      const sessionMatch='**/api/session'; await page.route(sessionMatch,async route=>{const response=await route.fetch();sessionReceived();await sessionGate;await route.fulfill({response});});
      let createRequests=0;const recordCreate=request=>{if(request.method()==='POST'&&request.url().endsWith('/api/projects'))createRequests++;};page.on('request',recordCreate);
      await page.getByRole('button',{name:'重新开始会话',exact:true}).click(); let sessionTimer;
      try{await Promise.race([sessionResponse,new Promise((_,reject)=>{sessionTimer=setTimeout(()=>reject(Error('Session fixture did not receive a response')),10_000);})]);}finally{clearTimeout(sessionTimer);}
      const recoveringPrompt=page.getByRole('textbox',{name:'你想创建什么？',exact:true});await recoveringPrompt.fill('会话确认前快捷键不能创建');
      assert.equal(await page.getByRole('button',{name:'创建并生成',exact:true}).isDisabled(),true);await recoveringPrompt.press('Control+Enter');assert.equal(createRequests,0);assert.equal(page.url(),origin+'/');
      releaseSession();await page.unroute(sessionMatch);await page.locator('button[type="submit"]:not(:disabled)').waitFor();page.off('request',recordCreate);await recoveringPrompt.fill('');
      await page.waitForFunction(()=>document.querySelector('select#template-choice')?.value!==''); assert.equal(sessions,sessionCount+1);assert.equal(await page.locator(`nav a[href="/projects/${projectId}"]`).count(),0);
    });
    await scenario(`${name}: 320px visible keyboard creation, quote interaction and explicit adoption complete end to end`,async()=>{
      await page.setViewportSize({width:320,height:900}); const count=posts.length; const requests=provider.requests;
      await page.getByLabel('项目名称',{exact:false}).fill('手机报价演示'); const prompt=page.getByRole('textbox',{name:'你想创建什么？',exact:true}); await prompt.fill('添加一个可操作的报价控件，保留企业官网。');
      await page.locator('button[type="submit"]:not(:disabled)').waitFor();
      await prompt.press('Control+Enter'); await page.waitForURL(/\/projects\/[a-f0-9-]+$/); await taskFinished(page,/候选已保存/);
      await page.getByRole('button',{name:'预览',exact:true}).click(); await waitCompiled(page);
      const frame=page.frameLocator('iframe'); await frame.getByLabel('页面数量',{exact:true}).fill('2'); assert.equal(await frame.getByTestId('quote-total').textContent(),String(6000+provider.revision*100));
      await page.getByRole('button',{name:'使用这个版本',exact:true}).click(); await page.locator('[data-adoption-state="confirmed"]').waitFor();
      assert.equal(posts.length,count+1); assert.equal(provider.requests,requests+3); const id=page.url().split('/').at(-1); const saved=await api(page,'GET',`/api/projects/${id}`); assert.equal(saved.body.project.currentVersionId,saved.body.latestRun.resultVersionId);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true); await frame.locator('body').evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await evidence.screenshot(page,{path:path.join(output,`${name}-mobile-adopted.png`),animations:'disabled'});
      await page.getByRole('button',{name:'聊天',exact:true}).click(); await page.getByRole('textbox',{name:'描述下一步需求',exact:true}).waitFor();
      await page.getByRole('button',{name:'项目导航',exact:true}).click(); await page.locator(`nav a[href="/projects/${id}"]`).waitFor();
    });
  } catch(error) { await evidence.screenshot(page,{path:path.join(output,`${name}-failure.png`),fullPage:true}).catch(()=>{}); throw error; }
  finally { await context.close(); await stop(frontend); }
}
async function main() {
  await mkdir(output,{recursive:true}); for(const port of [3001,5173,4173]) await portFree(port);
  await setup(); await setupProvider(); await startBackend(); browser=await chromium.launch({channel:'chrome',headless:true,handleSIGINT:false,handleSIGTERM:false});
  await mode('dev',5173); await stop(backend); provider.requests=0; provider.revision=0; await startBackend(); await mode('preview',4173); report.status='passed';
}
main().catch(error=>{report.status=interrupted?'cancelled':'failed';report.error=error.message;console.error(error.stack);process.exitCode=interrupted==='SIGINT'?130:interrupted?143:1;})
 .finally(async()=>{releaseProvider();const results=await Promise.allSettled([closeBrowser(browser),...[...children].map(stop)]);upstream?.closeAllConnections();if(upstream?.listening)await new Promise(resolve=>upstream.close(resolve));
  if(results.some(result=>result.status==='rejected')){report.cleanup='failed';process.exitCode=1;}else{report.cleanup='passed';await rm(runtime,{recursive:true,force:true});}
  void logs;await mkdir(output,{recursive:true});await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});evidence.finish(report);
console.log(`Workspace report: ${path.relative(root,path.join(output,'report.json'))}`);
 });
