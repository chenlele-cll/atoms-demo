import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import lockfile from 'proper-lockfile';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, 'packages/contracts');
const deadline = Date.now() + 60_000;
let interrupted; let child;
function stop(signal) {
  interrupted = signal;
  if (child?.pid) try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop(signal));
async function files(folder) {
  const list = [];
  for (const item of (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (['template-assets', 'node_modules', 'dist'].includes(item.name)) continue;
    const filename = path.join(folder, item.name);
    if (item.isDirectory()) list.push(...await files(filename)); else if (item.isFile()) list.push(filename); else throw new Error('Unexpected contract source');
  } return list;
}
await mkdir(path.join(root, '.runtime'), { recursive: true });
let compromised = false;
let release;
while (!release && !interrupted && Date.now() < deadline) {
  try { release = await lockfile.lock(directory, { lockfilePath: path.join(root, '.runtime/contracts.lock'), stale: 70_000, update: 5000, retries: 0, onCompromised: () => { compromised = true; stop('SIGTERM'); } }); }
  catch (error) { if (error.code !== 'ELOCKED') throw error; await delay(250); }
}
if (!release) { process.exitCode = interrupted === 'SIGINT' ? 130 : interrupted ? 143 : 1; throw new Error('Contract preparation could not acquire ownership'); }
try {
  if (interrupted || Date.now() >= deadline) throw new Error('Contract preparation timed out');
  const input = [...await files(path.join(directory, 'src')), path.join(directory, 'package.json'), path.join(directory, 'tsconfig.json'),
    path.join(directory, 'build.mjs'), path.join(root, 'tsconfig.base.json'), path.join(root, 'pnpm-lock.yaml'),
    path.join(root, 'templates/bundle.mjs'), path.join(root, 'templates/bundle.d.mts')];
  const digest = createHash('sha256');
  for (const filename of input) digest.update(path.relative(root, filename)).update(await readFile(filename));
  const key = digest.digest('hex'); const marker = path.join(directory, 'dist/.prepared.json');
  let valid = false;
  try {
    const saved = JSON.parse(await readFile(marker, 'utf8'));
    valid = saved.input === key && saved.outputs.length > 0;
    for (const item of saved.outputs) {
      if (typeof item.path !== 'string' || item.path.includes('..') || path.isAbsolute(item.path)) { valid = false; break; }
      if (createHash('sha256').update(await readFile(path.join(directory, 'dist', item.path))).digest('hex') !== item.digest) valid = false;
    }
  } catch { valid = false; }
  if (!valid) {
    await new Promise((resolve, reject) => {
      child = spawn(process.execPath, [path.join(directory, 'build.mjs')], { stdio: 'inherit', detached: true });
      const timer = setTimeout(() => stop('SIGTERM'), Math.max(1, deadline - Date.now()));
      child.once('error', error => { clearTimeout(timer); child = undefined; reject(error); });
      child.once('close', code => { clearTimeout(timer); child = undefined; code === 0 && !compromised ? resolve() : reject(new Error('Contract preparation failed')); });
    });
    const outputFiles = [];
    async function collect(folder, prefix = '') {
      for (const item of await readdir(folder, { withFileTypes: true })) {
        const relative = path.posix.join(prefix, item.name);
        if (item.isDirectory()) await collect(path.join(folder, item.name), relative);
        else if (item.isFile() && item.name !== '.prepared.json') outputFiles.push({ path: relative,
          digest: createHash('sha256').update(await readFile(path.join(folder, item.name))).digest('hex') });
      }
    }
    await collect(path.join(directory, 'dist'));
    await stat(path.join(directory, 'dist/index.js')); await stat(path.join(directory, 'dist/index.d.ts'));
    await writeFile(marker, JSON.stringify({ input: key, outputs: outputFiles }));
  }
  if (compromised || interrupted) throw new Error('Contract preparation ownership lost');
} catch (error) {
  process.exitCode = interrupted === 'SIGINT' ? 130 : interrupted ? 143 : 1;
  throw error;
} finally { if (!compromised) await release(); }
