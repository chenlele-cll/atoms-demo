import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import lockfile from 'proper-lockfile';

const exec = promisify(execFile);
const root = await realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const runtime = path.join(root, '.runtime/manager');
const stateFile = path.join(runtime, 'state.json');
const socketDir = `/tmp/atoms-pc-${process.getuid()}-${createHash('sha256').update(root).digest('hex').slice(0, 20)}`;
const socketPath = path.join(socketDir, 'control.sock');
const config = path.join(root, 'process-compose.yaml');
const services = [{ name: 'backend', port: 3001 }, { name: 'frontend', port: 5173 }];
const interrupted = new AbortController();
let signalCode = 0;
let compromised = false;
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(signal, () => { signalCode = code; interrupted.abort(); });
}
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const identity = (value) => object(value) && Number.isSafeInteger(value.pid) && value.pid > 1 && typeof value.start === 'string' && typeof value.command === 'string';
const matches = (a, b) => a && b && a.pid === b.pid && a.start === b.start && a.command === b.command;
const tokenPath = (state) => path.join(runtime, `${state.id}.token`);
const overlayPath = (state) => path.join(runtime, `${state.id}.yaml`);

async function exists(filename) {
  try { return await lstat(filename); } catch (err) { if (err.code === 'ENOENT') return null; throw err; }
}

async function privateDir(dirname) {
  await mkdir(dirname, { mode: 0o700 }).catch((err) => { if (err.code !== 'EEXIST') throw err; });
  const stat = await lstat(dirname);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid()) throw new Error(`Unsafe runtime directory: ${dirname}`);
  await chmod(dirname, 0o700);
}

async function save(state) {
  if (compromised) throw new Error('Manager lock lost; refusing further mutations.');
  const tmp = `${stateFile}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(state)}\n`, { mode: 0o600, flag: 'wx' });
  await rename(tmp, stateFile);
}

async function load() {
  const stat = await exists(stateFile);
  if (!stat) return null;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077)) throw new Error('Unsafe manager state file; refusing to use it.');
  if (stat.size > 1024 * 1024) throw new Error('Manager state file exceeds size limit.');
  let state;
  try { state = JSON.parse(await readFile(stateFile, 'utf8')); }
  catch (err) { throw new Error('Invalid manager state JSON; no processes were changed.', { cause: err }); }
  if (!object(state) || state.version !== 1 || state.root !== root || state.socket !== socketPath ||
      !/^[a-f0-9-]{36}$/.test(state.id) || !/^[a-f0-9]{64}$/.test(state.token) ||
      !['starting', 'running', 'failed'].includes(state.phase) || !Number.isFinite(state.createdAt) ||
      !Array.isArray(state.owned) || !state.owned.every(identity) ||
      !(state.supervisor === null || identity(state.supervisor))) throw new Error('Invalid or foreign manager state; no processes were changed.');
  if (state.supervisor && (!state.supervisor.command.includes(overlayPath(state)) || !state.supervisor.command.includes(socketPath))) throw new Error('Supervisor identity does not belong to this instance.');
  return state;
}

async function processes() {
  const { stdout } = await exec('/bin/ps', ['-axww', '-o', 'pid=,ppid=,lstart=,command='], { env: { ...process.env, LC_ALL: 'C' }, timeout: 2000, maxBuffer: 8 * 1024 * 1024 });
  return stdout.split('\n').flatMap((line) => {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\d\d:\d\d:\d\d\s+\d{4})\s+(.+)$/);
    return m ? [{ pid: Number(m[1]), parent: Number(m[2]), start: m[3].replace(/\s+/g, ' '), command: m[4] }] : [];
  });
}

function ownedProcesses(state, rows) {
  const known = [state.supervisor, ...state.owned].filter(Boolean);
  const owned = new Set(rows.filter((row) => known.some((item) => matches(item, row))).map((row) => row.pid));
  for (let count = 0; count < rows.length; count++) {
    const next = rows.filter((row) => owned.has(row.parent) && !owned.has(row.pid));
    if (!next.length) break;
    for (const row of next) owned.add(row.pid);
  }
  return rows.filter((row) => owned.has(row.pid));
}

function request(options, timeout = 1500) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (part) => {
        body += part;
        if (body.length > 1024 * 1024) req.destroy(new Error('Response exceeds manager limit.'));
      });
      response.on('error', reject);
      response.on('end', () => response.statusCode === 200 ? resolve(body) : reject(new Error(`HTTP ${response.statusCode} from ${options.path}`)));
    });
    const timer = setTimeout(() => req.destroy(new Error('Manager request timed out.')), timeout);
    req.once('close', () => clearTimeout(timer));
    req.once('error', reject);
    req.end();
  });
}

