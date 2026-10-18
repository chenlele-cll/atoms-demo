import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { fixtureEnv, sentinel, startFixture, successfulResponse } from './helpers/model-fixture.js';

const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let temporary = '';
let compiled = '';
let cwd = '';
let guard = '';
const cleanEnv = { PATH: process.env['PATH'] ?? '', OPENAI_API_KEY: '', MODEL_ID: '' };
const reportSchema = z.object({
  runId: z.string().uuid(), source: z.enum(['fixture', 'not-run', 'live']),
  status: z.string(), requestCount: z.number(), model: z.string().nullable(),
  cases: z.array(z.object({ status: z.string() })),
});

function child(script: string, args: string[], options: { source?: boolean; env?: NodeJS.ProcessEnv; guardNetwork?: boolean } = {}) {
  const processArgs = [...(options.source ? ['--import', import.meta.resolve('tsx')] : []),
    ...(options.guardNetwork ? ['--import', pathToFileURL(guard).href] : []), script, ...args];
  const instance = spawn(process.execPath, processArgs, { cwd, env: options.env ?? cleanEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  instance.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
  instance.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
  const timeout = setTimeout(() => instance.kill('SIGKILL'), 8000);
  const finished = new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>((resolveResult, reject) => {
    instance.once('error', reject);
    instance.once('close', (code, signal) => { clearTimeout(timeout); resolveResult({ code, signal, stdout, stderr }); });
  });
  return { instance, finished };
}

before(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'atoms model cli '));
  // Inside backend resolution boundary, so the build uses actual production deps.
  compiled = await mkdtemp(join(backend, 'node_modules', '.model-probe-test-'));
  cwd = join(temporary, 'isolated working directory'); await mkdir(cwd);
  guard = join(temporary, 'no-network.mjs');
  await writeFile(guard, "globalThis.fetch = async () => { process.stderr.write('UNEXPECTED_NETWORK'); throw new Error('forbidden'); };\n");
  const compiler = spawn(process.execPath, [join(backend, '../node_modules/typescript/bin/tsc'), '-p', join(backend, 'tsconfig.build.json'), '--outDir', compiled],
    { cwd: backend, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  compiler.stdout.on('data', (data: Buffer) => { output += data.toString(); });
  compiler.stderr.on('data', (data: Buffer) => { output += data.toString(); });
  const code = await new Promise<number | null>(resolveCode => compiler.once('close', resolveCode));
  assert.equal(code, 0, output);
  await writeFile(join(compiled, 'package.json'), '{"type":"module"}');
});
after(async () => {
  await Promise.all([rm(temporary, { recursive: true, force: true }), rm(compiled, { recursive: true, force: true })]);
});

test('source and isolated production build show help without env loading or network', async () => {
  await mkdir(join(cwd, '.env')); // Would fail if an entry tried to load it.
  try {
    for (const source of [true, false]) for (const args of [[], ['--help']]) {
      const result = await child(source ? join(backend, 'src/model/probe.ts') : join(compiled, 'model/probe.js'), args,
        { source, guardNetwork: true, env: { ...cleanEnv, OPENAI_API_KEY: sentinel } }).finished;
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /Usage:/); assert.equal(result.stderr, '');
      assert.ok(!result.stdout.includes(sentinel));
    }
  } finally { await rm(join(cwd, '.env'), { recursive: true }); }
});

test('source and built explicit commands fail safely with missing configuration and zero network', async () => {
  for (const source of [true, false]) {
    const result = await child(source ? join(backend, 'src/model/probe.ts') : join(compiled, 'model/probe.js'), ['--case', 'all'],
      { source, guardNetwork: true }).finished;
    assert.equal(result.code, 1, result.stderr);
    const report = reportSchema.parse(JSON.parse(result.stdout) as unknown);
    assert.equal(report.source, 'not-run'); assert.equal(report.requestCount, 0);
    assert.equal(report.status, 'failed');
    assert.deepEqual(report.cases.map(item => item.status), ['not-run', 'not-run', 'not-run']);
    assert.equal(result.stderr, '');
  }
});

