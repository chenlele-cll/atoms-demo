// Explicit port suite: node --test scripts/revision-smoke-control.test.mjs
// Requires a current build, Chrome, an idle verification lock and exclusive 3001/5173/4173.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {access, readFile, readdir, stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import path from 'node:path';
import test from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {cleanEnvironment, freePorts} from './verification/input.mjs';
import processes from './verification/processes.cjs';

const root = path.resolve(import.meta.dirname, '..');
const outputRoot = path.join(root, 'test-results/revision-acceptance');
const ports = [3001, 5173, 4173];
const sentinel = 'REVISION_CONTROL_PRIVATE_SENTINEL';

async function bounded(promise, ms) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('CONTROL_TIMEOUT')), ms); })]); }
  finally { clearTimeout(timer); }
}

function launch() {
  const child = spawn(process.execPath, ['scripts/revision-smoke.cjs'], {
    cwd: root, env: {...cleanEnvironment(), OPENAI_API_KEY: sentinel, MODEL_ID: sentinel,
      DATABASE_PATH: '/revision-control-must-not-open.sqlite', HTTPS_PROXY: sentinel}, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  const finished = new Promise((resolve, reject) => {
    child.once('error', reject); child.once('close', (code, signal) => resolve({code, signal, output}));
  });
  // Retain observed identities even after descendants are reparented during shutdown.
  const known = new Map();
  function collect() {
    const rows = processes.processRows();
    const leader = rows.find(row => row.pid === child.pid);
    const owned = processes.descendants(rows, [...known.values(), ...(leader ? [leader] : [])]);
    for (const row of owned) known.set(row.pid, row);
    return owned;
  }
  const monitor = setInterval(collect, 50);
  return {child, finished, collect, output: () => output, known, async dispose() {
    clearInterval(monitor); collect();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    try { await bounded(finished, 10000); } catch { /* Emergency cleanup is not a passing runner result. */ }
    const rows = processes.processRows();
    for (const seed of [...known.values()].reverse()) {
      const current = rows.find(row => processes.matches(seed, row));
      if (current) { try { process.kill(current.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
    }
    await bounded(finished, 3000);
  }};
}

async function finalReport(result) {
  const match = result.output.match(/test-results\/revision-acceptance\/([a-f0-9-]{36})\/export\/summary\.json/);
  assert.ok(match, result.output);
  const folder = path.join(outputRoot, match[1]);
  const report = JSON.parse(await readFile(path.join(folder, 'private/report.json'), 'utf8'));
  const summary = JSON.parse(await readFile(path.join(folder, 'export/summary.json'), 'utf8'));
  assert.equal(report.runId, match[1]); assert.equal(summary.runId, report.runId);
  assert.equal(report.source, 'fixture'); assert.equal(report.realModelCalls, 0);
  assert.equal(summary.source, 'fixture'); assert.equal(summary.realModelCalls, 0);
  assert.equal(report.cleanup, 'passed'); assert.equal(summary.cleanup, 'passed');
  await assert.rejects(access(path.join(folder, 'runtime')), {code: 'ENOENT'});
  assert.deepEqual(await readdir(path.join(folder, 'export')), ['summary.json']);
  assert.doesNotMatch(JSON.stringify(summary) + result.output, /REVISION_CONTROL_PRIVATE_SENTINEL|sk-revision-explicit-fixture/);
  await assert.rejects(access(path.join(root, '.runtime/verify.lock')), {code: 'ENOENT'});
  return {folder, report, summary};
}

test('revision runner protects foreign ports and cancels active Chrome/backend within ten seconds', {timeout: 150000}, async t => {
  await freePorts(ports);
  await assert.rejects(access(path.join(root, '.runtime/verify.lock')), {code: 'ENOENT'}, 'Run separately from every other port suite');
  for (const port of ports) await t.test(`preserves foreign HTTP listener on ${port}`, async () => {
    const server = createServer((_, response) => response.end('revision-foreign-owner'));
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    const instance = launch();
    try {
      const result = await bounded(instance.finished, 10000);
      assert.equal(result.code, 2, result.output); assert.equal(result.signal, null);
      assert.equal(await (await fetch(`http://127.0.0.1:${port}`, {signal: AbortSignal.timeout(2000)})).text(), 'revision-foreign-owner');
      const {report, summary} = await finalReport(result);
      assert.equal(report.status, 'blocked'); assert.equal(report.reason, 'PORT_BUSY');
      assert.equal(summary.status, 'blocked'); assert.equal(summary.reason, 'PORT_BUSY');
      assert.ok(report.phases.every(row => row.status === 'not-run'));
      assert.ok(report.cases.every(row => row.status === 'not-run'));
      assert.equal(instance.collect().length, 0);
    } finally {
      await instance.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    }
    await freePorts(ports);
  });

  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) await t.test(signal, async () => {
    await freePorts(ports);
    await assert.rejects(access(path.join(root, '.runtime/verify.lock')), {code: 'ENOENT'});
    const instance = launch();
    try {
      const deadline = Date.now() + 45000;
      let active;
      while (Date.now() < deadline && instance.child.exitCode === null && instance.child.signalCode === null) {
        const rows = instance.collect();
        const backend = rows.find(row => row.command.includes('/scripts/revision/server.mjs'));
        const chrome = rows.find(row => /(?:Google Chrome|\/chrome(?:\s|$))/.test(row.command) && !row.command.includes('--type='));
        if (backend && chrome) {
          const health = await fetch('http://127.0.0.1:3001/api/health', {signal: AbortSignal.timeout(500)}).catch(() => null);
          if (health?.ok) { active = {backend, chrome}; break; }
        }
        await delay(25);
      }
      assert.ok(active, `Backend and actual Chrome must both be running before signal: ${instance.output()}`);
      assert.ok(processes.processRows().some(row => processes.matches(active.backend, row)));
      assert.ok(processes.processRows().some(row => processes.matches(active.chrome, row)));
      const started = Date.now(); assert.equal(instance.child.kill(signal), true);
      const result = await bounded(instance.finished, 10000);
      assert.ok(Date.now() - started <= 10000, result.output);
      assert.equal(result.code, code, result.output); assert.equal(result.signal, null);
      const {folder, report, summary} = await finalReport(result);
      assert.equal(report.status, 'cancelled'); assert.equal(report.reason, 'SIGNAL');
      assert.equal(summary.status, 'cancelled'); assert.equal(summary.reason, 'SIGNAL');
      assert.ok(report.cases.slice(1).every(row => row.status === 'not-run'));
      assert.ok(!report.phases.some(row => row.id === 'v2-generation' && row.status !== 'not-run'));
      const rows = processes.processRows();
      for (const seed of instance.known.values()) assert.ok(!rows.some(row => processes.matches(seed, row)), `Owned process survived: ${seed.command}`);
      await freePorts(ports);
      const database = path.join(folder, 'private/atoms.sqlite');
      assert.ok((await stat(database)).size > 0);
      const Database = createRequire(path.join(root, 'backend/package.json'))('better-sqlite3');
      const db = new Database(database, {readonly: true, fileMustExist: true});
      try { assert.equal(db.pragma('integrity_check', {simple: true}), 'ok'); }
      finally { db.close(); }
      const logs = (await readdir(path.join(folder, 'private'))).filter(name => /^backend-\d+\.log$/.test(name));
      assert.ok(logs.length > 0, 'Private backend diagnostics must be retained');
      for (const log of logs) assert.doesNotMatch(await readFile(path.join(folder, 'private', log), 'utf8'), /REVISION_CONTROL_PRIVATE_SENTINEL/);
    } finally { await instance.dispose(); }
  });
});
