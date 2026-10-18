import assert from 'node:assert/strict';
import { ChildProcess } from 'node:child_process';
import fs, { chmod, copyFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { z } from 'zod';
import type { Snapshot } from '../src/contracts/projects.js';
import { GenerationError } from '../src/generation/errors.js';
import { runOpenCode } from '../src/generation/opencode.js';
import type { ModelConfig } from '../src/model/config.js';
import { projectFixture } from './helpers/projects.js';

const config: ModelConfig = { apiKey: 'fake-model-secret', modelId: 'custom-test-model', baseURL: 'https://api.openai.com/v1', maxOutputTokens: 4096, timeoutMs: 0 };
type Event = Parameters<Parameters<typeof runOpenCode>[0]['observe']>[0];
const reportSchema = z.object({ project: z.string(), root: z.string(), pid: z.number(), args: z.array(z.string()), env: z.record(z.string(), z.string()), prompt: z.string().optional(), managedEntries: z.array(z.string()).nullable() });

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'atoms-opencode-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const executable = join(directory, 'opencode');
  await copyFile(new URL('./fixtures/opencode.cjs', import.meta.url), executable);
  await chmod(executable, 0o700);
  const base = (await projectFixture(t)).bundle;
  const events: Event[] = [];
  const controller = new AbortController();
  const report = join(directory, 'report.json'); const descendant = join(directory, 'descendant.pid');
  const run = (mode: string, override: { base?: Snapshot; executable?: string; check?: () => void; observe?: (event: Event) => void } = {}) => runOpenCode({
    base, executable, config, prompt: JSON.stringify({ mode, report, descendant, secret: 'private prompt' }), signal: controller.signal,
    check: () => {}, observe: event => { events.push(event); }, ...override,
  });
  return { base, events, controller, directory, report, descendant, run };
}

async function readReport(path: string) {
  const value: unknown = JSON.parse(await readFile(path, 'utf8'));
  return reportSchema.parse(value);
}

function safeError(code: string) {
  return (error: unknown) => {
    assert.ok(error instanceof GenerationError);
    assert.equal(error.code, code);
    assert.equal(error.message, `Generation failed: ${code}`);
    assert.equal('cause' in error, false);
    assert.ok(!JSON.stringify(error).includes('sensitive'));
    return true;
  };
}

