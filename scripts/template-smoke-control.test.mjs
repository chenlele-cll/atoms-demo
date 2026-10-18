import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));

async function within(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Control test deadline exceeded')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

async function portFree(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

function launch() {
  const child = spawn(process.execPath, ['scripts/template-smoke.cjs'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (data) => { stdout = (stdout + data).slice(-131072); });
  child.stderr.on('data', (data) => { stderr = (stderr + data).slice(-131072); });
  const result = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return { child, result };
}

async function reportFor(result) {
  const match = result.stdout.match(/Template smoke report: (.+report\.json)/);
  assert.ok(match, `Missing final report: ${result.stderr}`);
  const filename = path.resolve(root, match[1]);
  assert.ok(filename.startsWith(path.join(root, 'test-results/template-baseline/')));
  return JSON.parse(await readFile(filename, 'utf8'));
}

test('template smoke preserves foreign listeners and cleans up on signals', { timeout: 60000 }, async (t) => {
  await portFree(5173);
  await portFree(4173);
  await t.test('occupied port fails without stopping its existing HTTP owner', async () => {
    const server = http.createServer((_request, response) => response.end('foreign-owner-fixture'));
    await new Promise((resolve) => server.listen(5173, '127.0.0.1', resolve));
    try {
      const run = launch();
      const result = await within(run.result, 15000);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /occupied/);
      const report = await reportFor(result);
      assert.equal(report.status, 'failed');
      assert.equal(report.cleanup, 'passed');
      assert.equal(report.failedPhase, 'preflight');
      const response = await fetch('http://127.0.0.1:5173', { signal: AbortSignal.timeout(1000) });
      assert.equal(await response.text(), 'foreign-owner-fixture');
    } finally { await new Promise((resolve) => server.close(resolve)); }
  });
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    await t.test(`${signal} closes the owned browser and frontend with a final report`, async () => {
      const run = launch();
      try {
        const deadline = Date.now() + 15000;
        let ready = false;
        while (Date.now() < deadline && run.child.exitCode === null) {
          try {
            const response = await fetch('http://127.0.0.1:5173', { signal: AbortSignal.timeout(500) });
            if (response.ok) { ready = true; break; }
          } catch { /* wait only for this run's frontend */ }
          await delay(100);
        }
        assert.equal(ready, true, 'The run must own a live browser and frontend before interruption');
        const started = Date.now();
        run.child.kill(signal);
        const result = await within(run.result, 10000);
        assert.equal(result.code, code, result.stderr);
        const report = await reportFor(result);
        assert.equal(report.status, 'cancelled');
        assert.equal(report.cleanup, 'passed');
        assert.ok(Date.now() - started < 10000);
        await portFree(5173);
        await portFree(4173);
      } finally {
        if (run.child.exitCode === null && run.child.signalCode === null) {
          run.child.kill('SIGTERM');
          await within(run.result, 10000);
        }
      }
    });
  }
});
