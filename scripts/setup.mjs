import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, chmod, copyFile, lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const runtime = path.join(root, '.runtime/setup');
const interrupted = new AbortController();
let signalCode = 0;
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.once(signal, () => { signalCode = code; interrupted.abort(); });
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PC_')));
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

async function exists(filename) {
  try { return await lstat(filename); } catch (err) { if (err.code === 'ENOENT') return null; throw err; }
}

async function privateDir(dirname) {
  await mkdir(dirname, { mode: 0o700 }).catch((err) => { if (err.code !== 'EEXIST') throw err; });
  const info = await lstat(dirname);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid()) throw new Error(`Unsafe setup directory: ${dirname}`);
  await chmod(dirname, 0o700);
}

async function prepare() {
  for (const dirname of [path.join(root, '.runtime'), runtime]) await privateDir(dirname);
}

function run(command, args, { timeout = 5000, env = cleanEnv(), cwd = root } = {}) {
  return new Promise((resolve, reject) => {
    interrupted.signal.throwIfAborted();
    const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let failure; let forced;
    const kill = () => {
      try { process.kill(-child.pid, 'SIGTERM'); } catch (err) { if (err.code !== 'ESRCH') failure = err; }
      forced ??= setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch (err) { if (err.code !== 'ESRCH') failure = err; } }, 500);
    };
    const abort = () => { failure = new Error('Setup interrupted.'); kill(); };
    interrupted.signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { failure = new Error(`Command exceeded ${timeout / 1000}s deadline.`); kill(); }, timeout);
    for (const [stream, isError] of [[child.stdout, false], [child.stderr, true]]) stream.on('data', (data) => {
      if (isError) stderr += data.toString(); else stdout += data.toString();
      if (stdout.length + stderr.length > 2 * 1024 * 1024) { failure = new Error('Command output exceeded limit.'); kill(); }
    });
    child.once('error', (err) => { failure = new Error(`Cannot execute ${path.basename(command)} (${err.code ?? 'failed'}).`); });
    child.once('close', (code) => {
      clearTimeout(timer); clearTimeout(forced); interrupted.signal.removeEventListener('abort', abort);
      if (failure) reject(failure); else resolve({ code, stdout, stderr });
    });
  });
}

async function versions() {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const node = (await readFile(path.join(root, '.nvmrc'), 'utf8')).trim();
  const pc = (await readFile(path.join(root, '.process-compose-version'), 'utf8')).trim();
  if (!/^\d+\.\d+\.\d+$/.test(node) || !/^\d+\.\d+\.\d+$/.test(pc) || !/^pnpm@\d+\.\d+\.\d+$/.test(pkg.packageManager)) throw new Error('Invalid project toolchain pins.');
  return { pkg, node, pc, binary: path.join(root, '.tools/process-compose', pc, 'process-compose') };
}

async function toolValid(details) {
  const info = await exists(details.binary);
  if (!info?.isFile() || info.isSymbolicLink()) return false;
  const result = await run(details.binary, ['--log-file', path.join(runtime, 'validation.log'), 'version']);
  return result.code === 0 && new RegExp(`Version:\\s+v${details.pc.replaceAll('.', '\\.')}(?:\\s|$)`).test(result.stdout);
}

async function bootstrap() {
  const details = await versions();
  if (process.versions.node !== details.node) throw new Error(`Use Node ${details.node} from .nvmrc (current ${process.versions.node}).`);
  if (!['darwin', 'linux'].includes(process.platform) || !['arm64', 'x64'].includes(process.arch)) throw new Error('Bootstrap supports macOS/Linux arm64 or x64.');
  const pnpm = await run('pnpm', ['--version']);
  if (pnpm.code !== 0 || `pnpm@${pnpm.stdout.trim()}` !== details.pkg.packageManager) throw new Error(`Install/use ${details.pkg.packageManager}; bootstrap does not change global tools.`);
  if (await exists(path.join(root, '.runtime/manager/state.json'))) throw new Error('Run ./manager.sh stop before bootstrap (an instance record exists).');
  await prepare();
  let installed = false;
  if (await exists(path.dirname(details.binary))) {
    if (!await toolValid(details) || !(await exists(path.join(path.dirname(details.binary), 'LICENSE')))?.isFile()) throw new Error('Existing Process Compose directory is incomplete or has the wrong version; it was not overwritten.');
  } else {
    await privateDir(path.join(root, '.tools'));
    await privateDir(path.join(root, '.tools/process-compose'));
    const stage = path.join(runtime, `install-${randomUUID()}`);
    await privateDir(stage);
    try {
      await privateDir(path.join(stage, 'tmp'));
      const result = await run('/bin/sh', [path.join(root, 'scripts/vendor/process-compose/get-pc.sh'), '-b', path.join(stage, 'bin'), `v${details.pc}`], { timeout: 120000, env: { ...cleanEnv(), TMPDIR: path.join(stage, 'tmp') } });
      await writeFile(path.join(runtime, 'installer.log'), result.stdout + result.stderr, { mode: 0o600 });
      if (result.code !== 0) throw new Error('Official installer failed; see .runtime/setup/installer.log. No tool directory was installed.');
      const candidate = { ...details, binary: path.join(stage, 'bin/process-compose') };
      if (!await toolValid(candidate)) throw new Error('Downloaded Process Compose does not match the pinned version.');
      await copyFile(path.join(root, 'scripts/vendor/process-compose/LICENSE'), path.join(stage, 'bin/LICENSE'));
      try { await rename(path.join(stage, 'bin'), path.dirname(details.binary)); installed = true; }
      catch (err) {
        if (!['EEXIST', 'ENOTEMPTY'].includes(err.code) || !await toolValid(details) || !(await exists(path.join(path.dirname(details.binary), 'LICENSE')))?.isFile()) throw err;
      }
    } finally { await rm(stage, { recursive: true, force: true }); }
  }
  const dependencies = await run('pnpm', ['install', '--frozen-lockfile'], { timeout: 180000 });
  await writeFile(path.join(runtime, 'dependencies.log'), dependencies.stdout + dependencies.stderr, { mode: 0o600 });
  if (dependencies.code !== 0) throw new Error('Frozen dependency installation failed; see .runtime/setup/dependencies.log.');
  return { ok: true, processCompose: details.pc, tool: installed ? 'installed' : 'reused', dependencies: 'frozen install complete', servicesStarted: false };
}