test('OpenCode materializes the frozen project, returns only actual changes and isolates credentials/configuration', async t => {
  const previous = process.env['ATOMS_BACKEND_TEST_SECRET'];
  process.env['ATOMS_BACKEND_TEST_SECRET'] = 'backend-only-secret';
  t.after(() => { if (previous === undefined) delete process.env['ATOMS_BACKEND_TEST_SECRET']; else process.env['ATOMS_BACKEND_TEST_SECRET'] = previous; });
  const f = await fixture(t);
  const original = structuredClone(f.base);
  const result = await f.run('success');
  assert.deepEqual(result.files, [{ path: '/src/App.tsx', content: f.base.files['/src/App.tsx'] + '\n// fixture edit' }]);
  assert.deepEqual(f.base, original);
  assert.deepEqual(f.events, [{ type: 'agent-started' }, { type: 'agent-tool-finished', agentTool: 'read' },
    { type: 'agent-tool-finished', agentTool: 'edit' }, { type: 'agent-finished' }]);
  const report = await readReport(f.report);
  assert.deepEqual(report.args, ['run', '--format', 'json', '--model', 'openai/custom-test-model', '--agent', 'atoms', '--dir', report.project, '--pure']);
  assert.equal(report.prompt, 'private prompt');
  assert.equal(report.env['HOME'], join(report.root, 'home'));
  assert.equal(report.env['OPENCODE_TEST_HOME'], report.env['HOME']);
  assert.equal(report.env['OPENCODE_TEST_MANAGED_CONFIG_DIR'], join(report.root, 'managed'));
  assert.deepEqual(report.managedEntries, []);
  for (const name of ['XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'TMPDIR']) assert.ok(report.env[name]?.startsWith(report.root + '/'));
  for (const name of ['ATOMS_BACKEND_TEST_SECRET', 'OPENAI_API_KEY', 'DATABASE_PATH', 'NODE_OPTIONS', 'OPENCODE_CONFIG', 'HTTP_PROXY', 'HTTPS_PROXY']) assert.equal(report.env[name], undefined);
  assert.equal(report.env['OPENCODE_AUTH_CONTENT'], '{}');
  assert.equal(report.env['OPENCODE_EXPERIMENTAL_NATIVE_LLM'], '1');
  for (const name of ['OPENCODE_DISABLE_PROJECT_CONFIG', 'OPENCODE_DISABLE_CLAUDE_CODE', 'OPENCODE_DISABLE_EXTERNAL_SKILLS', 'OPENCODE_DISABLE_DEFAULT_PLUGINS']) assert.equal(report.env[name], '1');
  const value: unknown = JSON.parse(report.env['OPENCODE_CONFIG_CONTENT'] ?? '{}');
  const parsed = z.object({ share: z.literal('disabled'), autoupdate: z.literal(false), plugin: z.array(z.string()).length(0),
    permission: z.record(z.string(), z.string()), agent: z.object({ atoms: z.object({ steps: z.literal(24) }) }),
    provider: z.object({ openai: z.object({ npm: z.literal('@ai-sdk/openai'), options: z.object({ apiKey: z.string(), baseURL: z.string() }),
      models: z.record(z.string(), z.object({ limit: z.object({ output: z.number() }) })) }) }) }).parse(value);
  assert.equal(parsed.provider.openai.options.apiKey, config.apiKey);
  assert.equal(parsed.provider.openai.options.baseURL, config.baseURL);
  assert.equal(parsed.provider.openai.models[config.modelId]?.limit.output, config.maxOutputTokens);
  for (const name of ['*', 'bash', 'external_directory', 'webfetch', 'websearch', 'task', 'question', 'skill']) assert.equal(parsed.permission[name], 'deny');
  await assert.rejects(stat(report.root), { code: 'ENOENT' });
});

test('OpenCode accepts real text completion and reports only completed permitted tools', async t => {
  for (const mode of ['text', 'tool-error']) {
    const f = await fixture(t); await f.run(mode);
    assert.equal(f.events.filter(event => event.type === 'agent-tool-finished').length, 2);
  }
  const f = await fixture(t);
  await f.run('success', { observe: () => { throw new Error('observer failure'); } });
  const g = await fixture(t);
  const result = await g.run('add');
  assert.deepEqual(result.files.map(file => file.path), ['/src/App.tsx', '/src/generated/new.ts']);
  assert.equal(result.files[1]?.content, 'export const fixture = true;');
  assert.deepEqual(g.events.filter(event => event.type === 'agent-tool-finished').map(event => event.agentTool), ['read', 'edit', 'glob', 'grep', 'write', 'apply_patch']);
});

test('OpenCode preserves UTF-8 BOMs in writable and protected files without creating false changes', async t => {
  const f = await fixture(t);
  const base = { ...f.base, files: { ...f.base.files,
    '/src/App.tsx': '\uFEFF' + f.base.files['/src/App.tsx'], '/src/main.tsx': '\uFEFF' + f.base.files['/src/main.tsx'] } };
  const result = await f.run('success', { base });
  assert.deepEqual(result.files, [{ path: '/src/App.tsx', content: base.files['/src/App.tsx'] + '\n// fixture edit' }]);
});

test('OpenCode rejects unsafe final files and whole-operation limits without exposing content', async t => {
  for (const mode of ['delete', 'protected', 'symlink', 'directory-symlink', 'hardlink', 'invalidutf8', 'special', 'badpath', 'blank',
    'oversized-change', 'oversized-snapshot', 'too-many-changes', 'too-many-files', 'noop', 'denied-tool']) {
    await t.test(mode, async t => {
      const f = await fixture(t); await assert.rejects(f.run(mode), safeError('FILE_POLICY'));
      assert.ok(!f.events.some(event => event.type === 'agent-finished'));
      await assert.rejects(stat((await readReport(f.report)).root), { code: 'ENOENT' });
    });
  }
});

test('OpenCode requires successful exit and validated bounded completion events', async t => {
  for (const mode of ['malformed', 'malformed-tail', 'invalid-event', 'invalid-json-utf8', 'large-line', 'noisy', 'empty', 'no-completion', 'steps', 'finish-steps', 'truncated', 'nonzero', 'error']) {
    await t.test(mode, async t => {
      const f = await fixture(t);
      await assert.rejects(f.run(mode), safeError(['nonzero', 'error'].includes(mode) ? 'MODEL_UPSTREAM' : 'INVALID_OUTPUT'));
      assert.ok(!f.events.some(event => event.type === 'agent-finished'));
      assert.ok(!JSON.stringify(f.events).includes('sensitive'));
    });
  }
});

test('OpenCode requires the latest assistant message to end in stop after all work', async t => {
  for (const mode of ['text-only', 'intermediate-error', 'tool-error-no-stop', 'prior-stop-start', 'prior-stop-tool',
    'prior-stop-tool-error', 'prior-stop-text', 'prior-stop-stale', 'prior-stop-tool-calls']) {
    await t.test(mode, async t => {
      const f = await fixture(t);
      await assert.rejects(f.run(mode), safeError('INVALID_OUTPUT'));
      assert.ok(!f.events.some(event => event.type === 'agent-finished'));
    });
  }
});

test('OpenCode waits for close to validate output still buffered when the process exits', async t => {
  const f = await fixture(t);
  const emit = ChildProcess.prototype.emit;
  let drain = () => {};
  t.mock.method(ChildProcess.prototype, 'emit', function(this: ChildProcess, event: string | symbol, ...args: unknown[]) {
    if (event === 'spawn' && this.stdout) {
      const stdout = this.stdout; const resume = stdout.resume;
      stdout.pause();
      // Node automatically resumes unread pipes at exit. Delay that drain to
      // exercise the real exit/close gap without fabricating output events.
      t.mock.method(stdout, 'resume', () => stdout);
      drain = () => { resume.call(stdout); };
    }
    if (event === 'exit') setTimeout(drain, 50);
    const emitted: unknown = Reflect.apply(emit, this, [event, ...args]);
    return emitted === true;
  });
  await f.run('success');
  assert.deepEqual(f.events.map(event => event.type), ['agent-started', 'agent-tool-finished', 'agent-tool-finished', 'agent-finished']);
  const g = await fixture(t);
  await assert.rejects(g.run('error'), safeError('MODEL_UPSTREAM'));
  assert.ok(!g.events.some(event => event.type === 'agent-finished'));
});

test('OpenCode samples the first 64 completed tools while validating all 512 tool results', async t => {
  const f = await fixture(t);
  await f.run('many-tools');
  assert.equal(f.events.filter(event => event.type === 'agent-tool-finished').length, 64);
  assert.equal(f.events.length, 66);
  assert.equal(f.events.at(-1)?.type, 'agent-finished');
  for (const mode of ['too-many-tools', 'sampled-error', 'sampled-denied']) {
    await t.test(mode, async t => {
      const g = await fixture(t);
      await assert.rejects(g.run(mode), safeError(mode === 'sampled-denied' ? 'FILE_POLICY' : 'INVALID_OUTPUT'));
      assert.equal(g.events.filter(event => event.type === 'agent-tool-finished').length, 64);
      assert.ok(!g.events.some(event => event.type === 'agent-finished'));
    });
  }
});

test('OpenCode accepts terminal stop at the step cap as candidate files, without asserting task completion', async t => {
  const f = await fixture(t);
  const result = await f.run('at-step-cap');
  assert.deepEqual(result, { files: [{ path: '/src/App.tsx', content: f.base.files['/src/App.tsx'] + '\n// fixture edit' }] });
});

test('OpenCode refuses macOS managed preferences that can override isolated configuration', { skip: process.platform !== 'darwin' }, async t => {
  const paths = [
    { name: 'machine preferences', path: '/Library/Managed Preferences/ai.opencode.managed.plist', inaccessible: false },
    { name: 'user preferences', path: join('/Library/Managed Preferences', userInfo().username || 'user', 'ai.opencode.managed.plist'), inaccessible: false },
    { name: 'inaccessible preferences', path: '/Library/Managed Preferences/ai.opencode.managed.plist', inaccessible: true },
  ];
  for (const target of paths) {
    await t.test(target.name, async t => {
      const f = await fixture(t);
      const access = fs.access;
      t.mock.method(fs, 'access', async (path: Parameters<typeof fs.access>[0], mode?: number) => {
        if (String(path) === target.path) {
          if (target.inaccessible) throw Object.assign(new Error('fixture access failure'), { code: 'EACCES' });
          return;
        }
        return access(path, mode);
      });
      await assert.rejects(f.run('success'), safeError('MODEL_CONFIGURATION'));
      assert.deepEqual(f.events, []);
      await assert.rejects(stat(f.report), { code: 'ENOENT' });
    });
  }
});

test('OpenCode rejects traversal before spawning and handles unavailable executables safely', async t => {
  const f = await fixture(t);
  for (const path of ['/../escape.ts', '/src/../../escape.ts', '/src\\escape.ts', '//escape.ts']) {
    await assert.rejects(f.run('success', { base: { ...f.base, files: { ...f.base.files, [path]: 'sensitive' } } }), safeError('FILE_POLICY'));
  }
  assert.deepEqual(f.events, []);
  await assert.rejects(f.run('success', { executable: join(f.directory, 'missing') }), safeError('MODEL_UPSTREAM'));
  assert.deepEqual(f.events, []);
});

async function waitForFile(path: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    try { return await readFile(path, 'utf8'); } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      await delay(10);
    }
  }
  throw new Error('Fixture failed to start');
}

