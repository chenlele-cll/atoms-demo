import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, cp, lstat, mkdir, readFile, readdir, readlink, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'test-results/infra', randomUUID());

async function fixture(name) {
  const cwd = path.join(output, `${name} with spaces`, 'deep-repository-path-'.repeat(5));
  await mkdir(path.join(cwd, 'scripts'), { recursive: true });
  await cp(path.join(root, 'manager.sh'), path.join(cwd, 'manager.sh'));
  await cp(path.join(root, 'scripts/setup.mjs'), path.join(cwd, 'scripts/setup.mjs'));
  const bin = path.join(cwd, 'bin');
  await mkdir(bin);
  await symlink(process.execPath, path.join(bin, 'node'));
  await symlink('/usr/bin/dirname', path.join(bin, 'dirname'));
  for (const tool of ['docker', 'pnpm', 'process-compose', 'curl', 'wget']) {
    const filename = path.join(bin, tool);
    await writeFile(filename, '#!/bin/sh\nprintf "unexpected tool call\\n" >> "$ATOMS_TOOL_CALLS"\nexit 99\n');
    await chmod(filename, 0o755);
  }
  const env = { ...process.env, PATH: bin, ATOMS_TOOL_CALLS: path.join(cwd, 'tool-calls') };
  delete env.COMPOSE_FILE;
  const run = async (...args) => {
    try {
      const result = await exec(path.join(cwd, 'manager.sh'), args, { cwd: '/tmp', env, timeout: 5000 });
      return { code: 0, ...result };
    } catch (err) {
      if (typeof err.code !== 'number') throw err;
      return { code: err.code, stdout: err.stdout, stderr: err.stderr };
    }
  };
  return { cwd, env, run };
}

async function snapshot(cwd, prefix = '') {
  const result = [];
  for (const name of (await readdir(path.join(cwd, prefix))).sort()) {
    const relative = path.join(prefix, name);
    const filename = path.join(cwd, relative);
    const info = await lstat(filename);
    result.push({ path: relative, mode: info.mode, mtime: info.mtimeMs, value: info.isSymbolicLink() ? await readlink(filename) : info.isDirectory() ? 'directory' : createHash('sha256').update(await readFile(filename)).digest('hex') });
    if (info.isDirectory()) result.push(...await snapshot(cwd, relative));
  }
  return result;
}

test('empty infrastructure works without dependencies or tools; repeated and concurrent commands have no side effects', async () => {
  const { cwd, run } = await fixture('fresh');
  const before = await snapshot(cwd);
  for (const action of ['start', 'stop', 'status', 'start', 'stop']) {
    const text = await run('infra', action);
    assert.equal(text.code, 0, text.stderr);
    assert.equal(text.stdout.trim(), '未配置外部基础设施');
    assert.equal(text.stderr, '');
  }
  const actions = ['start', 'start', 'stop', 'status', 'stop', 'status'];
  const results = await Promise.all(actions.map((action) => run('infra', action, '--json')));
  for (const [index, result] of results.entries()) {
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.deepEqual(JSON.parse(result.stdout), { ok: true, action: actions[index], state: 'not_configured', configured: false, services: [], message: '未配置外部基础设施' });
  }
  assert.deepEqual(await snapshot(cwd), before);
});

test('infra leaves existing environment, persistent data and manager state untouched', async () => {
  const { cwd, run } = await fixture('existing files');
  for (const [name, contents] of Object.entries({ 'backend/.env': 'TOKEN=test-private-value\n', 'data/app.sqlite': 'persistent test data', '.runtime/manager/state.json': '{"id":"untouched-test-state"}' })) {
    await mkdir(path.dirname(path.join(cwd, name)), { recursive: true });
    await writeFile(path.join(cwd, name), contents);
  }
  const before = await snapshot(cwd);
  for (const action of ['start', 'stop', 'status']) {
    const result = await run('infra', action, '--json');
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).state, 'not_configured');
    assert.ok(!result.stdout.includes('test-private-value'));
  }
  assert.deepEqual(await snapshot(cwd), before);
});

test('missing/unsupported actions and invalid options fail without changing files', async () => {
  const { cwd, run } = await fixture('invalid arguments');
  const before = await snapshot(cwd);
  for (const args of [[], ['restart'], ['--json'], ['start', '--timeout', '1'], ['status', '--json', '--json'], ['stop', '../data'], ['start', '--follow'], ['status', '--json', 'extra']]) {
    const result = await run('infra', ...args);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Usage: .*infra/);
  }
  assert.deepEqual(await snapshot(cwd), before);
});

test('unintegrated Compose files or COMPOSE_FILE fail without tools, reads or mutations', async () => {
  for (const name of ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml', 'COMPOSE_FILE']) {
    const { cwd, env, run } = await fixture(name);
    // A dangling link also counts as an attempted configuration; do not follow it.
    if (name === 'COMPOSE_FILE') env.COMPOSE_FILE = '/private/test-secret-config.yml';
    else await symlink('missing-test-secret-config.yml', path.join(cwd, name));
    const before = await snapshot(cwd);
    for (const action of ['start', 'stop', 'status']) {
      const result = await run('infra', action, '--json');
      assert.equal(result.code, 1);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /INF-002/);
      assert.ok(!result.stderr.includes('test-secret-config'));
    }
    assert.deepEqual(await snapshot(cwd), before);
  }
});