async function available(name) {
  for (const dirname of (process.env.PATH ?? '').split(path.delimiter)) {
    try { await access(path.join(dirname, name), constants.X_OK); return true; } catch { /* Try next PATH entry. */ }
  }
  return false;
}

async function free(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

async function doctor() {
  const details = await versions();
  const checks = [];
  const add = (name, ok, detail, action, warning = false) => checks.push({ name, status: ok ? 'ok' : warning ? 'warn' : 'error', detail, ...(!ok && action ? { action } : {}) });
  add('platform', ['darwin', 'linux'].includes(process.platform) && ['arm64', 'x64'].includes(process.arch), `${process.platform}/${process.arch}`, 'Use supported POSIX macOS/Linux tooling.');
  add('node', process.versions.node === details.node, `expected ${details.node}; current ${process.versions.node}`, 'Select the Node version in .nvmrc.');
  let pnpmOk = false;
  try {
    const result = await run('pnpm', ['--version']);
    pnpmOk = result.code === 0 && `pnpm@${result.stdout.trim()}` === details.pkg.packageManager;
  } catch { /* Report through the check below. */ }
  add('pnpm', pnpmOk, `required ${details.pkg.packageManager}`, 'Install/select the pinned pnpm version.');
  let dependenciesOk = true;
  for (const scope of ['', 'frontend', 'backend']) {
    const pkg = JSON.parse(await readFile(path.join(root, scope, 'package.json'), 'utf8'));
    const missing = [];
    for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
      try {
        const installed = JSON.parse(await readFile(path.join(root, scope, 'node_modules', name, 'package.json'), 'utf8'));
        if (installed.name !== name || (/^\d+\.\d+\.\d+(?:-.*)?$/.test(version) && installed.version !== version)) missing.push(name);
      } catch { missing.push(name); }
    }
    dependenciesOk &&= missing.length === 0;
    add(`dependencies:${scope || 'root'}`, !missing.length, missing.length ? `missing/mismatched: ${missing.join(', ')}` : 'Declared dependencies present; exact pins match.', 'Run bootstrap; frozen install validates the lockfile.');
  }
  add('lockfile', Boolean(await exists(path.join(root, 'pnpm-lock.yaml'))), 'One workspace lockfile is required.', 'Restore the repository lockfile.');
  if (pnpmOk) {
    let workspace = false;
    try {
      const result = await run('pnpm', ['-r', 'list', '--depth=-1', '--json']);
      const members = JSON.parse(result.stdout);
      workspace = result.code === 0 && Array.isArray(members) && ['frontend', 'backend'].every((scope) => members.some((item) => object(item) && item.path === path.join(root, scope)));
    } catch { /* Diagnostic below. */ }
    add('workspace', workspace, 'frontend and backend must be pnpm workspace members.', 'Check pnpm-workspace.yaml.');
  }
  let pcOk = false;
  try { await prepare(); pcOk = await toolValid(details); } catch { /* Diagnostic below. */ }
  add('process-compose', pcOk, `required ${details.pc}`, 'Run bootstrap; existing invalid tools are preserved for diagnosis.');
  if (!pcOk) {
    const download = await available('curl') || await available('wget');
    const hash = await available('shasum') || await available('sha256sum') || await available('gsha256sum');
    const utilities = (await Promise.all(['tar', 'mktemp', 'install'].map(available))).every(Boolean);
    add('installer-prerequisites', download && hash && utilities, 'Official installer needs curl/wget, SHA-256 tooling, tar, mktemp and install.', 'Install the missing POSIX utilities before bootstrap.');
  }
  if (pcOk) {
    const result = await run(details.binary, ['--log-file', path.join(runtime, 'validation.log'), 'up', '-f', path.join(root, 'process-compose.yaml'), '--disable-dotenv', '--dry-run']);
    await writeFile(path.join(runtime, 'configuration.log'), result.stdout + result.stderr, { mode: 0o600 });
    add('configuration', result.code === 0, 'Native strict configuration dry-run.', 'See .runtime/setup/configuration.log.');
  }
  for (const scope of ['frontend', 'backend']) {
    const filename = path.join(root, scope, '.env');
    let readable = true;
    if (await exists(filename)) { try { readable = (await stat(filename)).isFile(); await access(filename, constants.R_OK); } catch { readable = false; } }
    add(`environment:${scope}`, readable, !readable ? 'Optional environment path is not a readable regular file.' : await exists(filename) ? 'Optional environment file present; values were not read.' : 'No environment file; current defaults are available.', 'Make the optional application environment file readable.');
  }
  let instance = { state: 'stopped' };
  if (dependenciesOk || await exists(path.join(root, '.runtime/manager/state.json'))) {
    try {
      if (!dependenciesOk) throw new Error('Dependencies unavailable.');
      const result = await run(process.execPath, [path.join(root, 'scripts/manager.mjs'), 'status', '--json'], { timeout: 15000 });
      instance = JSON.parse(result.stdout);
      if (!object(instance) || typeof instance.state !== 'string') throw new Error('Invalid status.');
      add('instance', ['healthy', 'stopped'].includes(instance.state), `manager state: ${instance.state}`, 'Use status/logs; stop the failed instance before bootstrap.');
    } catch { add('instance', false, 'Manager state could not be verified; no processes were changed.', 'Restore dependencies or inspect status without deleting active runtime files.'); instance = { state: 'unknown' }; }
  }
  for (const port of [3001, 5173]) {
    const portOk = instance.state === 'healthy' || await free(port);
    add(`port:${port}`, portOk, portOk ? instance.state === 'healthy' ? 'Owned by the healthy manager instance.' : 'Available.' : 'Occupied or unavailable; no process was stopped.', 'Check manager status or the external port owner.');
  }
  add('browser:npx', await available('npx'), 'Optional for the Playwright skill.', 'Install npm/npx for interactive browser verification.', true);
  let chrome = false;
  if (process.platform === 'darwin') {
    try { await access('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', constants.X_OK); chrome = true; } catch { /* Optional check. */ }
  } else chrome = await available('google-chrome') || await available('google-chrome-stable');
  add('browser:chrome', chrome, 'Optional system Chrome for pnpm smoke.', 'Install Google Chrome before browser smoke verification.', true);
  return { ok: checks.every((item) => item.status !== 'error'), checks };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'infra') {
    const [action, ...options] = args;
    if (!['start', 'stop', 'status'].includes(action) || (options.length && (options.length !== 1 || options[0] !== '--json'))) throw new Error('Usage: ./manager.sh infra <start|stop|status> [--json]');
    // Real infrastructure belongs to INF-002; never report an unhandled config as empty.
    if (process.env.COMPOSE_FILE) throw new Error('COMPOSE_FILE is set; infrastructure integration requires INF-002. No infrastructure was changed.');
    for (const filename of ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml']) {
      if (await exists(path.join(root, filename))) throw new Error('Compose configuration detected; infrastructure integration requires INF-002. No infrastructure was changed.');
    }
    const result = { ok: true, action, state: 'not_configured', configured: false, services: [], message: '未配置外部基础设施' };
    console.log(options.includes('--json') ? JSON.stringify(result) : result.message);
    return;
  }
  if (!['bootstrap', 'doctor'].includes(command) || (args.length && (args.length !== 1 || args[0] !== '--json'))) throw new Error('Usage: ./manager.sh <bootstrap|doctor> [--json]');
  const result = command === 'bootstrap' ? await bootstrap() : await doctor();
  if (args.includes('--json')) console.log(JSON.stringify(result));
  else if (command === 'bootstrap') console.log(`Bootstrap complete: Process Compose ${result.processCompose} ${result.tool}; frozen dependencies installed. No services started.`);
  else for (const check of result.checks) console.log(`${check.status.toUpperCase()} ${check.name}: ${check.detail}${check.action ? ` ${check.action}` : ''}`);
  process.exitCode = result.ok ? 0 : 1;
}

main().catch((err) => { console.error(`Manager ${signalCode ? 'setup interrupted' : 'setup'}: ${err.message}`); process.exitCode = signalCode || 1; });
