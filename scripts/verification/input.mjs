import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import lockfile from 'proper-lockfile';
import { sha256, inside } from './primitives.mjs';
export { sha256, inside } from './primitives.mjs';
const exec = promisify(execFile);
const rootFiles = new Set(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.nvmrc', '.process-compose-version', '.editorconfig', '.gitignore', 'tsconfig.base.json', 'eslint.config.mjs', 'postcss.config.cjs', 'tailwind.config.cjs', 'process-compose.yaml', 'manager.sh', 'README.md']);
export function allowedInput(name) {
  if (typeof name !== 'string' || name.includes('\\') || name.startsWith('/') || name.split('/').some(part => !part || part === '..' || part === '.')) return false;
  const parts = name.split('/');
  const templateSourceData = /^templates\/[a-z0-9-]+\/src\/data(?:\/|$)/.test(name);
  if (parts.some(part => ['.git', 'node_modules', 'dist', '.runtime', '.tools', 'test-results', 'template-assets', 'coverage'].includes(part) || (part === 'data' && !templateSourceData) || /^(?:\.build-|\.previous-|\.env(?!\.example$))/.test(part))) return false;
  if (/\.(?:sqlite|db)(?:-.*)?$|\.(?:pem|key|p12)$|(?:credentials|storageState|auth-state)/i.test(name)) return false;
  return rootFiles.has(name) || name === 'deploy/nginx.conf.template' || /^(?:frontend|backend|packages|templates|scripts)\//.test(name) || name.startsWith('.github/workflows/');
}
export function cleanEnvironment(input = process.env) {
  const result = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'CI', 'PNPM_HOME', 'XDG_CACHE_HOME']) if (typeof input[key] === 'string') result[key] = input[key];
  result.NO_COLOR = '1'; result.GIT_TERMINAL_PROMPT = '0';
  return result;
}
export async function gitInputs(root) {
  const { stdout } = await exec('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024, timeout: 10_000, env: cleanEnvironment() });
  return [...new Set(stdout.toString('utf8').split('\0').filter(allowedInput))].sort();
}
export async function safePath(root, relative) {
  if (typeof relative !== 'string' || relative.includes('\\') || path.isAbsolute(relative) || relative.split('/').some(part => !part || part === '..' || part === '.')) throw new Error('UNSAFE_PATH');
  const base = await realpath(root); const target = path.resolve(base, relative);
  if (!inside(base, target)) throw new Error('UNSAFE_PATH');
  let current = base;
  for (const part of relative.split('/')) { current = path.join(current, part); const info = await lstat(current); if (info.isSymbolicLink()) throw new Error('UNSAFE_PATH'); }
  return target;
}
export async function manifest(root, names = undefined) {
  const base = await realpath(root); const files = names ?? await gitInputs(base); const entries = [];
  for (const name of files) {
    if (!allowedInput(name)) throw new Error('UNSAFE_INPUT');
    const filename = path.join(base, name); const actual = await realpath(filename);
    if (!inside(base, actual) || !allowedInput(path.relative(base, actual).split(path.sep).join('/'))) throw new Error('UNSAFE_INPUT');
    const stat = await lstat(filename); const targetStat = await lstat(actual);
    if (!targetStat.isFile()) throw new Error('UNSAFE_INPUT');
    const data = await readFile(actual);
    entries.push({ path: name, digest: sha256(data), mode: targetStat.mode & 0o111 ? 0o755 : 0o644, ...(stat.isSymbolicLink() ? { target: path.relative(base, actual) } : {}) });
  }
  return { entries, digest: sha256(JSON.stringify(entries)) };
}
export async function copyInputs(root, destination, { afterCopy, select = allowedInput } = {}) {
  const selected = async () => (await gitInputs(root)).filter(select);
  const before = await manifest(root, await selected()); await mkdir(destination, { recursive: false, mode: 0o700 });
  for (const entry of before.entries) {
    const data = await readFile(path.join(root, entry.path)); if (sha256(data) !== entry.digest) throw new Error('STALE_INPUT');
    const target = path.join(destination, entry.path); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, data, { mode: entry.mode, flag: 'wx' });
  }
  await afterCopy?.();
  if ((await manifest(root, await selected())).digest !== before.digest) throw new Error('STALE_INPUT');
  const copied = await manifest(destination, before.entries.map(entry => entry.path));
  // Internal source symlinks are dereferenced, so compare bytes/mode rather than link metadata.
  if (copied.entries.some((entry, i) => entry.digest !== before.entries[i].digest || entry.mode !== before.entries[i].mode)) throw new Error('STALE_INPUT');
  return { ...before, copyDigest: copied.digest };
}
export async function copiedInputs(root, select = allowedInput) {
  const names = [];
  async function visit(prefix = '') {
    for (const item of await readdir(path.join(root, prefix), { withFileTypes: true })) {
      const name = path.posix.join(prefix, item.name);
      if (item.isDirectory()) {
        if ((!prefix && ['frontend', 'backend', 'packages', 'templates', 'scripts', '.github', 'deploy'].includes(item.name)) || allowedInput(name + '/file')) await visit(name);
      } else if (allowedInput(name) && select(name)) names.push(name);
    }
  }
  await visit(); return manifest(root, names.sort());
}
export async function assertInputs(root, copy, snapshot, { select = allowedInput } = {}) {
  if ((await manifest(root, (await gitInputs(root)).filter(select))).digest !== snapshot.digest || (await copiedInputs(copy, select)).digest !== snapshot.copyDigest) throw new Error('STALE_INPUT');
}
export async function buildIdentity(root) {
  const entries = [];
  async function visit(folder) {
    for (const name of (await readdir(path.join(root, folder))).sort()) {
      const relative = path.posix.join(folder, name); const filename = await safePath(root, relative); const stat = await lstat(filename);
      if (stat.isDirectory()) await visit(relative); else if (stat.isFile()) entries.push({ path: relative, digest: sha256(await readFile(filename)) }); else throw new Error('UNSAFE_BUILD');
    }
  }
  for (const folder of ['backend/dist', 'frontend/dist', 'packages/contracts/dist']) await visit(folder);
  if (!entries.length) throw new Error('MISSING_BUILD'); return { digest: sha256(JSON.stringify(entries)), entries };
}
export async function atomicJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 }); const temp = `${filename}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); await rename(temp, filename);
}
export async function freePorts(ports = [3001, 5173, 4173]) {
  for (const port of ports) await new Promise((resolve, reject) => {
    const server = net.createServer(); server.once('error', () => reject(new Error('PORT_BUSY')));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(resolve));
  });
}
export async function acquireRunLock(root, onCompromised = () => {}) {
  const folder = path.join(root, '.runtime'); await mkdir(folder, { recursive: true, mode: 0o700 });
  if ((await lstat(folder)).isSymbolicLink()) throw new Error('UNSAFE_LOCK');
  const target = path.join(folder, 'verify');
  try { await lstat(target + '.lock'); throw new Error('VERIFY_BUSY'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { return await lockfile.lock(target, { realpath: false, retries: 0, stale: 86_400_000, update: 10_000, onCompromised }); }
  catch (error) { if (error.code === 'ELOCKED') throw new Error('VERIFY_BUSY', { cause: error }); throw error; }
}
