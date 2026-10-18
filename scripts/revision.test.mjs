import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp, mkdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {promisify} from 'node:util';
import revision from './revision-smoke.cjs';
import live from './revision-live.cjs';
import {cleanEnvironment} from './verification/input.mjs';

const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const sentinel = 'REVISION_PRIVATE_SENTINEL';

// Synthetic control evidence only; this never represents an application run.
function completeReport(source = 'fixture') {
  let count = 0;
  const versions = [randomUUID(), randomUUID(), randomUUID()];
  const template = randomUUID();
  const phases = [...revision.REQUIRED, ...(source === 'fixture' ? revision.NEGATIVE : [])].map(id => {
    const before = count;
    const noModel = !id.endsWith('-generation') && !['negative-refusal', 'negative-busy-cancel-stale', 'negative-terminal-unknown'].includes(id);
    if (id.endsWith('-generation')) count += 3;
    return {id, status: 'passed', noModel, before, after: count, delta: count - before};
  });
  return {
    schemaVersion: 1, suite: 'revision-acceptance', runId: randomUUID(), caseVersion: 'rev005-v1',
    source, sourceDigest: 'a'.repeat(64), buildDigest: 'b'.repeat(64), harnessDigest: 'c'.repeat(64),
    status: 'passed', cleanup: 'passed', projectId: randomUUID(), cancelRestorePosts: 0,
    realModelCalls: source === 'fixture' ? 0 : 9, phases,
    cases: versions.map((versionId, i) => ({
      id: `v${i + 1}`, status: 'passed', versionId, runId: randomUUID(), requestId: randomUUID(),
      baseVersionId: i === 0 ? template : versions[0], parentVersionId: i === 0 ? template : versions[0],
      sequence: i + 1, snapshotDigest: 'd'.repeat(64), contentHash: 'e'.repeat(64),
      metrics: {source, dispatched: 3, responses: 3, sdkFinished: 3}, context: {branchIsolation: true},
      geometry: [1366, 320, 375].map(width => ({viewportWidth: width, hostWidth: width, hostScroll: width,
        iframeWidth: width - 30, frameWidth: width - 30, frameScroll: width - 30})),
    })),
  };
}

test('fixed CLI accepts fixture/help/explicit live and rejects every extra or ambiguous argument', async () => {
  assert.deepEqual(revision.parseArgs([]), {live: false});
  assert.deepEqual(revision.parseArgs(['--live']), {live: true});
  for (const arg of ['--help', '-h']) assert.deepEqual(revision.parseArgs([arg]), {help: true});
  const invalid = [['--bad'], ['--fixture'], ['--live', '--live'], ['--live', '--help'], ['--help', '--live'],
    ['--live=true'], ['--retry'], ['--case', 'v1'], ['--'], ['v1'], ['--help', 'extra']];
  for (const args of [...invalid, null, '--live', {}]) assert.throws(() => revision.parseArgs(args), /INVALID_ARGUMENTS/);
  const folder = await mkdtemp(path.join(os.tmpdir(), 'revision cli '));
  try {
    const guard = path.join(folder, 'guard.mjs');
    await writeFile(guard, `import fs from 'node:fs'; import net from 'node:net'; import {syncBuiltinESMExports} from 'node:module';
const forbidden = () => { process.stderr.write('CONTROL_FORBIDDEN'); throw Error('CONTROL_FORBIDDEN'); };
for (const owner of [fs, fs.promises]) for (const key of ['readFile', 'readFileSync']) if (owner[key]) {
  const original = owner[key]; owner[key] = function(filename, ...args) {
    if (/(?:^|[/\\\\])\\.env(?:$|[.])/.test(String(filename))) forbidden();
    return original.call(this, filename, ...args);
  };
}
net.Server.prototype.listen = forbidden; net.Socket.prototype.connect = forbidden; globalThis.fetch = forbidden;
syncBuiltinESMExports();
`);
    for (const args of [['--help'], ['-h'], ...invalid]) {
      let result;
      try {
        result = await exec(process.execPath, ['--import', guard, path.join(root, 'scripts/revision-smoke.cjs'), ...args], {
          cwd: folder, env: {...cleanEnvironment(), OPENAI_API_KEY: sentinel, DATABASE_PATH: sentinel}, timeout: 5000,
        });
        assert.ok(['--help', '-h'].includes(args[0]));
        assert.match(result.stdout, /Usage:/);
      } catch (error) {
        assert.equal(error.code, 2, error.stderr);
        result = error;
        assert.match(error.stderr, /INVALID_ARGUMENTS/);
      }
      assert.doesNotMatch(result.stdout + result.stderr, /CONTROL_FORBIDDEN|REVISION_PRIVATE_SENTINEL/);
    }
  } finally { await rm(folder, {recursive: true, force: true}); }
});

