import { cp, mkdir, rename, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = fileURLToPath(new URL('.', import.meta.url));
const stage = path.join(directory, `.build-${randomUUID()}`);
const previous = path.join(directory, `.previous-${randomUUID()}`);
const dist = path.join(directory, 'dist'); let held = false;
try {
  const assets = path.join(directory, 'src/template-assets'); await mkdir(assets, { recursive: true });
  for (const name of ['bundle.mjs', 'bundle.d.mts']) await cp(path.join(root, 'templates', name), path.join(assets, name));
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', path.join(directory, 'tsconfig.json'), '--outDir', stage], { stdio: 'inherit' });
    child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error('Contract build failed')));
  });
  await cp(assets, path.join(stage, 'template-assets'), { recursive: true });
  try { await rename(dist, previous); held = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { await rename(stage, dist); } catch (error) { if (held) { await rename(previous, dist); held = false; } throw error; }
  if (held) await rm(previous, { recursive: true });
} finally { await rm(stage, { recursive: true, force: true }); }
