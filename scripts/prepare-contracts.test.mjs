import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const exec = promisify(execFile); const root = fileURLToPath(new URL('../', import.meta.url));
test('clean frozen workspace prepares contracts independently, concurrently, after edits and output loss; failure gates both apps', { timeout: 60_000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'atoms shared contracts '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json']) await cp(path.join(root, name), path.join(directory, name));
  await mkdir(path.join(directory, 'scripts'));
  for (const name of ['prepare-contracts.mjs', 'prepare-company-template.mjs']) await cp(path.join(root, 'scripts', name), path.join(directory, 'scripts', name));
  await cp(path.join(root, 'templates'), path.join(directory, 'templates'), { recursive: true });
  for (const name of ['packages/contracts', 'frontend', 'backend']) await cp(path.join(root, name), path.join(directory, name), { recursive: true,
    filter: source => !['node_modules', 'dist', 'template-assets', 'data', '.env'].includes(path.basename(source)) && !path.basename(source).startsWith('.env.') && !/^\.(?:build|previous)-/.test(path.basename(source)) });
  await exec('pnpm', ['install', '--offline', '--frozen-lockfile', '--ignore-scripts'], { cwd: directory, timeout: 30_000 });
  const prepare = () => exec(process.execPath, [path.join(directory, 'scripts/prepare-contracts.mjs')], { cwd: '/tmp', timeout: 15_000 });
  await Promise.all([prepare(), prepare(), prepare()]);
  const dist = path.join(directory, 'packages/contracts/dist'); const marker = path.join(dist, '.prepared.json');
  const first = await stat(marker); await prepare(); assert.equal((await stat(marker)).mtimeMs, first.mtimeMs);
  assert.ok((await readFile(path.join(dist, 'index.d.ts'), 'utf8')).includes('versionReviewSchema'));
  const module = await import(pathToFileURL(path.join(dist, 'index.js')).href); assert.equal(module.idSchema.safeParse('not-uuid').success, false);
  await rm(path.join(dist, 'index.d.ts')); await prepare(); await stat(path.join(dist, 'index.d.ts'));
  const source = path.join(directory, 'packages/contracts/src/index.ts'); const content = await readFile(source, 'utf8');
  await writeFile(source, content + '\nexport const explicitPreparationFixture = 42;\n'); await prepare();
  assert.ok((await readFile(path.join(dist, 'index.js'), 'utf8')).includes('explicitPreparationFixture'));
  await rm(dist, { recursive: true });
  await exec('pnpm', ['--filter', '@atoms/backend', 'build'], { cwd: directory, timeout: 15_000 }); await stat(path.join(dist, 'index.js'));
  await rm(dist, { recursive: true });
  await exec('pnpm', ['--filter', '@atoms/frontend', 'build'], { cwd: directory, timeout: 15_000 }); await stat(path.join(dist, 'index.js'));
  await rm(dist, { recursive: true });
  await Promise.all(['@atoms/backend', '@atoms/frontend'].map(app => exec('pnpm', ['--filter', app, 'typecheck'], { cwd: directory, timeout: 15_000 })));
  const lastGood = await readFile(path.join(dist, 'index.js'));
  await writeFile(source, content + '\nexport const broken: string = 123;\n');
  await assert.rejects(prepare()); assert.deepEqual(await readFile(path.join(dist, 'index.js')), lastGood);
  for (const app of ['@atoms/backend', '@atoms/frontend']) {
    await assert.rejects(exec('pnpm', ['--filter', app, 'dev'], { cwd: directory, timeout: 15_000 }), error => error.code !== 'ETIMEDOUT' && !error.stdout.includes('Server listening') && !error.stdout.includes('Local:'));
  }
  await writeFile(source, content); await prepare();
});