test('export summary projects safe fields, preserves unknown counts and separates acceptance from automation', () => {
  const report = completeReport();
  Object.assign(report, {prompt: sentinel, cookie: sentinel, database: sentinel, observations: [{raw: sentinel}],
    screenshots: [sentinel], reason: sentinel, requestedSource: sentinel, projectId: sentinel});
  Object.assign(report.cases[0], {prompt: sentinel, files: {source: sentinel}, geometry: [{raw: sentinel}], context: {raw: sentinel}});
  Object.assign(report.cases[0].metrics, {apiKey: sentinel, attempts: [{providerRequestId: sentinel}], usage: {raw: sentinel}});
  report.phases[0].raw = sentinel;
  report.phases.push({id: sentinel, status: 'passed'});
  report.cases.push({id: sentinel, status: 'passed'});
  const result = revision.summary(report);
  assert.doesNotMatch(JSON.stringify(result), /REVISION_PRIVATE_SENTINEL/);
  assert.equal(result.reason, 'ASSERTION_FAILED');
  assert.equal(result.cases.length, 3);
  assert.equal(result.phases.length, 15);
  for (const key of ['visualReview', 'acceptance', 'remoteDeployment', 'hostedCI']) assert.equal(result[key], 'not-run');
  const unknown = revision.summary({source: 'not-run', cases: [{id: 'v1'}], phases: [{id: revision.REQUIRED[0]}]});
  assert.equal(unknown.realModelCalls, null);
  assert.equal(unknown.cases[0].dispatched, null);
  assert.equal(unknown.cases[0].responses, null);
  assert.equal(unknown.cases[0].sdkFinished, null);
  for (const key of ['before', 'after', 'delta']) assert.equal(unknown.phases[0][key], null);
  assert.equal(unknown.source, 'not-run');
  assert.equal(unknown.phases[0].source, 'not-run');
  const liveStage = revision.summary({source: 'live', preflight: [{id: 'model-configuration', status: 'blocked'}], phases: [{id: revision.REQUIRED[0], source: 'live', status: 'failed', after: null}], cases: []});
  assert.equal(liveStage.phases[0].source, 'live');
  assert.equal(liveStage.phases[0].after, null);
  assert.equal(liveStage.preflight.find(row => row.id === 'model-configuration').status, 'blocked');
});

test('independent live CLI requires the sole --live flag and help never loads the runner or reads secrets', async () => {
  assert.deepEqual(live.parseArgs(['--live']), {live: true});
  for (const args of [[], ['--help'], ['-h']]) assert.deepEqual(live.parseArgs(args), {help: true});
  const invalid = [['--fixture'], ['--live', '--live'], ['--live', '--help'], ['--help', '--live'], ['--retry'], ['--live=true'], ['v1']];
  for (const args of [...invalid, null, {}]) assert.throws(() => live.parseArgs(args), /INVALID_ARGUMENTS/);
  const folder = await mkdtemp(path.join(os.tmpdir(), 'revision live help '));
  try {
    const guard = path.join(folder, 'guard.cjs');
    await writeFile(guard, `const fs = require('node:fs'); const Module = require('node:module'); const net = require('node:net');
const denied = () => { throw Error('CONTROL_FORBIDDEN'); };
const load = Module._load; Module._load = function(name, ...args) { if (name.includes('revision-smoke')) denied(); return load.call(this, name, ...args); };
for (const api of [fs, fs.promises]) for (const key of ['readFile', 'readFileSync']) { const original = api[key]; api[key] = function(file, ...args) { if (String(file).includes('.env')) denied(); return original.call(this, file, ...args); }; }
net.Server.prototype.listen = denied; net.Socket.prototype.connect = denied; globalThis.fetch = denied;
`);
    for (const args of [[], ['--help'], ['-h'], ...invalid]) {
      let result;
      try {
        result = await exec(process.execPath, ['--require', guard, path.join(root, 'scripts/revision-live.cjs'), ...args], {cwd: folder, env: {...cleanEnvironment(), OPENAI_API_KEY: sentinel}, timeout: 5000});
        assert.ok(args.length === 0 || ['--help', '-h'].includes(args[0])); assert.match(result.stdout, /Usage:/);
      } catch (error) { assert.equal(error.code, 2); assert.match(error.stderr, /INVALID_ARGUMENTS/); result = error; }
      assert.doesNotMatch(result.stdout + result.stderr, /CONTROL_FORBIDDEN|REVISION_PRIVATE_SENTINEL/);
    }
  } finally { await rm(folder, {recursive: true, force: true}); }
});