test('invalid args cannot trigger calls; native env loading preserves existing process values', async () => {
  const script = join(compiled, 'model/probe.js');
  const bad = await child(script, ['--case', sentinel, '--report'], { guardNetwork: true }).finished;
  assert.equal(bad.code, 1); assert.ok(!`${bad.stdout}${bad.stderr}`.includes(sentinel));
  await writeFile(join(cwd, '.env'), `OPENAI_API_KEY=${sentinel}\nMODEL_ID=gpt-6.1-sol\n`);
  try {
    const result = await child(script, ['--case', 'all'], { guardNetwork: true }).finished;
    assert.equal(result.code, 1);
    assert.equal(reportSchema.parse(JSON.parse(result.stdout) as unknown).requestCount, 0);
    assert.equal(result.stderr, '');
  } finally { await rm(join(cwd, '.env')); }
});

async function harness(transportUrl: string, reportDirectory: string) {
  const script = join(temporary, `harness-${(await readdir(temporary)).length}.mjs`);
  await writeFile(script, `import { runProbeCli } from ${JSON.stringify(pathToFileURL(join(compiled, 'model/probe-cli.js')).href)};
const transport = (url, init) => fetch(${JSON.stringify(transportUrl)} + new URL(String(url)).pathname, init);
process.exitCode = await runProbeCli(process.argv.slice(2), { env: ${JSON.stringify({ ...fixtureEnv, MODEL_TIMEOUT_MS: '10000' })}, transport, reportDirectory: ${JSON.stringify(reportDirectory)} });
`);
  return script;
}

test('CLI saves only sanitized fixture results and exits nonzero on provider rejection', async () => {
  const fixture = await startFixture((_, res) => {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: { message: `RAW_PROVIDER_BODY ${sentinel}`, type: 'fixture', code: 'fixture' } }));
  });
  const directory = join(temporary, 'reports');
  try {
    const result = await child(await harness(fixture.origin, directory), ['--case', 'all', '--report']).finished;
    assert.equal(result.code, 1, result.stderr);
    const report = reportSchema.parse(JSON.parse(result.stdout) as unknown);
    assert.equal(report.source, 'fixture'); assert.equal(report.requestCount, 1);
    const saved = await readFile(join(directory, `${report.runId}.json`), 'utf8');
    assert.equal(saved, result.stdout);
    assert.ok(!`${saved}${result.stderr}`.includes(sentinel));
    assert.ok(!`${saved}${result.stderr}`.includes('RAW_PROVIDER_BODY'));
    assert.equal(fixture.requests.length, 1);
  } finally { await fixture.close(); }
});

test('CLI fixture all passes exactly four requests', async () => {
  const fixture = await startFixture((body, res) => res.end(JSON.stringify(successfulResponse(body))));
  // Module tests above verify protocol; child transport is explicitly marked fixture.
  try {
    const result = await child(await harness(fixture.origin, join(temporary, 'pass-reports')), ['--case', 'all']).finished;
    assert.equal(result.code, 0, result.stderr);
    const report = reportSchema.parse(JSON.parse(result.stdout) as unknown);
    assert.equal(report.source, 'fixture'); assert.equal(report.requestCount, 4);
    assert.equal(report.status, 'passed'); assert.equal(fixture.requests.length, 4);
  } finally { await fixture.close(); }
});

test('CLI signals abort actual requests, emit a final report and clean up within a bound', async t => {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) await t.test(signal, async () => {
    let received: () => void = () => {};
    const active = new Promise<void>(resolveActive => { received = resolveActive; });
    const fixture = await startFixture(() => received());
    const instance = child(await harness(fixture.origin, join(temporary, signal)), ['--case', 'all', '--report']);
    try {
      await Promise.race([active, instance.finished.then(result => { throw new Error(`Exited before request: ${result.code}`); }),
        delay(4000, undefined, { ref: false }).then(() => { throw new Error('No active child request'); })]);
      const start = performance.now();
      instance.instance.kill(signal);
      const result = await instance.finished;
      assert.equal(result.code, signal === 'SIGINT' ? 130 : 143, result.stderr);
      assert.equal(result.signal, null);
      const report = reportSchema.parse(JSON.parse(result.stdout) as unknown);
      assert.equal(report.status, 'cancelled'); assert.equal(report.requestCount, 1);
      assert.deepEqual(report.cases.map(item => item.status), ['failed', 'not-run', 'not-run']);
      assert.ok(performance.now() - start < 2000);
      await delay(30); assert.equal(fixture.aborted(), 1);
      assert.equal(fixture.requests.length, 1);
      assert.ok(!`${result.stdout}${result.stderr}`.includes(sentinel));
    } finally { if (instance.instance.exitCode === null) instance.instance.kill('SIGKILL'); await instance.finished; await fixture.close(); }
  });
});
