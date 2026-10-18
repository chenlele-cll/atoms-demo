import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { chmod, cp, lstat, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = await realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const output = path.join(root, 'test-results/manager', randomUUID());
const report = {};
const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (err) { if (err.code === 'ESRCH') return false; throw err; } };

async function portFree(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port }, () => server.close(resolve));
  });
}

async function fixture(name, { install = true, tools = true } = {}) {
  const dest = path.join(output, `${name} with spaces`, 'deep-repository-path-'.repeat(5));
  await mkdir(dest, { recursive: true });
  for (const file of ['manager.sh', '.nvmrc', '.process-compose-version', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json', 'process-compose.yaml']) await cp(path.join(root, file), path.join(dest, file));
  await mkdir(path.join(dest, 'scripts'));
  for (const file of ['manager.mjs', 'setup.mjs', 'check-dev-port.cjs', 'prepare-company-template.mjs']) await cp(path.join(root, 'scripts', file), path.join(dest, 'scripts', file));
  await cp(path.join(root, 'templates'), path.join(dest, 'templates'), { recursive: true });
  await cp(path.join(root, 'scripts/vendor'), path.join(dest, 'scripts/vendor'), { recursive: true });
  if (tools) await symlink(path.join(root, '.tools'), path.join(dest, '.tools'), 'dir');
  for (const app of ['backend', 'frontend']) {
    await cp(path.join(root, app), path.join(dest, app), { recursive: true, filter: (source) => !['node_modules', 'dist', '.env', 'template-assets'].includes(path.basename(source)) && !path.basename(source).startsWith('.env.') });
  }
  if (install) await exec('pnpm', ['install', '--offline', '--frozen-lockfile', '--ignore-scripts'], { cwd: dest, timeout: 60000, maxBuffer: 1024 * 1024 });
  return dest;
}

function launch(cwd, args, env = process.env) {
  const child = spawn(path.join(cwd, 'manager.sh'), args, { cwd: '/tmp', env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (data) => { stdout += data; });
  child.stderr.on('data', (data) => { stderr += data; });
  const result = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return { child, result };
}

async function command(cwd, ...args) {
  return launch(cwd, args).result;
}

async function success(cwd, ...args) {
  const result = await command(cwd, ...args);
  assert.equal(result.code, 0, `${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}

async function status(cwd, expected) {
  const result = await command(cwd, 'status', '--json');
  assert.equal(result.code, { healthy: 0, stopped: 3, starting: 2, unready: 2, failed: 1 }[expected], result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(value.state, expected);
  return value;
}

async function state(cwd) { return JSON.parse(await readFile(path.join(cwd, '.runtime/manager/state.json'), 'utf8')); }

async function until(fn, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await delay(150);
  }
  assert.fail(`Condition did not converge within ${timeout}ms (last: ${last}).`);
}

async function noOwnedProcesses(cwd, before) {
  if (before) {
    await until(async () => {
      const { stdout } = await exec('/bin/ps', ['-axww', '-o', 'pid=,lstart=,command='], { maxBuffer: 8 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } });
      return [before.supervisor, ...before.owned].filter(Boolean).every((item) => !stdout.split('\n').some((line) => line.trimStart().startsWith(`${item.pid} `) && line.includes(item.command)));
    }, 6000);
  }
  for (const port of [3001, 5173]) await portFree(port);
  assert.ok((await command(cwd, 'status', '--json')).code !== 0);
}

test('manager lifecycle with real Process Compose and applications', { timeout: 300000 }, async (t) => {
  for (const port of [3001, 5173]) await portFree(port);
  await mkdir(output, { recursive: true });
  const cwd = await fixture('primary');
  const original = await readFile(path.join(cwd, 'process-compose.yaml'), 'utf8');
  const neverReady = original.replace('path: /api/health', 'path: /api/never-ready');
  t.after(async () => {
    await writeFile(path.join(cwd, 'process-compose.yaml'), original);
    const result = await command(cwd, 'stop', '--json');
    assert.equal(result.code, 0, result.stderr);
    await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  });

  await t.test('clean bootstrap uses official download, preserves environment files, and reuses pinned tools', { timeout: 180000 }, async () => {
    const fresh = await fixture('fresh bootstrap', { install: false, tools: false });
    const secret = `local-fixture-${randomUUID()}`;
    const environment = `HOST=127.0.0.1\nPORT=3001\nPRIVATE_FIXTURE_VALUE=${secret}\n`;
    await writeFile(path.join(fresh, 'backend/.env'), environment);
    const manifest = await readFile(path.join(fresh, 'package.json'), 'utf8');
    const lock = await readFile(path.join(fresh, 'pnpm-lock.yaml'), 'utf8');
    const before = await command(fresh, 'doctor', '--json');
    assert.equal(before.code, 1);
    assert.equal(JSON.parse(before.stdout).ok, false);
    assert.ok(!before.stdout.includes(secret) && !before.stderr.includes(secret));
    const first = await success(fresh, 'bootstrap', '--json');
    assert.equal(first.tool, 'installed');
    assert.equal(first.servicesStarted, false);
    const binary = path.join(fresh, '.tools/process-compose', first.processCompose, 'process-compose');
    const stat = await lstat(binary);
    assert.equal((await success(fresh, 'bootstrap', '--json')).tool, 'reused');
    assert.equal((await lstat(binary)).mtimeMs, stat.mtimeMs);
    assert.equal(await readFile(path.join(fresh, 'backend/.env'), 'utf8'), environment);
    assert.equal(await readFile(path.join(fresh, 'package.json'), 'utf8'), manifest);
    assert.equal(await readFile(path.join(fresh, 'pnpm-lock.yaml'), 'utf8'), lock);
    const diagnostic = await success(fresh, 'doctor', '--json');
    assert.equal(diagnostic.ok, true);
    assert.ok(!JSON.stringify(diagnostic).includes(secret));
    const executable = await readFile(binary);
    const incorrectTool = '#!/bin/sh\nprintf "Version: v0.0.0\\n"\n';
    await writeFile(binary, incorrectTool);
    await chmod(binary, 0o755);
    assert.equal((await command(fresh, 'doctor', '--json')).code, 1);
    const refused = await command(fresh, 'bootstrap', '--json');
    assert.notEqual(refused.code, 0);
    assert.equal(await readFile(binary, 'utf8'), incorrectTool);
    await writeFile(binary, executable);
    await chmod(binary, 0o755);
    const shims = path.join(fresh, 'version-shim');
    await mkdir(shims);
    await writeFile(path.join(shims, 'pnpm'), '#!/bin/sh\nprintf "0.0.0\\n"\n');
    await chmod(path.join(shims, 'pnpm'), 0o755);
    assert.notEqual((await launch(fresh, ['bootstrap', '--json'], { ...process.env, PATH: `${shims}${path.delimiter}${process.env.PATH}` }).result).code, 0);
    for (const port of [3001, 5173]) await portFree(port);
    report.bootstrap_fresh_idempotent_environment = true;
  });

  await t.test('official checksum failure and interrupted download leave no installed tool or children', async () => {
    const broken = await fixture('failed bootstrap', { install: false, tools: false });
    const shim = path.join(broken, 'shim');
    await mkdir(shim);
    const script = `#!${process.execPath}\nconst fs=require('node:fs');\nconst args=process.argv.slice(2), url=args.at(-1), target=args[args.indexOf('-o')+1];\nif(process.env.ATOMS_FIXTURE_STALL){fs.writeFileSync(process.env.ATOMS_FIXTURE_STALL,String(process.pid));setInterval(()=>{},1000);}\nelse{let body;if(url.endsWith('/releases/v1.122.0'))body='{"tag_name":"v1.122.0"}';else if(url.endsWith('_checksums.txt'))body='${'0'.repeat(64)}  process-compose_${process.platform === 'darwin' ? 'darwin' : 'linux'}_${process.arch === 'arm64' ? 'arm64' : 'amd64'}.tar.gz\\n';else body='bad archive';fs.writeFileSync(target,body);process.stdout.write('200');}\n`;
    await writeFile(path.join(shim, 'curl'), script);
    await chmod(path.join(shim, 'curl'), 0o755);
    const env = { ...process.env, PATH: `${shim}${path.delimiter}${process.env.PATH}` };
    const bad = await launch(broken, ['bootstrap', '--json'], env).result;
    assert.notEqual(bad.code, 0);
    assert.match(bad.stderr, /Official installer failed/);
    assert.ok((await readFile(path.join(broken, '.runtime/setup/installer.log'), 'utf8')).includes('did not verify'));
    await assert.rejects(lstat(path.join(broken, '.tools/process-compose/1.122.0')));
    assert.ok(!(await readdir(path.join(broken, '.runtime/setup'))).some((name) => name.startsWith('install-')));
    const marker = path.join(broken, 'download-pid');
    const stalled = launch(broken, ['bootstrap', '--json'], { ...env, ATOMS_FIXTURE_STALL: marker });
    await until(async () => Boolean(await lstat(marker).catch(() => null)));
    const pid = Number(await readFile(marker, 'utf8'));
    stalled.child.kill('SIGTERM');
    assert.equal((await stalled.result).code, 143);
    await until(async () => !isAlive(pid));
    await assert.rejects(lstat(path.join(broken, '.tools/process-compose/1.122.0')));
    assert.ok(!(await readdir(path.join(broken, '.runtime/setup'))).some((name) => name.startsWith('install-')));
    report.bootstrap_checksum_and_cancel = true;
  });

  await t.test('help, invalid arguments, stopped status, and repeated stop from another cwd', async () => {
    assert.equal((await command(cwd, 'help')).code, 0);
    for (const args of [['unknown'], ['start', '--timeout', '0'], ['stop', '--timeout', '3']]) assert.notEqual((await command(cwd, ...args)).code, 0);
    await status(cwd, 'stopped');
    await success(cwd, 'stop', '--json');
    await success(cwd, 'stop', '--json');
    report.arguments = true;
  });

  await t.test('concurrent starts converge; repeated start preserves all PIDs; restart replaces one instance', async () => {
    const replies = await Promise.all([1, 2, 3].map(() => success(cwd, 'start', '--json')));
    const pids = replies[0].services.map((item) => item.pid);
    assert.ok(replies.every((reply) => JSON.stringify(reply.services.map((item) => item.pid)) === JSON.stringify(pids)));
    const before = await state(cwd);
    assert.ok(Buffer.byteLength(before.socket) < 100);
    assert.deepEqual((await success(cwd, 'start', '--json')).services.map((item) => item.pid), pids);
    const restarted = await success(cwd, 'restart', '--json');
    assert.ok(restarted.services.every((item) => !pids.includes(item.pid)));
    assert.notEqual((await state(cwd)).id, before.id);
    await status(cwd, 'healthy');
    report.idempotence_concurrency_deep_path = true;
  });

  await t.test('recovery is healthy despite prior exit code; concurrent mixed operations serialize', async () => {
    const before = await status(cwd, 'healthy');
    const backend = before.services.find((item) => item.name === 'backend');
    const { stdout } = await exec('/bin/ps', ['-p', String(backend.pid), '-o', 'pgid=']);
    assert.equal(Number(stdout.trim()), backend.pid);
    process.kill(-backend.pid, 'SIGKILL');
    const recovered = await until(async () => {
      const result = await command(cwd, 'status', '--json');
      if (result.code !== 0) return false;
      const value = JSON.parse(result.stdout);
      return value.services.find((item) => item.name === 'backend').pid !== backend.pid ? value : false;
    });
    report.recovery_prior_exit_code = recovered.services.find((item) => item.name === 'backend').exitCode;
    assert.equal(recovered.services.find((item) => item.name === 'frontend').pid, before.services.find((item) => item.name === 'frontend').pid);
    await Promise.all(['stop', 'start', 'restart', 'stop', 'start'].map((action) => success(cwd, action, '--json')));
    await success(cwd, 'start', '--json');
    await status(cwd, 'healthy');
    await success(cwd, 'stop', '--json');
    await noOwnedProcesses(cwd, await state(cwd).catch(() => null));
    report.mixed_operations = true;
  });

  await t.test('foreign HTTP-200 listeners on either application port are preserved', async () => {
    for (const port of [3001, 5173]) {
      const server = http.createServer((_req, response) => response.end('{"status":"ok","service":"atoms-backend"}'));
      await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
      try {
        const result = await command(cwd, 'start', '--json');
        assert.notEqual(result.code, 0);
        assert.match(result.stderr, /occupied|unavailable/);
        await success(cwd, 'stop', '--json');
        assert.equal((await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) })).status, 200);
        await portFree(port === 3001 ? 5173 : 3001);
      } finally { await new Promise((resolve) => server.close(resolve)); }
    }
    report.foreign_ports = true;
  });

  await t.test('readiness deadline rolls back; SIGTERM during startup also rolls back', async () => {
    await writeFile(path.join(cwd, 'process-compose.yaml'), neverReady);
    const started = Date.now();
    const result = await command(cwd, 'start', '--json', '--timeout', '2');
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /within 2s/);
    assert.ok(Date.now() - started < 15000);
    const failed = await state(cwd);
    await status(cwd, 'failed');
    await noOwnedProcesses(cwd, failed);
    await success(cwd, 'stop', '--json');
    const pending = launch(cwd, ['start', '--json', '--timeout', '30']);
    await until(async () => (await state(cwd).catch(() => null))?.owned.length > 3);
    const interruptedState = await state(cwd);
    assert.equal((await status(cwd, 'starting')).state, 'starting');
    pending.child.kill('SIGTERM');
    assert.equal((await pending.result).code, 143);
    await noOwnedProcesses(cwd, interruptedState);
    await success(cwd, 'stop', '--json');
    await writeFile(path.join(cwd, 'process-compose.yaml'), original);
    report.timeout_and_interrupt_rollback = true;
  });

  await t.test('SIGKILL of a startup caller recovers its stale upstream lock and owned instance', { timeout: 60000 }, async () => {
    await writeFile(path.join(cwd, 'process-compose.yaml'), neverReady);
    const pending = launch(cwd, ['start', '--json', '--timeout', '60']);
    await until(async () => (await state(cwd).catch(() => null))?.owned.length > 3);
    const before = await state(cwd);
    pending.child.kill('SIGKILL');
    assert.equal((await pending.result).signal, 'SIGKILL');
    const started = Date.now();
    await success(cwd, 'stop', '--json');
    assert.ok(Date.now() - started < 45000);
    await noOwnedProcesses(cwd, before);
    await writeFile(path.join(cwd, 'process-compose.yaml'), original);
    report.stale_lock_recovery = true;
  });

  await t.test('dead supervisor cleanup and stale PID protection', async () => {
    await success(cwd, 'start', '--json');
    const before = await state(cwd);
    process.kill(before.supervisor.pid, 'SIGKILL');
    await until(async () => !isAlive(before.supervisor.pid));
    await status(cwd, 'failed');
    await success(cwd, 'start', '--json');
    assert.notEqual((await state(cwd)).id, before.id);
    const next = await state(cwd);
    await success(cwd, 'stop', '--json');
    const foreign = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    try {
      next.supervisor.pid = foreign.pid;
      next.supervisor.start = 'stale identity';
      next.owned = [];
      await writeFile(path.join(cwd, '.runtime/manager/state.json'), JSON.stringify(next), { mode: 0o600 });
      await success(cwd, 'stop', '--json');
      assert.ok(isAlive(foreign.pid));
    } finally { foreign.kill(); }
    report.supervisor_crash_and_stale_pid = true;
  });

  await t.test('another checkout cannot stop this instance; unknown control socket is protected', async () => {
    const other = await fixture('secondary');
    await success(cwd, 'start', '--json');
    const before = await state(cwd);
    await success(other, 'stop', '--json');
    assert.notEqual((await command(other, 'start', '--json')).code, 0);
    assert.equal((await state(cwd)).id, before.id);
    await status(cwd, 'healthy');
    await success(cwd, 'stop', '--json');
    const socket = `/tmp/atoms-pc-${process.getuid()}-${createHash('sha256').update(cwd).digest('hex').slice(0, 20)}/control.sock`;
    let requests = 0;
    const server = http.createServer((_req, response) => { requests++; response.writeHead(401).end(); });
    await new Promise((resolve) => server.listen(socket, resolve));
    try {
      assert.notEqual((await command(cwd, 'start', '--json')).code, 0);
      assert.notEqual((await command(cwd, 'stop', '--json')).code, 0);
      const diagnosis = await command(cwd, 'doctor', '--json');
      assert.equal(diagnosis.code, 1);
      assert.ok(JSON.parse(diagnosis.stdout).checks.some((item) => item.name === 'instance' && item.status === 'error'));
      assert.equal(requests, 0);
    } finally { await new Promise((resolve) => server.close(resolve)); }
    report.checkout_and_socket_isolation = true;
  });

  await t.test('doctor detects bad versions/config/ports; live and saved logs stay scoped and follow cancellation preserves services', async () => {
    await writeFile(path.join(cwd, '.process-compose-version'), '0.0.0\n');
    const missing = await command(cwd, 'doctor', '--json');
    assert.equal(missing.code, 1);
    assert.ok(JSON.parse(missing.stdout).checks.some((item) => item.name === 'process-compose' && item.status === 'error'));
    await cp(path.join(root, '.process-compose-version'), path.join(cwd, '.process-compose-version'));
    await writeFile(path.join(cwd, '.nvmrc'), '0.0.0\n');
    assert.equal((await command(cwd, 'bootstrap', '--json')).code, 1);
    await cp(path.join(root, '.nvmrc'), path.join(cwd, '.nvmrc'));
    await writeFile(path.join(cwd, 'process-compose.yaml'), original.replace('command: node scripts/check-dev-port.cjs 3001', 'commnad: node scripts/check-dev-port.cjs 3001'));
    const invalid = await command(cwd, 'doctor', '--json');
    assert.equal(invalid.code, 1);
    assert.ok(JSON.parse(invalid.stdout).checks.some((item) => item.name === 'configuration' && item.status === 'error'));
    await writeFile(path.join(cwd, 'process-compose.yaml'), original);
    const foreign = http.createServer((_req, response) => response.end('foreign'));
    await new Promise((resolve) => foreign.listen(3001, '127.0.0.1', resolve));
    try { assert.equal((await command(cwd, 'doctor', '--json')).code, 1); }
    finally { await new Promise((resolve) => foreign.close(resolve)); }
    await success(cwd, 'start', '--json');
    const before = await state(cwd);
    const diagnostics = await success(cwd, 'doctor', '--json');
    assert.ok(diagnostics.ok);
    assert.ok(!JSON.stringify(diagnostics).includes(before.token));
    const instanceBeforeInfra = await readFile(path.join(cwd, '.runtime/manager/state.json'));
    const servicesBeforeInfra = (await status(cwd, 'healthy')).services.map(({ name, pid }) => ({ name, pid }));
    for (const action of ['start', 'stop', 'status']) {
      const result = await success(cwd, 'infra', action, '--json');
      assert.equal(result.state, 'not_configured');
      assert.equal(result.configured, false);
    }
    assert.deepEqual(await readFile(path.join(cwd, '.runtime/manager/state.json')), instanceBeforeInfra);
    assert.deepEqual((await status(cwd, 'healthy')).services.map(({ name, pid }) => ({ name, pid })), servicesBeforeInfra);
    report.empty_infra_preserves_running_apps = true;
    assert.notEqual((await command(cwd, 'bootstrap', '--json')).code, 0);
    const logs = await command(cwd, 'logs', 'backend', '--tail', '5');
    assert.equal(logs.code, 0, logs.stderr);
    assert.ok(logs.stdout.length > 0 && !logs.stdout.includes(before.token));
    assert.ok(!logs.stdout.includes('@atoms/frontend'));
    const combined = await command(cwd, 'logs', 'all', '--tail', '10');
    assert.equal(combined.code, 0, combined.stderr);
    assert.ok(combined.stdout.includes('[backend]') && combined.stdout.includes('[frontend]'));
    const frontend = await command(cwd, 'logs', 'frontend', '--tail', '10');
    assert.equal(frontend.code, 0, frontend.stderr);
    assert.ok(frontend.stdout.includes('5173'));
    for (const args of [['logs', '../state.json'], ['logs', 'backend', '--tail', '0']]) assert.notEqual((await command(cwd, ...args)).code, 0);
    const follower = launch(cwd, ['logs', 'all', '--tail', '1', '--follow']);
    await delay(700);
    follower.child.kill('SIGINT');
    assert.equal((await follower.result).code, 130);
    assert.equal((await state(cwd)).id, before.id);
    await status(cwd, 'healthy');
    await success(cwd, 'stop', '--json');
    const saved = await command(cwd, 'logs', 'backend', '--tail', '1');
    assert.equal(saved.code, 0, saved.stderr);
    assert.equal(saved.stdout.trim().split('\n').length, 1);
    assert.ok(saved.stdout.startsWith('[backend] '));
    const savedCombined = await command(cwd, 'logs', 'all', '--tail', '1');
    assert.equal(savedCombined.code, 0, savedCombined.stderr);
    assert.ok(savedCombined.stdout.includes('[backend]') && savedCombined.stdout.includes('[frontend]'));
    assert.notEqual((await command(cwd, 'logs', '--follow')).code, 0);
    const temporary = path.join(cwd, 'backend/.env');
    await writeFile(temporary, 'PRIVATE_FIXTURE=not-printed\n');
    assert.ok(!(await command(cwd, 'doctor', '--json')).stdout.includes('not-printed'));
    await rm(temporary);
    await mkdir(temporary);
    const invalidEnvironment = await command(cwd, 'doctor', '--json');
    assert.equal(invalidEnvironment.code, 1);
    assert.ok(JSON.parse(invalidEnvironment.stdout).checks.some((item) => item.name === 'environment:backend' && item.status === 'error'));
    await rm(temporary, { recursive: true });
    report.doctor_and_logs = true;
  });

  await t.test('unresponsive supervisor uses bounded, identity-checked forced teardown', { timeout: 50000 }, async () => {
    await success(cwd, 'start', '--json');
    const before = await state(cwd);
    process.kill(before.supervisor.pid, 'SIGSTOP');
    const started = Date.now();
    await success(cwd, 'stop', '--json');
    assert.ok(Date.now() - started < 40000);
    await noOwnedProcesses(cwd, before);
    report.forced_teardown = true;
  });
});