test('isolated model preflight uses normal dotenv precedence, preserves budgets and returns no credentials', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'revision model preflight '));
  try {
    await mkdir(path.join(folder, 'dist/model'), {recursive: true});
    await writeFile(path.join(folder, 'package.json'), '{"type":"module"}');
    const config = path.join(folder, 'dist/model/config.js');
    const env = {...cleanEnvironment(), NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '3001', DATABASE_PATH: '/owned/private.sqlite', APP_ORIGINS: 'http://127.0.0.1:4173'};
    await writeFile(path.join(folder, '.env'), `OPENAI_API_KEY=${sentinel}\nMODEL_ID=explicit-model\nMODEL_TIMEOUT_MS=0\nMODEL_MAX_OUTPUT_TOKENS=4096\nDATABASE_PATH=/must-not-use.sqlite\nAPP_ORIGINS=https://must-not-use.invalid\nHOST=0.0.0.0\nPORT=9999\n`);
    await writeFile(config, `import assert from 'node:assert/strict';
export function readModelConfig(env) {
  assert.equal(env.OPENAI_API_KEY, '${sentinel}'); assert.equal(env.MODEL_ID, 'explicit-model');
  assert.equal(env.DATABASE_PATH, '/owned/private.sqlite'); assert.equal(env.APP_ORIGINS, 'http://127.0.0.1:4173');
  assert.equal(env.HOST, '127.0.0.1'); assert.equal(env.PORT, '3001');
  assert.equal(env.MODEL_TIMEOUT_MS, '0'); assert.equal(env.MODEL_MAX_OUTPUT_TOKENS, '4096');
  return {apiKey: env.OPENAI_API_KEY};
}`);
    assert.equal(await revision.preflightModel(folder, env), undefined);
    assert.equal(env.OPENAI_API_KEY, undefined, 'dotenv values must stay in the child');
    for (const body of [`throw Error('${sentinel}')`, `console.log('${sentinel}');`, `await fetch('https://must-not-call.invalid');`]) {
      await writeFile(config, `export async function unused() {}\n${body}\nexport function readModelConfig() {}`);
      await assert.rejects(revision.preflightModel(folder, env), error => { assert.equal(error.message, 'MODEL_CONFIGURATION'); assert.doesNotMatch(JSON.stringify(error), /REVISION_PRIVATE_SENTINEL/); return true; });
    }
    await rm(path.join(folder, '.env'));
    await writeFile(config, `export function readModelConfig(env) { if (!env.OPENAI_API_KEY) throw Error('missing'); }`);
    await assert.rejects(revision.preflightModel(folder, env), /MODEL_CONFIGURATION/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(revision.preflightModel(folder, env, controller.signal), /SIGNAL/);
  } finally { await rm(folder, {recursive: true, force: true}); }
});

