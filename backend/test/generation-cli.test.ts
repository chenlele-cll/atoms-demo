import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { migrations } from '../src/storage/migrations.js';
import { z } from 'zod';
import { fixtureEnv, sentinel, startFixture } from './helpers/model-fixture.js';
import { successfulGeneration } from './helpers/generation.js';

const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let temporary = ''; let compiled = ''; let cwd = ''; let guard = ''; let counter = 0;
const metadataSchema = z.object({ id: z.uuid(), source: z.enum(['live', 'fixture', 'not-run']), status: z.string(), saved: z.boolean(), reopened: z.boolean(),
  unchangedCurrent: z.boolean(), generation: z.object({ metrics: z.object({ requestCount: z.number().nullable() }) }).nullable() });
function run(script: string, args: string[], source = false, guardNetwork = false) {
  const child = spawn(process.execPath, [...(source ? ['--import', import.meta.resolve('tsx')] : []),
    ...(guardNetwork ? ['--import', pathToFileURL(guard).href] : []), script, ...args],
  { cwd, env: { PATH: process.env['PATH'] ?? '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); }); child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
  const timer = setTimeout(() => child.kill('SIGKILL'), 12000);
  const finished = new Promise<{ code: number | null; stdout: string; stderr: string }>((r, reject) => {
    child.once('error', reject); child.once('close', code => { clearTimeout(timer); r({ code, stdout, stderr }); });
  });
  return { child, finished };
}
before(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'atoms generation cli ')); cwd = join(temporary, 'isolated cwd'); await mkdir(cwd);
  compiled = await mkdtemp(join(backend, 'node_modules/.generation-test-'));
  const compiler = spawn(process.execPath, [join(backend, '../node_modules/typescript/bin/tsc'), '-p', join(backend, 'tsconfig.build.json'), '--outDir', compiled]);
  let output = ''; compiler.stdout.on('data', (data: Buffer) => { output += data.toString(); }); compiler.stderr.on('data', (data: Buffer) => { output += data.toString(); });
  assert.equal(await new Promise<number | null>(r => compiler.once('close', r)), 0, output);
  await writeFile(join(compiled, 'package.json'), '{"type":"module"}');
  await cp(join(backend, 'src/template-assets'), join(compiled, 'template-assets'), { recursive: true });
  guard = join(temporary, 'no-network.mjs'); await writeFile(guard, "globalThis.fetch=async()=>{process.stderr.write('UNEXPECTED_NETWORK');throw new Error('forbidden');};");
});
after(async () => { await Promise.all([rm(temporary, { recursive: true, force: true }), rm(compiled, { recursive: true, force: true })]); });

test('source and built help load no environment or network; explicit invalid arguments never run', async () => {
  await mkdir(join(cwd, '.env'));
  try {
    for (const source of [true, false]) {
      const script = source ? join(backend, 'src/generation/smoke.ts') : join(compiled, 'generation/smoke.js');
      for (const args of [[], ['--help']]) {
        const result = await run(script, args, source, true).finished;
        assert.equal(result.code, 0, result.stderr); assert.match(result.stdout, /Usage:/); assert.equal(result.stderr, '');
      }
      for (const args of [['--case', 'quote'], ['--live'], ['--live', '--case', sentinel], ['--live', '--case', 'quote', '--database', 'production']]) {
        const result = await run(script, args, source, true).finished;
        assert.equal(result.code, 1); assert.ok(!`${result.stdout}${result.stderr}`.includes(sentinel));
        assert.ok(!result.stderr.includes('UNEXPECTED_NETWORK'));
      }
    }
  } finally { await rm(join(cwd, '.env'), { recursive: true }); }
});

test('missing configuration is not-run and nonzero in source and built entries', async () => {
  for (const source of [true, false]) {
    const script = source ? join(backend, 'src/generation/smoke.ts') : join(compiled, 'generation/smoke.js');
    const result = await run(script, ['--live', '--case', 'quote'], source, true).finished;
    assert.equal(result.code, 1, result.stderr); assert.equal(result.stderr, '');
    const report = metadataSchema.parse(JSON.parse(result.stdout) as unknown);
    assert.equal(report.source, 'not-run'); assert.equal(report.generation, null); assert.equal(report.saved, false);
    const defaultDirectory = fileURLToPath(new URL('../../../test-results/generation-smoke/', pathToFileURL(source
      ? join(backend, 'src/generation/smoke-cli.ts') : join(compiled, 'generation/smoke-cli.js'))));
    await rm(join(defaultDirectory, report.id), { recursive: true, force: true });
  }
});

