const assert = require('node:assert/strict');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {readFile, readdir, realpath, mkdir, cp, symlink, rm, lstat, writeFile} = require('node:fs/promises');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {setTimeout: delay} = require('node:timers/promises');
const {runtime} = require('./release/runtime.cjs');
const {closeBrowser, signalOwned} = require('./verification/processes.cjs');
const root = path.resolve(__dirname, '..');
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const REQUIRED = ['v1-generation', 'v1-business-adoption', 'v2-generation', 'v2-business-adoption', 'history-pagination-preview-cancel', 'explicit-restore', 'refresh-owned-restart', 'v3-generation', 'v3-business-adoption', 'v2-preserved-preview'];
const NEGATIVE = ['negative-storage-cas-unknown-access', 'negative-refusal', 'negative-busy-cancel-stale', 'negative-terminal-unknown', 'negative-response-loss-preview'];
function parseArgs(args = []) {
  if (!Array.isArray(args)) throw Error('INVALID_ARGUMENTS');
  if (!args.length) return {live: false};
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return {help: true};
  if (args.length === 1 && args[0] === '--live') return {live: true};
  throw Error('INVALID_ARGUMENTS');
}
const reasons = new Set(['INVALID_ARGUMENTS', 'PORT_BUSY', 'VERIFY_BUSY', 'MISSING_BUILD', 'MISSING_CHROME', 'MISSING_HELPER', 'FIXTURE_REQUIRED', 'MODEL_CONFIGURATION', 'SIGNAL', 'TIMEOUT', 'STALE_INPUT', 'STALE_BUILD', 'STALE_HARNESS', 'OBSERVATION_COUNT', 'CLEANUP_INCOMPLETE', 'GENERATION_UNKNOWN', 'GENERATION_FAILED', 'ASSERTION_FAILED', 'STARTUP_FAILED', 'READINESS_TIMEOUT', 'PORT_OWNER_CHANGED']);
function safeReason(reason) { return reasons.has(reason) ? reason : 'ASSERTION_FAILED'; }
function validateReport(report, expected = {}) {
  if (!report || report.schemaVersion !== 1 || report.suite !== 'revision-acceptance' || !UUID.test(report.runId ?? '') || report.caseVersion !== 'rev005-v1') throw Error('REPORT_IDENTITY');
  for (const key of ['runId', 'sourceDigest', 'buildDigest', 'harnessDigest', 'caseVersion', 'source']) if (expected[key] !== undefined && expected[key] !== report[key]) throw Error('REPORT_IDENTITY');
  if (!['fixture', 'live'].includes(report.source) || ['sourceDigest', 'buildDigest', 'harnessDigest'].some(key => !HASH.test(report[key] ?? '')) || report.status !== 'passed' || report.cleanup !== 'passed') throw Error('REPORT_INCOMPLETE');
  const required = [...REQUIRED, ...(report.source === 'fixture' ? NEGATIVE : [])];
  if (!Array.isArray(report.phases) || new Set(report.phases.map(row => row.id)).size !== report.phases.length || required.some(id => !report.phases.some(row => row.id === id && row.status === 'passed'))) throw Error('REPORT_INCOMPLETE');
  if (!UUID.test(report.projectId ?? '') || report.phases.length !== required.length || report.phases.some((row, index) => row.id !== required[index] || index > 0 && row.before !== report.phases[index - 1].after)) throw Error('REPORT_INCOMPLETE');
  for (const row of report.phases) {
    if (!Number.isSafeInteger(row.before) || !Number.isSafeInteger(row.after) || row.before < 0 || row.after < row.before || row.delta !== row.after - row.before || row.noModel && row.delta !== 0 || row.status !== 'passed') throw Error('REPORT_COUNTS');
  }
  if (!Array.isArray(report.cases) || report.cases.length !== 3 || report.cases.some((row, i) => row.id !== `v${i + 1}` || row.status !== 'passed' || !UUID.test(row.versionId ?? '') || !UUID.test(row.requestId ?? '') || !UUID.test(row.runId ?? '') || !HASH.test(row.contentHash ?? '') || !HASH.test(row.snapshotDigest ?? '') || row.metrics?.source !== report.source || !Number.isSafeInteger(row.metrics.dispatched) || row.metrics.dispatched < 1 || row.metrics.dispatched > 6 || row.metrics.responses !== row.metrics.dispatched || row.metrics.sdkFinished !== row.metrics.dispatched || !Array.isArray(row.geometry) || row.geometry.length !== 3 || new Set(row.geometry.map(g => g.viewportWidth)).size !== 3 || row.geometry.some(g => ![1366, 320, 375].includes(g.viewportWidth) || g.hostScroll > g.hostWidth + 1 || g.frameScroll > g.frameWidth + 1))) throw Error('REPORT_CASES');
  if (report.cases.reduce((total, row) => total + row.metrics.dispatched, 0) > 18 || report.cancelRestorePosts !== 0 || report.cases[1].parentVersionId !== report.cases[0].versionId || report.cases[2].parentVersionId !== report.cases[0].versionId || report.cases[2].sequence !== report.cases[1].sequence + 1) throw Error('REPORT_COUNTS');
  for (const key of ['versionId', 'runId', 'requestId']) if (new Set(report.cases.map(row => row[key])).size !== 3) throw Error('REPORT_CASES');
  for (const row of report.cases) {
    if (row.baseVersionId !== row.parentVersionId || !UUID.test(row.parentVersionId ?? '') || report.phases.find(phase => phase.id === `${row.id}-generation`).delta !== row.metrics.dispatched || report.source === 'fixture' && row.context?.branchIsolation !== true) throw Error('REPORT_CASES');
    if (row.geometry.some(g => ['viewportWidth', 'hostWidth', 'hostScroll', 'iframeWidth', 'frameWidth', 'frameScroll'].some(key => !Number.isFinite(g[key]) || g[key] <= 0) || g.iframeWidth > g.viewportWidth + 1 || g.iframeWidth < 250)) throw Error('REPORT_CASES');
  }
  if (report.source === 'fixture' && report.realModelCalls !== 0 || report.source === 'live' && report.realModelCalls !== report.cases.reduce((total, row) => total + row.metrics.dispatched, 0)) throw Error('REPORT_COUNTS');
  return report;
}
function summary(report) {
  const number = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const hash = value => HASH.test(value ?? '') ? value : null;
  const uuid = value => UUID.test(value ?? '') ? value : null;
  const status = value => ['running', 'passed', 'failed', 'blocked', 'cancelled', 'not-run'].includes(value) ? value : 'not-run';
  return {schemaVersion: 1, suite: 'revision-acceptance', runId: uuid(report.runId), source: ['fixture', 'live'].includes(report.source) ? report.source : 'not-run',
    sourceDigest: hash(report.sourceDigest), buildDigest: hash(report.buildDigest), harnessDigest: hash(report.harnessDigest), caseVersion: report.caseVersion === 'rev005-v1' ? report.caseVersion : null,
    status: status(report.status), reason: report.reason ? safeReason(report.reason) : null, cleanup: status(report.cleanup), durationMs: number(report.durationMs), realModelCalls: number(report.realModelCalls),
    preflight: ['fixture-binding', 'model-configuration'].map(id => ({id, status: status(report.preflight?.find(row => row.id === id)?.status)})),
    phases: (report.phases ?? []).filter(row => [...REQUIRED, ...NEGATIVE].includes(row.id)).map(row => ({id: row.id, status: status(row.status), source: ['fixture', 'live'].includes(row.source) ? row.source : 'not-run', noModel: row.noModel === true, before: number(row.before), after: number(row.after), delta: number(row.delta)})),
    cases: (report.cases ?? []).filter(row => ['v1', 'v2', 'v3'].includes(row.id)).map(row => ({id: row.id, status: status(row.status), versionId: uuid(row.versionId), parentVersionId: uuid(row.parentVersionId), runId: uuid(row.runId), requestId: uuid(row.requestId), sequence: number(row.sequence), snapshotDigest: hash(row.snapshotDigest), contentHash: hash(row.contentHash), dispatched: number(row.metrics?.dispatched), responses: number(row.metrics?.responses), sdkFinished: number(row.metrics?.sdkFinished)})),
    visualReview: 'not-run', acceptance: 'not-run', remoteDeployment: 'not-run', hostedCI: 'not-run'};
}
async function harnessDigest() {
  const {sha256} = await import('./verification/primitives.mjs');
  const names = ['scripts/revision-smoke.cjs', 'scripts/revision-live.cjs', 'scripts/revision/server.mjs', 'scripts/revision/path.mjs', 'scripts/revision/cases.mjs', 'scripts/revision/browser.mjs', 'scripts/revision/fixture.mjs', 'scripts/live/metadata.mjs', 'scripts/live/browser.mjs', 'scripts/verification/workspace-path.cjs', 'scripts/verification/processes.cjs', 'scripts/verification/input.mjs', 'scripts/release/runtime.cjs', 'scripts/prepare-backend-runtime.mjs'];
  const entries = await Promise.all(names.map(async name => [name, sha256(await readFile(path.join(root, name)))]));
  return sha256(JSON.stringify(entries));
}
async function fixtureBinding(folder, expected) {
  folder = path.resolve(folder);
  const rootStat = await lstat(folder);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw Error('UNSAFE_PATH');
  const base = await realpath(folder);
  for (const entry of await readdir(folder, {withFileTypes: true})) {
    if (!entry.isDirectory() || !UUID.test(entry.name)) continue;
    const privateDir = path.join(folder, entry.name, 'private'); const filename = path.join(privateDir, 'report.json');
    try {
      const runDir = await lstat(path.dirname(privateDir));
      const dir = await lstat(privateDir), stat = await lstat(filename);
      if (!runDir.isDirectory() || runDir.isSymbolicLink() || !dir.isDirectory() || dir.isSymbolicLink() || !stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024 || await realpath(filename) !== path.join(base, entry.name, 'private/report.json')) continue;
      const report = JSON.parse(await readFile(filename, 'utf8'));
      if ((await lstat(folder)).isSymbolicLink() || await realpath(folder) !== base) throw Error('UNSAFE_PATH');
      validateReport(report, {...expected, runId: entry.name, source: 'fixture'}); return report.runId;
    } catch { /* Failed, stale and partial runs cannot authorize a live run. */ }
  }
  throw Error('FIXTURE_REQUIRED');
}
async function preflightModel(backendDirectory, env, signal) {
  // Match server.ts: existing process values win over cwd/.env. Secrets never return to the runner.
  const script = `import {existsSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import net from 'node:net';
try {
  const forbidden = () => { throw Error('PREFLIGHT_NETWORK_FORBIDDEN'); };
  globalThis.fetch = forbidden; net.Socket.prototype.connect = forbidden; net.Server.prototype.listen = forbidden;
  if (existsSync('.env')) loadEnvFile('.env');
  const {readModelConfig} = await import(pathToFileURL(resolve('dist/model/config.js')).href);
  readModelConfig(process.env);
  process.stdout.write('MODEL_CONFIGURATION_OK\\n');
} catch { process.exitCode = 2; }`;
  let result;
  try {
    result = await promisify(execFile)(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: backendDirectory, env, signal, timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 1024,
    });
  } catch { throw Error(signal?.aborted ? 'SIGNAL' : 'MODEL_CONFIGURATION'); }
  if (result.stdout !== 'MODEL_CONFIGURATION_OK\n' || result.stderr !== '') throw Error('MODEL_CONFIGURATION');
}
async function run(args = {live: false}) {
  if (args.help) return 0;
  if (typeof args.live !== 'boolean' || Object.keys(args).some(key => key !== 'live')) throw Error('INVALID_ARGUMENTS');
  const {atomicJson, cleanEnvironment, acquireRunLock, freePorts, buildIdentity, manifest, gitInputs} = await import('./verification/input.mjs');
  const {privateDirectory} = await import('./release/paths.mjs');
  const runId = randomUUID(); const output = path.join(root, 'test-results/revision-acceptance', runId);
  const priv = path.join(output, 'private'), exported = path.join(output, 'export'), temporary = path.join(output, 'runtime');
  // Never reuse an existing run, even when its previous report is incomplete.
  await privateDirectory(root, ['test-results', 'revision-acceptance']); await mkdir(output, {mode: 0o700});
  for (const directory of [priv, exported, temporary]) await mkdir(directory, {mode: 0o700});
  const report = {schemaVersion: 1, suite: 'revision-acceptance', runId, source: args.live ? 'not-run' : 'fixture', requestedSource: args.live ? 'live' : 'fixture', caseVersion: 'rev005-v1', status: 'running', cleanup: 'not-run', preflight: ['fixture-binding', 'model-configuration'].map(id => ({id, status: 'not-run'})), phases: [], cases: ['v1', 'v2', 'v3'].map(id => ({id, status: 'not-run'})), startedAt: new Date().toISOString(), realModelCalls: args.live ? null : 0};
  let browser, page, context, provider, unlock, backend, interrupted, fatal, timedOut = false; let counter = 0;
  const started = Date.now(), logs = [];
  const preflightController = new AbortController();
  const check = () => { if (interrupted) throw Error('SIGNAL'); if (timedOut) throw Error('TIMEOUT'); if (fatal) throw Error(fatal); };
  const owned = runtime(check);
  const abort = () => { preflightController.abort(); provider?.abort(); for (const child of owned.children) { try { signalOwned(child, 'SIGTERM'); } catch { fatal = 'CLEANUP_INCOMPLETE'; } } if (browser) void browser.close().catch(() => {}); };
  const handlers = ['SIGINT', 'SIGTERM'].map(signal => { const fn = () => { interrupted = signal; abort(); }; process.once(signal, fn); return [signal, fn]; });
  const timer = setTimeout(() => { timedOut = true; abort(); }, 12 * 60_000);
  const publish = async () => { report.durationMs = Date.now() - started; await atomicJson(path.join(priv, 'report.json'), report); await atomicJson(path.join(exported, 'summary.json'), summary(report)); };
  let readObservations, metrics;
  const observations = async () => {
    if (!readObservations) return [];
    let text = ''; for (const log of logs) { const content = await readFile(log, 'utf8'); text += content.slice(0, content.lastIndexOf('\n') + 1); }
    return readObservations(text);
  };
  const count = async () => {
    const events = await observations(); const dispatch = events.filter(event => event.event === 'dispatch');
    if (new Set(dispatch.map(row => row.requestAttemptId)).size !== dispatch.length) throw Error('OBSERVATION_COUNT');
    const main = dispatch.filter(row => report.cases.some(item => item.requestId === row.requestId));
    if (main.length > 18 || new Set(main.map(row => row.requestId)).size > 3) throw Error('OBSERVATION_COUNT');
    return dispatch.length;
  };
  const phase = async (id, noModel, work, initial) => {
    check(); const row = {id, noModel, source: report.source, status: 'running', before: initial ?? await count(), after: null, delta: null}; report.phases.push(row); await publish(); console.log(`[revision] ${id}: running`);
    try { await work(); check(); await delay(100); check(); row.after = await count(); row.delta = row.after - row.before; if (noModel) assert.equal(row.delta, 0, `${id} called a model`); row.source = report.source; row.status = 'passed'; console.log(`[revision] ${id}: passed`); }
    catch (error) { row.status = interrupted ? 'cancelled' : 'failed'; row.after = await count().catch(() => null); row.delta = row.after === null ? null : row.after - row.before; throw error; }
    finally { await publish(); }
  };
  let monitor;
  try {
    await publish(); unlock = await acquireRunLock(root, () => { fatal = 'CLEANUP_INCOMPLETE'; abort(); });
    await freePorts([3001, 5173, 4173]); check();
    try { report.buildDigest = (await buildIdentity(root)).digest; } catch (error) { throw Error('MISSING_BUILD', {cause: error}); }
    const sourceNames = async () => (await gitInputs(root)).filter(name => !name.startsWith('scripts/') && name !== 'README.md' && !name.startsWith('.github/'));
    report.sourceDigest = (await manifest(root, await sourceNames())).digest;
    try { report.harnessDigest = await harnessDigest(); } catch (error) { if (error.code === 'ENOENT') throw Error('MISSING_HELPER', {cause: error}); throw error; }
    if (args.live) {
      report.preflight[0].status = 'running'; await publish();
      report.fixtureRunId = await fixtureBinding(path.dirname(output), {sourceDigest: report.sourceDigest, buildDigest: report.buildDigest, harnessDigest: report.harnessDigest, caseVersion: report.caseVersion});
      report.preflight[0].status = 'passed';
    }
    const paths = await import('./revision/path.mjs'); const {caseVersion} = await import('./revision/cases.mjs'); assert.equal(caseVersion, report.caseVersion);
    ({readObservations, metrics} = await import('./live/metadata.mjs'));
    const deploy = path.join(temporary, 'backend'); const frontend = path.join(temporary, 'frontend'); const database = path.join(priv, 'atoms.sqlite');
    const env = {...cleanEnvironment(), NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '3001', DATABASE_PATH: database, APP_ORIGINS: paths.origin};
    if (args.live) {
      report.preflight[1].status = 'running'; await publish();
      await preflightModel(path.join(root, 'backend'), env, preflightController.signal); check();
      report.preflight[1].status = 'passed'; await publish();
    }
    assert.equal(await lstat(database).catch(() => null), null);
    if (!args.live) { const {prepareBackendRuntime} = await import('./prepare-backend-runtime.mjs'); await prepareBackendRuntime(root, deploy); provider = await paths.fixtureProvider(check); }
    await mkdir(frontend); await cp(path.join(root, 'frontend/dist'), path.join(frontend, 'dist'), {recursive: true});
    await cp(path.join(root, 'frontend/vite.config.ts'), path.join(frontend, 'vite.config.ts')); await cp(path.join(root, 'frontend/package.json'), path.join(frontend, 'package.json'));
    await symlink(path.join(root, 'frontend/node_modules'), path.join(frontend, 'node_modules'), 'dir');
    const startBackend = async () => {
      check(); const log = path.join(priv, `backend-${++counter}.log`); logs.push(log);
      // The validator and normal server load .env in the backend only; no credential enters the runner.
      backend = await owned.launch(process.execPath, args.live ? [path.join(root, 'backend/dist/server.js')] : [path.join(root, 'scripts/revision/server.mjs'), path.join(deploy, 'dist'), database, provider.origin], args.live ? path.join(root, 'backend') : deploy, env, log);
      await owned.ready('http://127.0.0.1:3001/api/health', backend);
    };
    await startBackend();
    const preview = await owned.launch(process.execPath, [path.join(root, 'frontend/node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], frontend, {...cleanEnvironment(), API_PROXY_TARGET: 'http://127.0.0.1:3001'}, path.join(priv, 'frontend.log'));
    const deadline = Date.now() + 30000; let ready = false;
    while (Date.now() < deadline) { check(); if (preview.exitCode !== null || preview.signalCode !== null) throw Error('STARTUP_FAILED'); try { if ((await fetch(paths.origin, {signal: AbortSignal.timeout(500)})).ok) { owned.assertListener(preview, 4173); ready = true; break; } } catch (error) { if (error.message === 'PORT_OWNER_CHANGED') throw error; } await delay(100); }
    if (!ready) throw Error('READINESS_TIMEOUT');
    const {launchLiveBrowser} = require('./live-smoke.cjs'); browser = await launchLiveBrowser();
    context = await browser.newContext({viewport: {width: 1366, height: 900}, reducedMotion: 'reduce'}); page = await context.newPage(); page.setDefaultTimeout(15000);
    const browserErrors = []; page.on('pageerror', error => browserErrors.push(error.message));
    // Enforce the global live bound during execution, including calls with unknown association.
    monitor = setInterval(() => { void observations().then(events => { if (args.live && (events.filter(row => row.event === 'dispatch').length > 18 || new Set(events.filter(row => row.event === 'dispatch').map(row => row.requestId)).size > 3)) { fatal = 'OBSERVATION_COUNT'; abort(); } }).catch(() => { fatal = 'OBSERVATION_COUNT'; abort(); }); }, 100); monitor.unref();
    const audit = async record => {
      await delay(100); const events = await observations(); const matching = events.find(event => event.runId === record.runId);
      if (!matching) throw Error('OBSERVATION_COUNT');
      if (args.live) report.source = 'live';
      return metrics(events, {source: report.source, modelId: matching.configuredModel, projectId: report.projectId, runId: record.runId, requestId: record.requestId});
    };
    await paths.mainPath({page, context, report, provider, phase, count, restart: async () => { await owned.stop(backend); await startBackend(); }, privateDir: priv, check, audit});
    if (!args.live) report.negative = await paths.negativePath({browser, deploy, database, phase, provider, count, check, restart: async () => { await owned.stop(backend); await startBackend(); }});
    assert.deepEqual(browserErrors, []);
    if ((await manifest(root, await sourceNames())).digest !== report.sourceDigest) throw Error('STALE_INPUT');
    if ((await buildIdentity(root)).digest !== report.buildDigest) throw Error('STALE_BUILD');
    if (await harnessDigest() !== report.harnessDigest) throw Error('STALE_HARNESS');
    if (provider) { assert.deepEqual(provider.state.errors, []); await writeFile(path.join(priv, 'sdk-captures.json'), JSON.stringify(provider.state.captures), {mode: 0o600}); }
    report.status = 'passed';
  } catch (error) {
    report.status = interrupted ? 'cancelled' : ['PORT_BUSY', 'VERIFY_BUSY', 'MISSING_BUILD', 'MISSING_CHROME', 'MISSING_HELPER', 'FIXTURE_REQUIRED', 'MODEL_CONFIGURATION'].includes(error.message) ? 'blocked' : 'failed';
    report.reason = safeReason(interrupted ? 'SIGNAL' : timedOut ? 'TIMEOUT' : error.message);
    for (const row of report.preflight) if (row.status === 'running') row.status = report.status;
    await writeFile(path.join(priv, 'failure.log'), String(error.stack), {mode: 0o600});
    if (page && !interrupted) await page.screenshot({path: path.join(priv, 'failure.png'), timeout: 2000}).catch(() => {});
  } finally {
    clearTimeout(timer); clearInterval(monitor);
    if (provider) await writeFile(path.join(priv, 'sdk-captures.json'), JSON.stringify(provider.state.captures), {mode: 0o600}).catch(() => {});
    if (context) await context.storageState({path: path.join(priv, 'author-storage.json')}).catch(() => {});
    const cleaned = await Promise.allSettled([closeBrowser(browser), owned.close(), provider?.close()]);
    if (cleaned.every(row => row.status === 'fulfilled')) { try { await rm(temporary, {recursive: true, force: true}); } catch { cleaned.push({status: 'rejected'}); } }
    try { await unlock?.(); } catch { cleaned.push({status: 'rejected'}); }
    report.cleanup = cleaned.some(row => row.status === 'rejected') ? 'failed' : 'passed';
    report.finishedAt = new Date().toISOString();
    report.observations = await observations().catch(() => null);
    if (args.live && report.observations !== null) report.source = report.observations.some(row => row.event === 'dispatch') ? 'live' : 'not-run';
    for (const row of report.phases) if (row.status !== 'not-run') row.source = report.source;
    report.realModelCalls = args.live ? report.observations ? report.observations.filter(row => row.event === 'dispatch').length : null : 0;
    if (report.cleanup === 'failed') { report.status = 'failed'; report.reason = 'CLEANUP_INCOMPLETE'; }
    else if (interrupted) { report.status = 'cancelled'; report.reason = 'SIGNAL'; }
    if (report.status === 'passed') { try { validateReport(report); } catch (error) { report.status = 'failed'; report.reason = 'ASSERTION_FAILED'; await writeFile(path.join(priv, 'validation.log'), error.stack, {mode: 0o600}); } }
    for (const id of [...REQUIRED, ...(!args.live ? NEGATIVE : [])]) if (!report.phases.some(row => row.id === id)) report.phases.push({id, status: 'not-run', reason: 'EARLIER_FAILURE', before: null, after: null, delta: null});
    for (const row of report.cases) if (row.status === 'running') row.status = interrupted ? 'cancelled' : 'failed';
    for (const [signal, fn] of handlers) process.removeListener(signal, fn);
    await publish();
  }
  console.log(`${report.status}: test-results/revision-acceptance/${runId}/export/summary.json`);
  return interrupted === 'SIGINT' ? 130 : interrupted ? 143 : report.status === 'passed' ? 0 : report.status === 'blocked' ? 2 : 1;
}
module.exports = {parseArgs, run, validateReport, summary, harnessDigest, fixtureBinding, preflightModel, REQUIRED, NEGATIVE};
if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) console.log('Usage: pnpm smoke:revision [--live]\nNo arguments: credential-free fixture. Live: prefer pnpm smoke:revision:live --live (at most 18 requests, no retry). Build first. Help makes no environment reads or requests.');
    else run(args).then(code => { process.exitCode = code; }).catch(() => { console.error('REVISION_RUN_FAILED'); process.exitCode = 1; });
  } catch { console.error('INVALID_ARGUMENTS'); process.exitCode = 2; }
}