test('validateReport rejects empty, old, incomplete and mismatched identities', () => {
  for (const source of ['fixture', 'live']) {
    const report = completeReport(source);
    assert.equal(revision.validateReport(report, report), report);
    for (const key of ['runId', 'sourceDigest', 'buildDigest', 'harnessDigest', 'caseVersion', 'source']) {
      assert.throws(() => revision.validateReport(report, {[key]: 'stale'}), /REPORT_IDENTITY/, key);
    }
  }
  for (const value of [null, {}, {schemaVersion: 0}, {...completeReport(), caseVersion: 'rev005-v0'}]) {
    assert.throws(() => revision.validateReport(value), /REPORT_IDENTITY/);
  }
  const mutations = [
    r => { r.phases = []; }, r => { r.cases = []; }, r => { r.phases.pop(); },
    r => { r.phases[0].status = 'not-run'; }, r => { r.phases.push(r.phases[0]); },
    r => { r.phases.reverse(); }, r => { r.cleanup = 'failed'; }, r => { r.status = 'running'; },
    r => { r.source = 'not-run'; }, r => { delete r.projectId; },
    r => { r.cases[2].parentVersionId = r.cases[1].versionId; },
    r => { r.cases[1].requestId = r.cases[0].requestId; },
    r => { r.cases[0].metrics.source = 'live'; }, r => { r.cases[2].context.branchIsolation = false; },
    r => { r.cases[0].geometry.pop(); }, r => { r.cases[0].geometry[0].hostScroll += 20; },
  ];
  for (const mutate of mutations) {
    const report = completeReport(); mutate(report);
    assert.throws(() => revision.validateReport(report), /REPORT_/);
  }
});

test('validateReport refuses absent, contradictory, negative and over-budget model counts', () => {
  const mutations = [r => { delete r.realModelCalls; }, r => { r.realModelCalls = 1; },
    r => { delete r.cancelRestorePosts; }, r => { r.cancelRestorePosts = 1; },
    r => { r.phases[0].after = -1; }, r => { r.phases[0].before = 0.5; },
    r => { r.phases[0].noModel = true; }, r => { r.phases[1].before++; },
    r => { r.cases[0].metrics.dispatched = 7; }, r => { r.cases[0].metrics.responses = 2; },
    r => { r.cases[0].metrics.sdkFinished = 2; }];
  for (const key of ['before', 'after', 'delta']) mutations.push(r => { delete r.phases[0][key]; });
  for (const key of ['dispatched', 'responses', 'sdkFinished']) mutations.push(r => { delete r.cases[0].metrics[key]; });
  for (const mutate of mutations) {
    const report = completeReport(); mutate(report);
    assert.throws(() => revision.validateReport(report), /REPORT_/);
  }
  const live = completeReport('live'); live.realModelCalls = 0;
  assert.throws(() => revision.validateReport(live), /REPORT_COUNTS/);
});

test('fixtureBinding requires current complete fixture evidence and rejects linked entries/private/report paths', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'revision binding '));
  try {
    const evidence = path.join(folder, 'evidence'); await mkdir(evidence);
    const report = completeReport();
    const expected = Object.fromEntries(['sourceDigest', 'buildDigest', 'harnessDigest', 'caseVersion'].map(key => [key, report[key]]));
    const external = path.join(folder, 'external'); await mkdir(path.join(external, 'private'), {recursive: true});
    const filename = path.join(external, 'private/report.json');
    await writeFile(filename, JSON.stringify(report));
    const entry = path.join(evidence, report.runId);
    await assert.rejects(revision.fixtureBinding(evidence, expected), /FIXTURE_REQUIRED/);
    await symlink(external, entry, 'dir');
    await assert.rejects(revision.fixtureBinding(evidence, expected), /FIXTURE_REQUIRED/);
    await rm(entry); await mkdir(entry);
    await symlink(path.join(external, 'private'), path.join(entry, 'private'), 'dir');
    await assert.rejects(revision.fixtureBinding(evidence, expected), /FIXTURE_REQUIRED/);
    await rm(path.join(entry, 'private')); await mkdir(path.join(entry, 'private'));
    const target = path.join(entry, 'private/report.json'); await symlink(filename, target);
    await assert.rejects(revision.fixtureBinding(evidence, expected), /FIXTURE_REQUIRED/);
    await rm(target);
    for (const value of [{}, {...report, sourceDigest: 'f'.repeat(64)}, {...report, runId: randomUUID()},
      {...report, source: 'live'}, {...report, cases: []}]) {
      await writeFile(target, JSON.stringify(value));
      await assert.rejects(revision.fixtureBinding(evidence, expected), /FIXTURE_REQUIRED/);
    }
    await writeFile(target, JSON.stringify(report));
    assert.equal(await revision.fixtureBinding(evidence, expected), report.runId);
  } finally { await rm(folder, {recursive: true, force: true}); }
});

