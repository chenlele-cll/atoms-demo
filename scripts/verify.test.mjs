import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { plan, profiles, requiredScripts } from './verification/registry.mjs';
import { acquireRunLock, allowedInput, assertInputs, atomicJson, buildIdentity, cleanEnvironment, copyInputs, freePorts, manifest } from './verification/input.mjs';
import { schedule } from './verification/scheduler.mjs';
import { guardFetch } from './verification/network-guard.mjs';
import { parseArgs, prerequisiteResult, prerequisites, publicSummary, verify } from './verify.mjs';
import processes from './verification/processes.cjs';
import evidence from './verification/evidence.cjs';
const exec = promisify(execFile); const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(root, 'scripts/verify.mjs');
async function fixture(t) {
  const folder = await mkdtemp(path.join(tmpdir(), 'atoms verification control ')); t.after(() => rm(folder, { recursive: true, force: true }));
  await exec('git', ['init', '-q', folder]);
  const put = async (name, value) => { const p = path.join(folder, name); await mkdir(path.dirname(p), { recursive: true }); await writeFile(p, value); };
  await put('package.json', JSON.stringify({ name: 'explicit-control-fixture', private: true }));
  await put('.gitignore', 'node_modules/\n.env\ndata/\n!templates/*/src/data/\n'); await put('frontend/src/app.ts', 'export const explicitFixture=1;');
  return { folder, put };
}
const step = id => ({ id, selected: true, owner: 'GEN-008-control-test', coverage: ['scheduler-control'], timeoutMs: 1000 });
const runNode = (code, options = {}) => processes.runCommand({ command: process.execPath, args: ['-e', code], cwd: root, env: cleanEnvironment(), timeoutMs: 1000, cleanupMs: 3000, graceMs: 100, ...options });
const controlOptions = { evidenceKind: 'control-test' };