async function control(state, endpoint, method = 'GET') {
  return JSON.parse(await request({ socketPath, path: endpoint, method, headers: { 'X-PC-Token-Key': state.token } }));
}

async function authenticated(state) {
  try {
    const project = await control(state, '/project/name');
    if (!object(project) || typeof project.projectName !== 'string' || path.posix.basename(project.projectName) !== `atoms-${state.id}`) throw new Error('Control socket belongs to another instance.');
    return true;
  } catch (err) {
    if (['ENOENT', 'ECONNREFUSED'].includes(err.code)) return false;
    throw err;
  }
}

async function inspect(state) {
  if (!state) {
    if (await exists(socketPath)) throw new Error('Unowned control socket exists; refusing to adopt or remove it.');
    return { state: 'stopped', services: [] };
  }
  const rows = await processes();
  const owned = ownedProcesses(state, rows);
  const supervisor = rows.find((row) => matches(state.supervisor, row));
  if (!supervisor) return { state: state.phase === 'failed' || owned.length ? 'failed' : 'stopped', reason: state.reason ?? (owned.length ? 'Supervisor exited; owned children remain.' : undefined), services: [], owned };
  if (!await authenticated(state)) return { state: state.phase === 'starting' ? 'starting' : 'failed', reason: 'Control socket unavailable.', services: [], owned };
  const response = await control(state, '/processes');
  if (!object(response) || !Array.isArray(response.data)) throw new Error('Invalid Process Compose states response.');
  const list = services.map(({ name, port }) => {
    const row = response.data.find((item) => object(item) && item.name === name);
    if (!row || typeof row.status !== 'string' || typeof row.is_running !== 'boolean' || typeof row.is_ready !== 'string' || !Number.isSafeInteger(row.pid) || !Number.isInteger(row.restarts) || !Number.isInteger(row.exit_code)) throw new Error(`Invalid state for ${name}.`);
    return { name, port, pid: row.pid, status: row.status, ready: row.is_ready, running: row.is_running, restarts: row.restarts, exitCode: row.exit_code };
  });
  const stopped = list.some((item) => !item.running && ['Completed', 'Failed', 'Error'].includes(item.status));
  let healthy = list.every((item) => item.running && item.status === 'Running' && item.ready === 'Ready' && owned.some((row) => row.pid === item.pid));
  let reason;
  if (healthy) {
    try {
      const ports = await Promise.all(list.map((item) => control(state, `/process/ports/${item.name}`)));
      healthy = ports.every((item, index) => object(item) && Array.isArray(item.tcp_ports) && item.tcp_ports.includes(list[index].port));
      if (!healthy) reason = 'Managed processes do not own the expected listening ports.';
      const results = await Promise.all([
        request({ host: '127.0.0.1', port: 3001, path: '/api/health' }),
        request({ host: '127.0.0.1', port: 5173, path: '/api/health' }),
        request({ host: '127.0.0.1', port: 5173, path: '/' }),
      ]);
      const health = results.slice(0, 2).map((text) => JSON.parse(text));
      healthy &&= health.every((item) => object(item) && item.status === 'ok' && item.service === 'atoms-backend') && results[2].includes('<div id="root">');
      if (!healthy) reason ??= 'Application response or proxy contract not ready.';
    } catch { healthy = false; reason = 'Application or port ownership check unavailable.'; }
  }
  return { state: healthy ? 'healthy' : stopped ? 'failed' : state.phase === 'starting' ? 'starting' : 'unready', reason, services: list, owned };
}

async function lock() {
  const deadline = Date.now() + 75000;
  while (true) {
    interrupted.signal.throwIfAborted();
    try {
      return await lockfile.lock(runtime, { lockfilePath: path.join(runtime, 'operation.lock'), stale: 30000, update: 5000, retries: 0,
        onCompromised: () => { compromised = true; interrupted.abort(); } });
    } catch (err) {
      if (err.code !== 'ELOCKED') throw err;
      if (Date.now() >= deadline) throw new Error('Another manager operation is still busy (75s lock deadline).', { cause: err });
      await delay(250, undefined, { signal: interrupted.signal });
    }
  }
}

async function remember(state, owned) {
  const records = new Map(state.owned.map((row) => [`${row.pid}:${row.start}`, row]));
  for (const row of owned) if (row.pid !== state.supervisor?.pid) records.set(`${row.pid}:${row.start}`, row);
  state.owned = [...records.values()];
  await save(state);
}