test('fixtureBinding rejects an evidence root redirected outside by a symlink', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'revision escaped binding '));
  try {
    const report = completeReport();
    const external = path.join(folder, 'external');
    await mkdir(path.join(external, report.runId, 'private'), {recursive: true});
    await writeFile(path.join(external, report.runId, 'private/report.json'), JSON.stringify(report));
    const evidence = path.join(folder, 'evidence'); await symlink(external, evidence, 'dir');
    await assert.rejects(revision.fixtureBinding(evidence, {
      sourceDigest: report.sourceDigest, buildDigest: report.buildDigest, harnessDigest: report.harnessDigest,
    }), /FIXTURE_REQUIRED|UNSAFE_PATH/);
  } finally { await rm(folder, {recursive: true, force: true}); }
});

test('fixture server subprocess constructs explicit model/database isolation and forbids remote transport', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'revision server isolation '));
  try {
    const dist = path.join(folder, 'dist');
    for (const directory of ['storage', 'templates']) await mkdir(path.join(dist, directory), {recursive: true});
    await writeFile(path.join(folder, 'package.json'), '{"type":"module"}');
    await writeFile(path.join(dist, 'storage/ownership.js'), `export async function acquireOwnership(filename) { return {filename, release: async () => {}}; }`);
    await writeFile(path.join(dist, 'storage/store.js'), `export function openStore(filename) { globalThis.database = filename; return {recoverRunning() {}, close() {}}; }`);
    await writeFile(path.join(dist, 'templates/catalog.js'), `export async function loadCatalog() { return {}; }`);
    // Only the app construction is replaced; execute the real fixture launcher in a fresh process.
    await writeFile(path.join(dist, 'app.js'), `import assert from 'node:assert/strict';
export function buildApp(config, options) {
  assert.deepEqual(config, {});
  assert.deepEqual(options.generation.env, {OPENAI_API_KEY: 'sk-revision-explicit-fixture', MODEL_ID: 'gpt-6.1-sol'});
  assert.equal(globalThis.database, process.argv[3]);
  assert.notEqual(globalThis.database, process.env.DATABASE_PATH);
  let calls = 0;
  globalThis.fetch = (url, init) => { calls++; assert.equal(url, 'http://127.0.0.1:9/v1/responses'); assert.equal(init.redirect, 'error'); return Promise.resolve({ok:true}); };
  for (const url of ['https://other.invalid/v1/responses', 'https://api.openai.com/v1/chat/completions', 'http://127.0.0.1:8/v1/responses']) assert.throws(() => options.generation.transport(url, {}), /FIXTURE_REMOTE_FORBIDDEN/);
  assert.equal(calls, 0);
  return {close: async () => {}, listen: async address => {
    assert.deepEqual(address, {host:'127.0.0.1', port:3001});
    await options.generation.transport('https://api.openai.com/v1/responses', {});
    assert.equal(calls, 1); console.log('CONTROL_ISOLATED');
  }};
}`);
    const result = await exec(process.execPath, [path.join(root, 'scripts/revision/server.mjs'), dist,
      path.join(folder, 'private.sqlite'), 'http://127.0.0.1:9'], {
      cwd: folder, timeout: 5000, env: {...cleanEnvironment(), OPENAI_API_KEY: sentinel, MODEL_ID: sentinel,
        OPENAI_BASE_URL: 'https://remote.invalid', DATABASE_PATH: sentinel, HTTPS_PROXY: sentinel},
    });
    assert.match(result.stdout, /CONTROL_ISOLATED/);
    assert.doesNotMatch(result.stdout + result.stderr, /REVISION_PRIVATE_SENTINEL/);
    const source = await readFile(path.join(root, 'scripts/revision-smoke.cjs'), 'utf8');
    assert.match(source, /env = \{\.\.\.cleanEnvironment\(\),/);
    assert.match(source, /DATABASE_PATH: database/);
    const filtered = cleanEnvironment({PATH: process.env.PATH, OPENAI_API_KEY: sentinel, DATABASE_PATH: sentinel,
      NODE_OPTIONS: sentinel, HTTPS_PROXY: sentinel, MODEL_ID: sentinel});
    assert.doesNotMatch(JSON.stringify(filtered), /REVISION_PRIVATE_SENTINEL/);
  } finally { await rm(folder, {recursive: true, force: true}); }
});
