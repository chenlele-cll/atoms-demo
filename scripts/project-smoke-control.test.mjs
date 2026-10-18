import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
function launch() {
  const child = spawn(process.execPath, ['scripts/project-smoke.cjs'], {
    cwd: root, env: { PATH: process.env['PATH'] ?? '' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', data => { output += data.toString(); });
  child.stderr.on('data', data => { output += data.toString(); });
  const finished = new Promise((resolve, reject) => {
    child.once('error', reject); child.once('close', code => resolve({ code, output }));
  });
  return { child, finished, output: () => output };
}
async function report(output) {
  const relative = output.match(/Project persistence report: (test-results\/project-persistence\/[^\n]+\/report.json)/)?.[1];
  assert.ok(relative, output);
  const filename = path.join(root, relative);
  const result = JSON.parse(await readFile(filename, 'utf8'));
  await assert.rejects(access(path.join(path.dirname(filename), 'runtime')));
  return result;
}
async function free(port) {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  await new Promise(resolve => server.close(resolve));
}

test('project smoke preserves foreign listeners and cleans owned resources on terminal signals', { timeout: 60000 }, async t => {
  for (const port of [3001, 5173, 4173]) await free(port);
  await t.test('occupied backend port is preserved', async () => {
    const server = createServer((_, response) => response.end('foreign-fixture-owner'));
    await new Promise(resolve => server.listen(3001, '127.0.0.1', resolve));
    try {
      const result = await launch().finished;
      assert.equal(result.code, 1);
      assert.equal(await (await fetch('http://127.0.0.1:3001')).text(), 'foreign-fixture-owner');
      assert.equal((await report(result.output)).status, 'failed');
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  });
  for (const signal of ['SIGINT', 'SIGTERM']) await t.test(signal, async () => {
    const instance = launch();
    try {
      const deadline = Date.now() + 15000;
      while (!instance.output().includes('PASS: dev: relative API') && Date.now() < deadline && instance.child.exitCode === null) await delay(20);
      assert.ok(instance.output().includes('PASS: dev: relative API'), instance.output());
      const started = Date.now(); instance.child.kill(signal);
      const result = await instance.finished;
      assert.equal(result.code, signal === 'SIGINT' ? 130 : 143, result.output);
      assert.ok(Date.now() - started < 10000);
      const final = await report(result.output);
      assert.equal(final.status, 'cancelled'); assert.equal(final.cleanup, 'passed');
      for (const port of [3001, 5173, 4173]) await free(port);
    } finally {
      if (instance.child.exitCode === null) instance.child.kill('SIGTERM');
      await instance.finished;
    }
  });
});