async function signalOwned(state, signal) {
  const rows = ownedProcesses(state, await processes());
  // Stop the supervisor first on forced teardown so it cannot restart children.
  rows.sort((a, b) => Number(b.pid === state.supervisor?.pid) - Number(a.pid === state.supervisor?.pid));
  for (const row of rows) {
    if (compromised) throw new Error('Manager lock lost.');
    if (!(await processes()).some((current) => matches(current, row))) continue;
    try { process.kill(row.pid, signal); } catch (err) { if (err.code !== 'ESRCH') throw err; }
  }
}

async function teardown(state) {
  if (!state) { await inspect(null); return; }
  let owned = ownedProcesses(state, await processes());
  await remember(state, owned);
  let reachable = false;
  try { reachable = await authenticated(state); }
  catch (err) { if (!owned.length) throw err; }
  if (reachable) {
    await control(state, '/project/stop', 'POST').catch(() => {});
  }
  const supervisor = (await processes()).find((row) => matches(state.supervisor, row));
  if (supervisor) { try { process.kill(supervisor.pid, 'SIGTERM'); } catch (err) { if (err.code !== 'ESRCH') throw err; } }
  // If the supervisor already died, its children still have recorded identities.
  if (!supervisor) await signalOwned(state, 'SIGTERM');
  const deadline = Date.now() + 25000;
  while ((owned = ownedProcesses(state, await processes())).length && Date.now() < deadline) await delay(200);
  if (owned.length) {
    await remember(state, owned);
    await signalOwned(state, 'SIGKILL');
    const forcedDeadline = Date.now() + 5000;
    while ((owned = ownedProcesses(state, await processes())).length && Date.now() < forcedDeadline) await delay(100);
    if (owned.length) throw new Error('Owned processes remain after stop; state retained for recovery.');
  }
  if (await authenticated(state)) throw new Error('Control endpoint still active after stop; state retained.');
  await rm(socketPath, { force: true });
  await rm(tokenPath(state), { force: true });
  await rm(overlayPath(state), { force: true });
}

async function preflight() {
  if (!['darwin', 'linux'].includes(process.platform)) throw new Error('Manager requires macOS or Linux.');
  const expectedNode = (await readFile(path.join(root, '.nvmrc'), 'utf8')).trim();
  if (process.versions.node !== expectedNode) throw new Error(`Use Node ${expectedNode} from .nvmrc (current ${process.versions.node}).`);
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const { stdout } = await exec('pnpm', ['--version'], { cwd: root, timeout: 5000 });
  if (`pnpm@${stdout.trim()}` !== pkg.packageManager) throw new Error(`Use ${pkg.packageManager}.`);
  const version = (await readFile(path.join(root, '.process-compose-version'), 'utf8')).trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid .process-compose-version.');
  const binary = path.join(root, '.tools/process-compose', version, 'process-compose');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PC_')));
  const result = await exec(binary, ['--log-file', path.join(runtime, 'validation.log'), 'version'], { cwd: root, env, timeout: 5000 }).catch(() => { throw new Error(`Install Process Compose ${version}; see docs/engineering/lifecycle.md.`); });
  if (!new RegExp(`Version:\\s+v${version.replaceAll('.', '\\.')}(?:\\s|$)`).test(result.stdout)) throw new Error(`Process Compose must be ${version}.`);
  await exec(binary, ['--log-file', path.join(runtime, 'validation.log'), 'up', '-f', config, '--disable-dotenv', '--dry-run'], { cwd: root, env, timeout: 5000 });
  return { binary, env, hash: createHash('sha256').update(await readFile(config)).digest('hex') };
}

async function freePorts() {
  for (const { port } of services) {
    await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', () => reject(new Error(`Port ${port} is occupied or unavailable; its owner was not changed.`)));
      server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(resolve));
    });
  }
}

async function waitReady(state, seconds) {
  const deadline = Date.now() + seconds * 1000;
  let result;
  while (Date.now() < deadline) {
    interrupted.signal.throwIfAborted();
    result = await inspect(state);
    await remember(state, result.owned ?? []);
    if (result.state === 'healthy') { state.phase = 'running'; await save(state); return result; }
    if (result.state === 'stopped' || result.state === 'failed') throw new Error(result.reason ?? 'A managed process failed.');
    await delay(250, undefined, { signal: interrupted.signal });
  }
  throw new Error(`Startup did not become healthy within ${seconds}s (${result?.state ?? 'unknown'}).`);
}