test('fixed product/full plans select required owners, one check/build, no nesting or live entry', () => {
  for (const profile of ['product', 'full']) {
    const steps = plan(profile); const selected = steps.filter(item => item.selected);
    assert.equal(selected.filter(item => item.id === 'build').length, 1); assert.equal(selected.filter(item => item.id === 'check').length, 1);
    assert.ok(selected.findIndex(item => item.id === 'check') < selected.findIndex(item => item.id === 'build'));
    assert.ok(selected.findIndex(item => item.id === 'build') < selected.findIndex(item => item.id === 'workspace'));
    assert.ok(!JSON.stringify(selected).match(/model:probe|generation:smoke|verify:product|--live/));
    for (const id of ['install', 'native', 'check', 'template-prepare', 'infra', 'build', 'smoke', 'workspace', 'openspec']) assert.ok(selected.some(item => item.id === id));
    for (const item of steps.filter(item => item.fullOnly)) assert.equal(item.selected, profile === 'full');
  }
  assert.equal(profiles.product, 1_200_000); assert.equal(profiles.full, 2_400_000); assert.throws(() => plan('skip'), /INVALID_PROFILE/);
});
test('CLI help and invalid profile never start acceptance; missing scripts are precondition failures', async t => {
  assert.deepEqual(parseArgs([]), { help: true }); assert.deepEqual(parseArgs(['--help']), { help: true });
  assert.throws(() => parseArgs(['--profile', 'full', '--skip', 'check']));
  const help = await exec(process.execPath, [cli, '--help'], { env: cleanEnvironment() }); assert.match(help.stdout, /20 min/);
  await assert.rejects(exec(process.execPath, [cli, '--profile', 'bad'], { env: cleanEnvironment() }), error => error.code === 2 && !error.stdout.includes('[product]'));
  const f = await fixture(t); await assert.rejects(prerequisites(f.folder, 'product'), /MISSING_SCRIPT/);
});
test('preflight commands honor the same cancellation signal before starting Chrome', async () => {
  const controller=new AbortController();controller.abort();await assert.rejects(prerequisites(root,'product',controller.signal),error=>error.name==='AbortError');
});
test('missing tool binaries are classified as a blocked toolchain precondition', async () => {
  const saved=process.env.PATH;process.env.PATH='/explicit-missing-tool-control';
  try{await assert.rejects(prerequisites(root,'product'),/TOOLCHAIN/);}finally{if(saved===undefined)delete process.env.PATH;else process.env.PATH=saved;}
});
test('actual Git-visible uncommitted inputs are copied while secrets, generated state and dependencies stay excluded', async t => {
  const f = await fixture(t);
  await f.put('backend/.env', 'PRIVATE_ENV_SENTINEL'); await f.put('backend/.env.example', 'MODEL_ID=example'); await f.put('backend/data/a.sqlite', 'PRIVATE_DB_SENTINEL');
  await f.put('frontend/node_modules/private.js', 'PRIVATE_NODE_SENTINEL'); await f.put('docs/product/assignment.md', 'PRIVATE_ASSIGNMENT_SENTINEL');
  await f.put('scripts/untracked.mjs', 'export const current="uncommitted";');
  await f.put('templates/brand-store/src/data/products.ts', 'export const products=[];');
  await exec('git', ['add', 'frontend/src/app.ts'], { cwd: f.folder }); await f.put('frontend/src/app.ts', 'export const explicitFixture=2;');
  const before = await readFile(path.join(f.folder, 'frontend/src/app.ts')); const target = path.join(f.folder, 'copy');
  const record = await copyInputs(f.folder, target); assert.ok(record.entries.some(item => item.path === 'scripts/untracked.mjs'));
  assert.deepEqual(await readFile(path.join(target, 'frontend/src/app.ts')), before); assert.deepEqual(await readFile(path.join(f.folder, 'frontend/src/app.ts')), before);
  assert.ok(!(JSON.stringify(record).match(/PRIVATE_|\.env"|sqlite|assignment|node_modules/)));
  await access(path.join(target, 'backend/.env.example')); await assert.rejects(access(path.join(target, 'backend/.env')));
  assert.equal(await readFile(path.join(target, 'templates/brand-store/src/data/products.ts'), 'utf8'), 'export const products=[];');
  await exec('git', ['init', '-q', target]);
  await exec('git', ['add', '--all'], { cwd: target });
  assert.ok((await manifest(target)).entries.some(entry => entry.path === 'templates/brand-store/src/data/products.ts'));
  for (const name of ['backend/data/private.json', 'templates/brand-store/data/private.json', 'templates/brand-store/src/data/private.sqlite', 'templates/brand-store/src/data/.env']) assert.equal(allowedInput(name), false);
  for (const name of ['../private', '/tmp/private', 'backend/.env.production', 'frontend/dist/a.js', 'backend/src/template-assets/bundle.json', 'packages/contracts/.build-a/tmp.js']) assert.equal(allowedInput(name), false);
});
test('input symlink escape and mutation during copy are rejected; an internal public-file link is dereferenced', async t => {
  const f = await fixture(t); const outside = path.join(f.folder, 'private-file'); await writeFile(outside, 'PRIVATE_SENTINEL');
  await symlink(outside, path.join(f.folder, 'frontend/src/outside.ts')); await assert.rejects(copyInputs(f.folder, path.join(f.folder, 'bad')), /UNSAFE_INPUT/); await rm(path.join(f.folder, 'frontend/src/outside.ts'));
  await symlink('app.ts', path.join(f.folder, 'frontend/src/link.ts')); const dest = path.join(f.folder, 'inside'); await copyInputs(f.folder, dest); assert.equal((await lstat(path.join(dest, 'frontend/src/link.ts'))).isSymbolicLink(), false);
  await assert.rejects(copyInputs(f.folder, path.join(f.folder, 'changing'), { afterCopy: () => f.put('frontend/src/app.ts', 'changed during copy') }), /STALE_INPUT/);
  const other=await fixture(t); await symlink(path.join(other.folder,'package.json'),path.join(f.folder,'frontend/src/escape.ts')); await assert.rejects(manifest(f.folder),/UNSAFE_INPUT/);
});
test('environment whitelist removes credentials, real config, inherited Node options and proxy values', () => {
  const env = cleanEnvironment({ PATH: '/normal/path', HOME: '/normal/home', TMPDIR: '/normal/tmp', OPENAI_API_KEY: 'PRIVATE_KEY_SENTINEL', MODEL_ID: 'private-model', DATABASE_PATH: '/private/db', API_PROXY_TARGET: 'https://private', NODE_OPTIONS: '--require private', HTTP_PROXY: 'private' });
  assert.equal(env.HOME, '/normal/home'); assert.equal(env.TMPDIR, '/normal/tmp'); assert.ok(!JSON.stringify(env).includes('PRIVATE_')); assert.equal(env.NODE_OPTIONS, undefined);
  for (const id of ['install', 'native']) { const result = prerequisiteResult({ id, prerequisite: true, native: id === 'native' }, { status: 'failed', reason: 'COMMAND_FAILED' }); assert.equal(result.status, 'blocked'); assert.equal(result.reason, id === 'native' ? 'NATIVE_BINDING' : 'OFFLINE_INSTALL'); }
});
test('offline install with an empty store and a missing native binary fail through real subprocesses', async t => {
  const f = await fixture(t);
  await f.put('package.json', JSON.stringify({name:'explicit-offline-control',private:true,dependencies:{'is-number':'7.0.0'}}));
  await f.put('pnpm-lock.yaml', "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .:\n    dependencies:\n      is-number:\n        specifier: 7.0.0\n        version: 7.0.0\npackages:\n  is-number@7.0.0:\n    resolution: {integrity: sha512-AAAA}\nsnapshots:\n  is-number@7.0.0: {}\n");
  const install=await processes.runCommand({command:'pnpm',args:['install','--offline','--frozen-lockfile','--store-dir',path.join(f.folder,'empty-store')],cwd:f.folder,env:cleanEnvironment(),timeoutMs:10_000});
  assert.equal(install.status,'failed'); assert.equal(prerequisiteResult({id:'install',prerequisite:true},install).reason,'OFFLINE_INSTALL');
  const native=await runNode(`process.dlopen({exports:{}},${JSON.stringify(path.join(f.folder,'missing-native.node'))})`);
  assert.equal(native.status,'failed'); assert.equal(prerequisiteResult({id:'native',native:true,prerequisite:true},native).reason,'NATIVE_BINDING');
});
test('build fingerprints detect modified output and reject symlinks rather than accepting a previous build', async t => {
  const f = await fixture(t); for (const dir of ['frontend/dist', 'backend/dist', 'packages/contracts/dist']) await f.put(dir + '/index.js', 'explicit build');
  const before = await buildIdentity(f.folder); await f.put('frontend/dist/index.js', 'corrupt build'); assert.notEqual((await buildIdentity(f.folder)).digest, before.digest);
  await symlink(path.join(f.folder, 'package.json'), path.join(f.folder, 'backend/dist/link.json')); await assert.rejects(buildIdentity(f.folder), /UNSAFE_PATH/);
});
test('mutated or newly added source inside the isolated copy is also stale, even when original source is unchanged', async t => {
  const f=await fixture(t);const copy=path.join(f.folder,'isolated');const snapshot=await copyInputs(f.folder,copy);await assertInputs(f.folder,copy,snapshot);
  await writeFile(path.join(copy,'frontend/src/injected.ts'),'private injected code');await assert.rejects(assertInputs(f.folder,copy,snapshot),/STALE_INPUT/);
  await rm(path.join(copy,'frontend/src/injected.ts'));await writeFile(path.join(copy,'frontend/src/app.ts'),'modified inside copy');await assert.rejects(assertInputs(f.folder,copy,snapshot),/STALE_INPUT/);
});
test('non-HTTP port occupants and concurrent product/full locks are protected', async t => {
  const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => listener.close(resolve)));
  await assert.rejects(freePorts([listener.address().port]), /PORT_BUSY/); assert.equal(listener.listening, true);
  const f = await fixture(t); const release = await acquireRunLock(f.folder); try { await assert.rejects(acquireRunLock(f.folder), /VERIFY_BUSY/); } finally { await release(); }
  const again = await acquireRunLock(f.folder); await again();
});
test('real child exits, spawn failures and timeout stop later checks with no retry', async () => {
  for (const [code, reason] of [['process.exit(7)', 'COMMAND_FAILED'], ['setInterval(()=>{},1000)', 'TIMEOUT']]) {
    let calls = 0; const results = await schedule({ ...controlOptions, steps: [step('first'), step('later')], budgetMs: 1000,
      execute: async () => { calls++; return runNode(code, { timeoutMs: 150 }); } });
    assert.equal(calls, 1); assert.equal(results[0].status, 'failed'); assert.equal(results[0].reason, reason); assert.equal(results[1].reason, 'EARLIER_FAILURE'); assert.equal(results[0].evidenceKind, 'control-test');
  }
  const spawnFailure = await processes.runCommand({ command: '/explicit-control-missing-program', timeoutMs: 1000, env: cleanEnvironment(), cwd: root }); assert.equal(spawnFailure.reason, 'SPAWN_FAILED');
});
test('remaining total budget caps each child and prevents starting another step; NOT_SELECTED stays distinct', async () => {
  let now = 100; let calls = 0;
  const results = await schedule({ ...controlOptions, steps: [step('first'), step('later'), { ...step('full-only'), selected: false }], budgetMs: 10, now: () => now,
    execute: async (_, limit) => { assert.equal(limit, 10); calls++; now += 11; return { status: 'passed', reason: null }; } });
  assert.equal(calls, 1); assert.equal(results[1].reason, 'TOTAL_BUDGET'); assert.equal(results[2].reason, 'NOT_SELECTED');
});
test('parent watchdog reaps enrolled detached descendants when its command times out', async t => {
  const f = await fixture(t); const ledger = path.join(f.folder, 'children.jsonl'); const childPid = path.join(f.folder, 'child-pid');
  const code = `const{spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});fs.writeFileSync(${JSON.stringify(childPid)},String(child.pid));setInterval(()=>{},1000);`;
  const result = await runNode(code, { ledger, timeoutMs: 400 }); assert.equal(result.reason, 'TIMEOUT'); assert.equal(result.cleanup, 'passed');
  const pid = Number(await readFile(childPid, 'utf8')); assert.ok(!processes.processRows().some(item => item.pid === pid));
});
test('unknown identities are left untouched and cleanup uncertainty is nonzero', async t => {
  const foreign = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' }); t.after(() => foreign.kill('SIGTERM')); await delay(60);
  const f = await fixture(t); const ledger = path.join(f.folder, 'ledger.jsonl'); const row = processes.processRows().find(item => item.pid === foreign.pid); assert.ok(row);
  await writeFile(ledger, JSON.stringify({ ...row, start: 'wrong-start' }) + '\n');
  const result = await runNode('setTimeout(()=>{},60)', { ledger }); assert.equal(result.cleanup, 'failed'); assert.equal(result.reason, 'CLEANUP_INCOMPLETE'); assert.equal(foreign.exitCode, null);
});
test('SIGINT and SIGTERM cancel real scheduler children and preserve 130/143 CLI semantics', async t => {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const f = await fixture(t); const marker = path.join(f.folder, 'ready'); const file = path.join(f.folder, 'control.mjs');
    await writeFile(file, `import processes from ${JSON.stringify(new URL('./verification/processes.cjs', import.meta.url).href)};import fs from 'node:fs';const c=new AbortController();let status=0;for(const [s,n]of [['SIGINT',130],['SIGTERM',143]])process.once(s,()=>{status=n;c.abort()});const result=await processes.runCommand({command:process.execPath,args:['-e',${JSON.stringify(`require('fs').writeFileSync(${JSON.stringify(marker)},'ready');setInterval(()=>{},1000)`)}],signal:c.signal,timeoutMs:5000,cleanupMs:3000,graceMs:100});if(result.status!=='cancelled'||result.cleanup!=='passed')process.exit(1);process.exitCode=status;`);
    const child = spawn(process.execPath, [file], { env: cleanEnvironment(), stdio: 'ignore' }); const ended = new Promise(resolve => child.once('exit', resolve));
    for (let i = 0; i < 100; i++) { try { await access(marker); break; } catch { await delay(10); } }
    await access(marker); child.kill(signal); assert.equal(await ended, signal === 'SIGINT' ? 130 : 143);
  }
});
test('cleanup deadline exhaustion fails instead of reporting a stopped noncooperative child', async t => {
  const f = await fixture(t); const marker = path.join(f.folder, 'pid');
  const result = await runNode(`require('fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`, { timeoutMs: 200, cleanupMs: 0 });
  const pid = Number(await readFile(marker, 'utf8')); t.after(() => { try { process.kill(pid, 'SIGKILL'); } catch { /* already exited */ } });
  assert.equal(result.reason, 'CLEANUP_INCOMPLETE'); assert.equal(result.cleanup, 'failed');
});
function reportFixture() {
  const expected = { suite: 'workspace', runId: 'explicit-control-run', profile: 'product', sourceDigest: 'a'.repeat(64), buildDigest: 'b'.repeat(64), report: '/private/report.json', ledger: '/private/ledger.jsonl', minimumCases: 1 };
  const value = { schemaVersion: 1, ...expected, evidenceKind: 'application-regression', source: 'fixture', status: 'passed', cleanup: 'passed', realModelCalls: 0,
    cases: [{ id: 'expected-negative-assertions', status: 'passed', observationCode: 'ASSERTIONS_PASSED', durationMs: 1 }], screenshots: [] };
  return { expected, value };
}
test('missing/empty/stale/foreign/skipped/contradictory reports cannot manufacture application evidence', async () => {
  const { value, expected } = reportFixture(); assert.equal(evidence.validateReport(value, expected, 0), value);
  for (const bad of [null, {}, { ...value, runId: 'old-run' }, { ...value, buildDigest: 'c'.repeat(64) }, { ...value, suite: 'candidate' }, { ...value, cases: [] }, { ...value, cases: [{ ...value.cases[0], status: 'skipped' }] }, { ...value, evidenceKind: 'control-test' }, { ...value, status: 'running' }, { ...value, cleanup: 'failed' }, { ...value, realModelCalls: 1 }]) assert.throws(() => evidence.validateReport(bad, expected, 0));
  assert.throws(() => evidence.validateReport(value, expected, 1));
  const results = await schedule({ ...controlOptions, steps: [step('report'), step('later')], budgetMs: 1000, execute: async () => { throw Error('MISSING_REPORT'); } }); assert.equal(results[0].reason, 'MISSING_REPORT'); assert.equal(results[1].status, 'not-run');
});
test('atomic summaries contain only projections; screenshot allowlist refuses private, traversal, symlink and unredacted bytes', async t => {
  const f = await fixture(t); const filename = path.join(f.folder, 'summary.json'); await atomicJson(filename, { status: 'running' }); await atomicJson(filename, { status: 'failed', reason: 'ASSERTION_FAILED' }); assert.deepEqual(JSON.parse(await readFile(filename)), { status: 'failed', reason: 'ASSERTION_FAILED' });
  const png = Buffer.from([137,80,78,71,13,10,26,10,0]); const name = 'workspace-dev-1280.png'; await writeFile(path.join(f.folder, name), png);
  const item = { path: name, redacted: true, digest: createHash('sha256').update(png).digest('hex') }; assert.deepEqual(evidence.screenshotForExport(f.folder, item), png);
  for (const bad of [{ ...item, redacted: false }, { ...item, path: '../private.png' }, { ...item, path: '/private/cookie.json' }, { ...item, digest: 'f'.repeat(64) }]) assert.throws(() => evidence.screenshotForExport(f.folder, bad));
  await rm(path.join(f.folder, name)); await symlink(filename, path.join(f.folder, name)); assert.throws(() => evidence.screenshotForExport(f.folder, item), /UNSAFE_EVIDENCE/);
  assert.ok(!(await readFile(filename, 'utf8')).includes('PRIVATE_SENTINEL'));
  const projected=publicSummary({runId:'control',profile:'product',status:'failed',reason:'REPORT_OUTCOME',steps:[{id:'workspace',owner:'GEN-007',coverage:['sdk-tools'],status:'failed',reason:'REPORT_OUTCOME',cases:null,durationMs:1,raw:'PRIVATE_SENTINEL'}],screenshots:[],raw:'PRIVATE_SENTINEL'});
  assert.ok(!JSON.stringify(projected).includes('PRIVATE_SENTINEL'));
});
test('unknown remote model requests are blocked before transport; loopback fixture calls are permitted', async () => {
  let calls = 0; let violations = 0; const guarded = guardFetch(async () => { calls++; return new Response('{}'); }, () => { violations++; });
  for (const url of ['https://api.openai.com/v1/responses', 'https://ai.elegantyc.com/v1/models', 'https://unknown.invalid/v1/chat/completions']) await assert.rejects(guarded(url), /MODEL_NETWORK_FORBIDDEN/);
  await guarded('http://127.0.0.1:3456/v1/responses'); assert.equal(violations, 3); assert.equal(calls, 1);
});
test('new run ids reject reuse and unsafe ids or symlink destinations before launching verification', async t => {
  const f = await fixture(t); await assert.rejects(verify(f.folder, 'product', '../escape'), /INVALID_RUN_ID/);
  await mkdir(path.join(f.folder, 'test-results/gen-regression/existing'), { recursive: true }); await assert.rejects(verify(f.folder, 'product', 'existing'), /RUN_EXISTS/);
  const g = await fixture(t); await symlink(f.folder, path.join(g.folder, 'test-results')); await assert.rejects(verify(g.folder, 'product', 'fresh'), /UNSAFE_INPUT/);
  assert.ok(requiredScripts.includes('smoke:workspace')); assert.ok((await manifest(f.folder)).entries.length > 0);
});
test('CI uses one validated run id per job, fixed Actions, safe uploads and unchanged failure status', async () => {
  const yaml=await readFile(path.join(root,'.github/workflows/ci.yml'),'utf8');
  for(const hash of ['3d3c42e5aac5ba805825da76410c181273ba90b1','949feb2413d6458794dcd2491c4babbbce0c15c1','ea17c68df8912ef543352723c149a84f56e3d413','cf430e030ddbb5b0abf93d22962f4752f3646cd9'])assert.ok(yaml.includes('@'+hash));
  assert.equal((yaml.match(/path: test-results\/gen-regression\/\$\{\{ env.ATOMS_VERIFY_RUN_ID \}\}\/export\//g)??[]).length,2);
  assert.match(yaml,/timeout-minutes: 25/);assert.match(yaml,/timeout-minutes: 45/);assert.match(yaml,/run: pnpm verify:product/);assert.match(yaml,/run: pnpm verify\n/);
  assert.equal((yaml.match(/retention-days: 7/g)??[]).length,2);assert.ok(!/continue-on-error|secrets\.|path:.*\*|pull_request_target/.test(yaml));
  for(const job of ['quality','lifecycle'])assert.ok(evidence.ID.test(`gh-123456789-2-${job}`));
});
test('masked derivatives are created by the capture helper, raw sentinel screenshots never enter its export list', async t => {
  const f=await fixture(t);const context={...reportFixture().expected,report:path.join(f.folder,'suite.json'),ledger:path.join(f.folder,'ledger.jsonl')};const contextFile=path.join(f.folder,'context.json');await writeFile(contextFile,JSON.stringify(context));
  const code=`const fs=require('node:fs');const{createEvidence}=require(${JSON.stringify(path.join(root,'scripts/verification/evidence.cjs'))});const e=createEvidence('workspace');const page={locator:selector=>({selector}),screenshot:async options=>{if(options.mask&&!options.mask[0].selector.includes('iframe'))throw Error('Missing preview mask');fs.writeFileSync(options.path,options.mask?Buffer.from([137,80,78,71,13,10,26,10,0]):'PRIVATE_CAPTURE_SENTINEL');}};(async()=>{for(let i=0;i<2;i++)await e.screenshot(page,{path:${JSON.stringify(path.join(f.folder,'dev-1280.png'))}});e.finish({status:'passed',cleanup:'passed',cases:[{id:'control-mask',status:'passed',durationMs:1}]});})().catch(()=>process.exitCode=1);`;
  const result=await runNode(code,{env:{...cleanEnvironment(),ATOMS_VERIFY_CONTEXT:contextFile}});assert.equal(result.status,'passed');const report=JSON.parse(await readFile(context.report));assert.equal(report.screenshots.length,1);assert.ok(!JSON.stringify(report).includes('PRIVATE_CAPTURE_SENTINEL'));
  const bytes=evidence.screenshotForExport(f.folder,report.screenshots[0]);assert.ok(!bytes.includes(Buffer.from('PRIVATE_CAPTURE_SENTINEL')));
});


test('standalone browser entry cannot start services while its workspace verification lock is held', async t => {
 const f=await fixture(t);await mkdir(path.join(f.folder,'.runtime/verify.lock'),{recursive:true});const marker=path.join(f.folder,'started');
 const code=`const{canStartStandalone}=require(${JSON.stringify(path.join(root,'scripts/verification/standalone-lock.cjs'))});if(!canStartStandalone(${JSON.stringify(f.folder)}))process.exit(2);require('node:fs').writeFileSync(${JSON.stringify(marker)},'started');`;
 await assert.rejects(exec(process.execPath,['-e',code],{cwd:f.folder,env:cleanEnvironment(),timeout:5000}),error=>error.code===2&&error.stderr.includes('VERIFY_BUSY'));
 await assert.rejects(access(marker),{code:'ENOENT'});await rm(path.join(f.folder,'.runtime/verify.lock'),{recursive:true});
 await exec(process.execPath,['-e',code],{cwd:f.folder,env:cleanEnvironment(),timeout:5000});assert.equal(await readFile(marker,'utf8'),'started');
});
