import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import { chmod, cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { migrate } from '../src/storage/migrations.js';

const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let compiled = ''; let temporary = '';
async function freePort() {
  const server = createServer(); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error();
  await new Promise<void>(r => server.close(() => r())); return address.port;
}
function run(cwd: string, port: number, database: string, extra: NodeJS.ProcessEnv = {}) {
  const child = spawn(process.execPath, [join(compiled, 'server.js')], {
    cwd, env: { PATH: process.env['PATH'] ?? '', HOST: '127.0.0.1', PORT: String(port), DATABASE_PATH: database, ...extra }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = ''; child.stdout.on('data', (data: Buffer) => { output += data.toString(); }); child.stderr.on('data', (data: Buffer) => { output += data.toString(); });
  const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
  const finished = new Promise<{ code: number | null; output: string }>((r, reject) => {
    child.once('error', reject); child.once('close', code => { clearTimeout(timer); r({ code, output }); });
  });
  return { child, finished, output: () => output };
}
before(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'atoms lifecycle '));
  compiled = await mkdtemp(join(backend, 'node_modules/.persistence-build-'));
  const compiler = spawn(process.execPath, [join(backend, '../node_modules/typescript/bin/tsc'), '-p', join(backend, 'tsconfig.build.json'), '--outDir', compiled]);
  let output = ''; compiler.stderr.on('data', (data: Buffer) => { output += data.toString(); }); compiler.stdout.on('data', (data: Buffer) => { output += data.toString(); });
  assert.equal(await new Promise<number | null>(r => compiler.once('close', r)), 0, output);
  await writeFile(join(compiled, 'package.json'), '{"type":"module"}');
  await cp(join(backend, 'src/template-assets'), join(compiled, 'template-assets'), { recursive: true });
});
after(async () => { await Promise.all([rm(temporary, { recursive: true, force: true }), rm(compiled, { recursive: true, force: true })]); });

test('invalid config, higher schema, readonly database and absent catalog fail before listening without leaks', async t => {
  for (const kind of ['blank', 'memory', 'origin', 'future', 'readonly', 'directory', 'missing-asset']) await t.test(kind, async () => {
    const cwd = join(temporary, kind); await mkdir(cwd);
    const database = join(cwd, 'PRIVATE_DATABASE_PATH.sqlite');
    const port = await freePort();
    let extra: NodeJS.ProcessEnv = {};
    if (kind === 'future' || kind === 'readonly') {
      const sql = new Database(database); migrate(sql); if (kind === 'future') sql.pragma('user_version=99'); sql.close();
      if (kind === 'readonly') await chmod(database, 0o400);
    }
    if (kind === 'directory') await mkdir(database);
    if (kind === 'origin') extra = { APP_ORIGINS: 'http://untrusted.example' };
    const asset = join(compiled, 'template-assets/company-landing.bundle.json');
    const bytes = kind === 'missing-asset' ? await readFile(asset) : null;
    if (bytes) await rm(asset);
    try {
      const result = await run(cwd, port, kind === 'blank' ? '' : kind === 'memory' ? ':memory:' : database, extra).finished;
      assert.equal(result.code, 1, result.output);
      assert.ok(!result.output.includes('Server listening'));
      assert.ok(!result.output.includes(database)); assert.ok(!result.output.includes('SQLITE_'));
      const proof = createServer(); await new Promise<void>((r, reject) => { proof.once('error', reject); proof.listen(port, '127.0.0.1', r); });
      await new Promise<void>(r => proof.close(() => r()));
      if (kind === 'future') { const sql = new Database(database); assert.equal(sql.pragma('user_version', { simple: true }), 99); sql.close(); }
    } finally {
      if (bytes) await writeFile(asset, bytes);
      if (kind === 'readonly') await chmod(database, 0o600);
    }
  });
});

test('port conflict preserves external listener and releases the owned SQLite connection', async () => {
  const cwd = join(temporary, 'occupied'); await mkdir(cwd);
  const database = join(cwd, 'data.sqlite');
  const listener = createServer((_, res) => res.end('external-owner'));
  await new Promise<void>(r => listener.listen(0, '127.0.0.1', r));
  const address = listener.address(); if (!address || typeof address === 'string') throw new Error();
  try {
    const result = await run(cwd, address.port, database).finished;
    assert.equal(result.code, 1); assert.ok(!result.output.includes(database));
    assert.equal(await (await fetch(`http://127.0.0.1:${address.port}`)).text(), 'external-owner');
    const sql = new Database(database); sql.transaction(() => sql.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run('fixture', 'a'.repeat(64), 1, 2)).immediate(); sql.close();
  } finally { listener.closeAllConnections(); await new Promise<void>(r => listener.close(() => r())); }
});

test('normal production shutdown retains its database and a second process can restart it', async () => {
  const cwd = join(temporary, 'normal'); await mkdir(cwd);
  const database = join(cwd, 'data.sqlite'); const port = await freePort();
  for (let attempt = 0; attempt < 2; attempt++) {
    const instance = run(cwd, port, database);
    try {
      let ready = false;
      for (let i = 0; i < 80; i++) {
        try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) { ready = true; break; } } catch { /* still starting */ }
        await delay(30);
      }
      assert.ok(ready, instance.output()); instance.child.kill('SIGTERM');
      assert.equal((await instance.finished).code, 0);
      const sql = new Database(database); assert.equal(sql.pragma('user_version', { simple: true }), 2); sql.close();
    } finally { if (instance.child.exitCode === null) instance.child.kill('SIGKILL'); await instance.finished; }
  }
});