test('OpenCode cancellation before spawn and from the started observer prevents prompt execution', async t => {
  const f = await fixture(t); f.controller.abort();
  await assert.rejects(f.run('success'), safeError('CANCELLED'));
  assert.deepEqual(f.events, []);
  const g = await fixture(t);
  await assert.rejects(g.run('success', { observe: event => { if (event.type === 'agent-started') g.controller.abort(); } }), safeError('CANCELLED'));
  await assert.rejects(stat(g.report), { code: 'ENOENT' });
});

test('OpenCode kills TERM-resistant descendants on cancellation and normal exit before removing files', async t => {
  for (const mode of ['cancel', 'descendant']) {
    await t.test(mode, async t => {
      const f = await fixture(t);
      const running = f.run(mode);
      // Attach the rejection handler before signalling the real subprocess.
      const outcome = mode === 'cancel' ? assert.rejects(running, safeError('CANCELLED')) : running;
      const pid = Number(await waitForFile(f.descendant));
      assert.ok(Number.isSafeInteger(pid) && pid > 0);
      if (mode === 'cancel') f.controller.abort();
      await outcome;
      const report = await readReport(f.report);
      await delay(150);
      await assert.rejects(stat(report.root), { code: 'ENOENT' });
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
      assert.equal(f.events.some(event => event.type === 'agent-finished'), mode === 'descendant');
    });
  }
});