async function start(seconds) {
  const tools = await preflight();
  let state = await load();
  if (state) {
    const current = await inspect(state);
    if (state.configHash !== tools.hash && current.state === 'healthy') throw new Error('Process configuration changed; use restart to apply it.');
    if (current.state === 'healthy') { state.phase = 'running'; delete state.reason; await remember(state, current.owned); return current; }
    if (state.phase !== 'failed' && (await processes()).some((row) => matches(state.supervisor, row))) {
      try { return await waitReady(state, seconds); }
      catch (err) { await rollback(state, err); throw err; }
    }
    await teardown(state);
    await rm(stateFile, { force: true });
  } else { await inspect(null); }
  await freePorts();
  interrupted.signal.throwIfAborted();
  state = { version: 1, root, socket: socketPath, id: randomUUID(), token: randomBytes(32).toString('hex'), phase: 'starting', createdAt: Date.now(), configHash: tools.hash, supervisor: null, owned: [] };
  await save(state);
  try {
    await writeFile(tokenPath(state), state.token, { mode: 0o600, flag: 'wx' });
    await writeFile(overlayPath(state), `name: atoms-${state.id}\n`, { mode: 0o600, flag: 'wx' });
    const output = await open(path.join(runtime, 'console.log'), 'a', 0o600);
    let child;
    try {
      child = spawn(tools.binary, ['--log-file', path.join(runtime, 'supervisor.log'), '--unix-socket', socketPath, '--token-file', tokenPath(state), 'up', '-f', config, '-f', overlayPath(state), '--disable-dotenv', '-t=false', '--keep-project'], { cwd: root, env: tools.env, detached: true, stdio: ['ignore', output.fd, output.fd] });
      await once(child, 'spawn');
      const row = (await processes()).find((item) => item.pid === child.pid);
      if (!row) throw new Error('Process Compose exited before identity could be recorded.');
      state.supervisor = row;
      await save(state);
      child.unref();
    } finally { await output.close(); }
    return await waitReady(state, seconds);
  } catch (err) { await rollback(state, err); throw err; }
}

async function rollback(state, err) {
  if (compromised) return;
  try {
    await teardown(state);
    state.supervisor = null;
    state.owned = [];
  } catch (cleanup) { err.message += ` Rollback incomplete: ${cleanup.message}`; }
  state.phase = 'failed';
  state.reason = signalCode ? 'Startup interrupted.' : err.message;
  await save(state);
}

async function stop() {
  const state = await load();
  await teardown(state);
  await rm(stateFile, { force: true });
  return { state: 'stopped', services: [] };
}