async function harness(origin: string, directory: string, protectedDatabase: string) {
  const script = join(temporary, `harness-${counter++}.mjs`);
  await writeFile(script, `import {runGenerationSmokeCli} from ${JSON.stringify(pathToFileURL(join(compiled, 'generation/smoke-cli.js')).href)};
const transport=(url,init)=>fetch(${JSON.stringify(origin)}+new URL(String(url)).pathname,init);
process.exitCode=await runGenerationSmokeCli(process.argv.slice(2),{env:${JSON.stringify({ ...fixtureEnv, MODEL_TIMEOUT_MS: '10000', DATABASE_PATH: protectedDatabase })}, transport, directory:${JSON.stringify(directory)}});
`);
  return script;
}
test('fixture CLI creates only an isolated database, saves/reopens, and never labels fixture as live', async () => {
  const directory = join(temporary, 'reports'); const protectedDatabase = join(temporary, 'production.sqlite');
  await writeFile(protectedDatabase, 'DO_NOT_TOUCH_PRODUCTION_DATA');
  const fixture = await startFixture((body, res, index) => res.end(JSON.stringify(successfulGeneration(body, index))));
  try {
    const result = await run(await harness(fixture.origin, directory, protectedDatabase), ['--live', '--case', 'quote']).finished;
    assert.equal(result.code, 0, result.stderr);
    const report = metadataSchema.parse(JSON.parse(result.stdout) as unknown);
    assert.equal(report.source, 'fixture'); assert.equal(report.status, 'passed'); assert.equal(report.saved, true); assert.equal(report.reopened, true);
    assert.equal(report.unchangedCurrent, true); assert.equal(report.generation?.metrics.requestCount, 3);
    assert.equal(await readFile(protectedDatabase, 'utf8'), 'DO_NOT_TOUCH_PRODUCTION_DATA');
    assert.equal(await readFile(join(directory, report.id, 'report.json'), 'utf8'), result.stdout);
    assert.ok(!`${result.stdout}${result.stderr}`.includes(sentinel));
    assert.ok(!result.stdout.includes('export default function')); assert.ok(!result.stdout.includes('服务类型可选'));
    const sql = new Database(join(directory, report.id, 'project.sqlite'));
    assert.equal(sql.pragma('user_version', { simple: true }), migrations.at(-1)?.version); sql.close();
  } finally { await fixture.close(); }
});

test('CLI terminal signals abort actual requests, preserve accepted input and close SQLite', async t => {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) await t.test(signal, async () => {
    let received: () => void = () => {}; const active = new Promise<void>(r => { received = r; });
    const fixture = await startFixture(() => received()); const directory = join(temporary, signal);
    const instance = run(await harness(fixture.origin, directory, join(temporary, 'untouched')), ['--live', '--case', 'quote']);
    try {
      await Promise.race([active, instance.finished.then(result => { throw new Error(`Exited before active request ${result.code}`); }),
        delay(5000, undefined, { ref: false }).then(() => { throw new Error('No fixture request'); })]);
      const started = performance.now(); instance.child.kill(signal); const result = await instance.finished;
      assert.equal(result.code, signal === 'SIGINT' ? 130 : 143, result.stderr); assert.ok(performance.now() - started < 3000);
      const report = metadataSchema.parse(JSON.parse(result.stdout) as unknown);
      assert.equal(report.status, 'cancelled'); assert.equal(report.source, 'fixture'); assert.equal(report.saved, false);
      await delay(30); assert.equal(fixture.aborted(), 1); assert.equal(fixture.requests.length, 1);
      const sql = new Database(join(directory, report.id, 'project.sqlite'));
      assert.deepEqual(sql.prepare('SELECT status FROM generation_runs').get(), { status: 'cancelled' });
      assert.deepEqual(sql.prepare('SELECT count(*) AS count FROM messages').get(), { count: 1 }); sql.close();
      assert.ok(!`${result.stdout}${result.stderr}`.includes(sentinel));
    } finally { if (instance.child.exitCode === null) instance.child.kill('SIGKILL'); await instance.finished; await fixture.close(); }
  });
});