async function logs(opts) {
  const state = await load();
  const selected = opts.service === 'all' ? services.map((item) => item.name) : [opts.service];
  const redact = (text) => state?.token ? text.replaceAll(state.token, '[REDACTED]') : text;
  const active = state && (await processes()).some((row) => matches(state.supervisor, row)) && await authenticated(state);
  if (!active) {
    if (opts.follow) throw new Error('Cannot follow a stopped instance; use logs without --follow for saved application output.');
    const filename = path.join(root, '.runtime/process-compose/processes.log');
    const info = await exists(filename);
    if (!info?.isFile() || info.isSymbolicLink()) throw new Error('No saved application log is available.');
    const lines = createInterface({ input: createReadStream(filename), crlfDelay: Infinity });
    const tail = new Map(selected.map((name) => [name, []]));
    for await (const text of lines) {
      interrupted.signal.throwIfAborted();
      let record;
      try { record = JSON.parse(text); } catch { continue; }
      if (!object(record) || typeof record.message !== 'string' || !tail.has(record.process)) continue;
      const list = tail.get(record.process);
      list.push(record.message);
      if (list.length > opts.tail) list.shift();
    }
    for (const [name, list] of tail) for (const text of list) console.log(`[${name}] ${redact(text)}`);
    return;
  }
  const version = (await readFile(path.join(root, '.process-compose-version'), 'utf8')).trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid .process-compose-version.');
  const binary = path.join(root, '.tools/process-compose', version, 'process-compose');
  interrupted.signal.throwIfAborted();
  const clients = new Map();
  let failure = 0;
  const cancel = () => {
    for (const [child, record] of clients) {
      child.kill(signalCode === 130 ? 'SIGINT' : 'SIGTERM');
      record.forced ??= setTimeout(() => child.kill('SIGKILL'), 2000);
    }
  };
  interrupted.signal.addEventListener('abort', cancel, { once: true });
  const readService = async (name) => {
    const args = ['--log-file', path.join(runtime, `${name}-logs-client.log`), '--unix-socket', socketPath, '--token-file', tokenPath(state), 'process', 'logs', name, '--tail', String(opts.tail)];
    if (opts.follow) args.push('--follow');
    const child = spawn(binary, args, { cwd: root, env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PC_'))), stdio: ['ignore', 'pipe', 'pipe'] });
    const record = {};
    clients.set(child, record);
    const timer = opts.follow ? null : setTimeout(() => { failure = 1; cancel(); console.error(`Application log request timed out: ${name}.`); }, 10000);
    const pump = async (input, output) => {
      const reader = createInterface({ input, crlfDelay: Infinity });
      for await (const text of reader) output.write(`${selected.length > 1 ? `[${name}] ` : ''}${redact(text)}\n`);
    };
    try {
      const [exit] = await Promise.all([once(child, 'close'), pump(child.stdout, process.stdout), pump(child.stderr, process.stderr)]);
      if (!signalCode && (exit[0] !== 0 || exit[1])) { failure = 1; cancel(); }
    } catch (err) { failure = 1; cancel(); throw err; }
    finally { clearTimeout(timer); clearTimeout(record.forced); clients.delete(child); }
  };
  try {
    // Separate native subscriptions avoid truncation observed in multi-service snapshots.
    const results = await Promise.allSettled(selected.map(readService));
    const rejected = results.find((item) => item.status === 'rejected');
    if (rejected) throw rejected.reason;
    process.exitCode = signalCode || failure;
  } finally { interrupted.signal.removeEventListener('abort', cancel); }
}

function options(args) {
  const [command = 'help', ...rest] = args;
  if (!['start', 'stop', 'restart', 'status', 'logs', 'help', '--help'].includes(command)) throw new Error('Usage: ./manager.sh <bootstrap|doctor|start|stop|restart|status|logs>; use help for options.');
  if (command === 'logs') {
    const opts = { command, service: 'all', tail: 50, follow: false };
    for (let i = 0; i < rest.length; i++) {
      if (['backend', 'frontend', 'all'].includes(rest[i]) && i === 0) opts.service = rest[i];
      else if (rest[i] === '--follow' && !opts.follow) opts.follow = true;
      else if (rest[i] === '--tail' && /^\d+$/.test(rest[i + 1] ?? '') && Number(rest[i + 1]) >= 1 && Number(rest[i + 1]) <= 1000) opts.tail = Number(rest[++i]);
      else throw new Error('Usage: ./manager.sh logs [backend|frontend|all] [--tail 1..1000] [--follow]');
    }
    return opts;
  }
  let json = false;
  let seconds = 30;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--json' && !json) json = true;
    else if (rest[i] === '--timeout' && ['start', 'restart'].includes(command) && /^\d+$/.test(rest[i + 1] ?? '') && Number(rest[i + 1]) >= 1 && Number(rest[i + 1]) <= 120) seconds = Number(rest[++i]);
    else throw new Error('Invalid manager option; use ./manager.sh help.');
  }
  return { command, json, seconds };
}

async function main() {
  const opts = options(process.argv.slice(2));
  if (['help', '--help'].includes(opts.command)) {
    console.log('Usage: ./manager.sh <bootstrap|doctor|start|stop|restart|status> [--json]\nstart/restart: --timeout 1..120 (seconds, default 30)\nlogs [backend|frontend|all] [--tail 1..1000] [--follow]\nstatus exits: 0 healthy, 3 stopped, 2 starting/unready, 1 failed\nbootstrap requires the pinned Node/pnpm, runs the official tool installer and frozen install.');
    return;
  }
  for (const dirname of [path.join(root, '.runtime'), runtime, socketDir, path.join(root, '.runtime/process-compose')]) await privateDir(dirname);
  if (opts.command === 'logs') { await logs(opts); return; }
  let result;
  if (opts.command === 'status') {
    result = await inspect(await load());
    process.exitCode = { healthy: 0, stopped: 3, starting: 2, unready: 2, failed: 1 }[result.state];
  } else {
    const release = await lock();
    try {
      interrupted.signal.throwIfAborted();
      if (opts.command === 'restart') await stop();
      result = opts.command === 'stop' ? await stop() : await start(opts.seconds);
    } finally { if (!compromised) await release(); }
  }
  const publicResult = { state: result.state, services: result.services, ...(result.reason ? { reason: result.reason } : {}) };
  if (opts.json) console.log(JSON.stringify(publicResult));
  else {
    console.log(`Atoms: ${result.state}${result.reason ? ` (${result.reason})` : ''}`);
    for (const item of result.services) console.log(`  ${item.name}: ${item.status} / ${item.ready} (pid ${item.pid}, restarts ${item.restarts})`);
  }
}

main().catch((err) => {
  console.error(signalCode ? 'Manager command interrupted.' : `Manager: ${err.message}`);
  process.exitCode = signalCode || 1;
});
