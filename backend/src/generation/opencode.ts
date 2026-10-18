import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import fs, { lstat, mkdir, mkdtemp, open, opendir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { Snapshot } from '../contracts/projects.js';
import type { ModelConfig } from '../model/config.js';
import { GenerationError } from './errors.js';
import { writable } from './policy.js';

type AgentTool = 'read' | 'glob' | 'grep' | 'edit' | 'write' | 'apply_patch';
type AgentEvent = { type: 'agent-started' | 'agent-finished' | 'agent-tool-finished'; agentTool?: AgentTool };
type Input = {
  base: Snapshot; prompt: string; config: ModelConfig; executable: string;
  signal: AbortSignal; check: () => void; observe: (event: AgentEvent) => void;
};

const toolSchema = z.enum(['read', 'glob', 'grep', 'edit', 'write', 'apply_patch']);
const identity = { id: z.string().min(1), sessionID: z.string().min(1), messageID: z.string().min(1) };
const eventSchema = z.object({ timestamp: z.number().finite(), sessionID: z.string().min(1) }).and(z.discriminatedUnion('type', [
  z.object({ type: z.literal('error'), error: z.object({ name: z.string() }) }),
  z.object({ type: z.literal('text'), part: z.object({ ...identity, type: z.literal('text'), text: z.string(), time: z.object({ start: z.number(), end: z.number() }) }) }),
  z.object({ type: z.literal('step_start'), part: z.object({ ...identity, type: z.literal('step-start') }) }),
  z.object({ type: z.literal('step_finish'), part: z.object({ ...identity, type: z.literal('step-finish'), reason: z.string() }) }),
  z.object({ type: z.literal('tool_use'), part: z.object({ ...identity, type: z.literal('tool'), callID: z.string().min(1), tool: z.string(), state: z.object({ status: z.enum(['completed', 'error']) }) }) }),
]));

function validPath(path: string): boolean {
  return path.startsWith('/') && path.length <= 512 && path.slice(1).split('/').every(segment =>
    /^[A-Za-z0-9_.-]+$/.test(segment) && segment !== '.' && segment !== '..');
}

// Integration is pinned to OpenCode CLI 1.18.23. Its global --pure is accepted
// after `run` (verified with installed help); it skips external plugins only.
// The bundled source confirms native openai uses Responses, permission patterns
// for read/edit are relative paths, and external_directory gates outside access.
function environment(root: string, config: ModelConfig): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'SystemRoot', 'WINDIR']) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  const permission = { '*': 'deny', read: 'allow', glob: 'allow', grep: 'allow', edit: 'allow', write: 'allow', apply_patch: 'allow',
    bash: 'deny', external_directory: 'deny', webfetch: 'deny', websearch: 'deny', task: 'deny', question: 'deny', skill: 'deny' };
  return { ...env, HOME: join(root, 'home'), OPENCODE_TEST_HOME: join(root, 'home'),
    TMPDIR: join(root, 'tmp'), TMP: join(root, 'tmp'), TEMP: join(root, 'tmp'),
    XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'),
    XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state'),
    OPENCODE_CONFIG_DIR: join(root, 'config'), OPENCODE_AUTH_CONTENT: '{}',
    OPENCODE_TEST_MANAGED_CONFIG_DIR: join(root, 'managed'),
    OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_DISABLE_CLAUDE_CODE: '1',
    OPENCODE_DISABLE_EXTERNAL_SKILLS: '1', OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: '1',
    OPENCODE_DISABLE_DEFAULT_PLUGINS: '1', OPENCODE_DISABLE_MODELS_FETCH: '1',
    OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_SHARE: '1',
    OPENCODE_EXPERIMENTAL_NATIVE_LLM: '1',
    OPENCODE_DISABLE_LSP_DOWNLOAD: '1', OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: '1',
    OPENCODE_CONFIG_CONTENT: JSON.stringify({ model: `openai/${config.modelId}`, small_model: `openai/${config.modelId}`,
      enabled_providers: ['openai'], share: 'disabled', autoupdate: false, plugin: [], instructions: [],
      lsp: false, formatter: false, snapshot: false, compaction: { auto: false, prune: false }, permission,
      provider: { openai: { npm: '@ai-sdk/openai', options: { apiKey: config.apiKey, baseURL: config.baseURL, timeout: false, maxRetries: 0 },
        models: { [config.modelId]: { id: config.modelId, name: config.modelId, tool_call: true,
          limit: { context: 200_000, output: config.maxOutputTokens }, options: { maxOutputTokens: config.maxOutputTokens } } } } },
      agent: { atoms: { mode: 'primary', steps: 24, permission,
        prompt: 'Edit the project files to fulfill the user request. Read relevant files first. Preserve protected files and all existing paths. Only change existing business TS/TSX files or add TS/TSX/CSS in src/generated. Do not use shell, network, tasks, skills or external directories. Finish with a brief text response.' } },
    }),
  };
}

export async function runOpenCode(input: Input): Promise<{ files: Array<{ path: string; content: string }> }> {
  const check = () => {
    try { input.check(); } catch (error) { throw error instanceof GenerationError ? error : new GenerationError('MODEL_UPSTREAM'); }
    if (input.signal.aborted) throw new GenerationError('CANCELLED');
  };
  const observe = (event: AgentEvent) => { try { input.observe(event); } catch { /* Observation cannot change execution. */ } };
  check();
  // 1.18.23 redirects managed config files (including /etc/opencode) with
  // OPENCODE_TEST_MANAGED_CONFIG_DIR, but independently loads these macOS plists
  // last. There is no preference-disable flag; reject hosts with either plist.
  if (process.platform === 'darwin') {
    const username = (() => { try { return userInfo().username || 'user'; } catch { return 'user'; } })();
    for (const path of [join('/Library/Managed Preferences', username, 'ai.opencode.managed.plist'),
      '/Library/Managed Preferences/ai.opencode.managed.plist']) {
      try { await fs.access(path); } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
        throw new GenerationError('MODEL_CONFIGURATION');
      }
      throw new GenerationError('MODEL_CONFIGURATION');
    }
  }
  check();
  let root: string;
  try { root = await mkdtemp(join(await realpath(tmpdir()), 'atoms-opencode-')); } catch { throw new GenerationError('FILE_POLICY'); }
  let writersStopped = true;
  let completed = false;
  try {
    const project = join(root, 'project');
    for (const directory of ['project', 'home', 'tmp', 'config', 'data', 'cache', 'state', 'managed']) await mkdir(join(root, directory), { mode: 0o700 });
    let initialBytes = 0;
    if (Object.keys(input.base.files).length > 64) throw new GenerationError('FILE_POLICY');
    for (const [path, content] of Object.entries(input.base.files)) {
      check();
      initialBytes += Buffer.byteLength(content);
      if (!validPath(path) || initialBytes > 2 * 1024 * 1024 || new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.from(content)) !== content) throw new GenerationError('FILE_POLICY');
      const target = join(project, path.slice(1));
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, content, { flag: 'wx', mode: 0o600 });
    }
    check();
    const child = (() => {
      try {
        return spawn(input.executable, ['run', '--format', 'json', '--model', `openai/${input.config.modelId}`, '--agent', 'atoms', '--dir', project, '--pure'],
          { cwd: project, env: environment(root, input.config), detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch { throw new GenerationError('MODEL_UPSTREAM'); }
    })();
    writersStopped = false;
    let failure: GenerationError | undefined;
    let latestMessage: string | undefined; let latestFinish: string | undefined;
    let session: string | undefined; let total = 0; let pending = Buffer.alloc(0); let forwardedTools = 0;
    const messages = new Set<string>();
    const starts = new Set<string>(); const finishes = new Set<string>(); const tools = new Set<string>();
    let stopping: Promise<void> | undefined;
    const stop = () => {
      if (stopping) return stopping;
      stopping = (async () => {
        const pid = child.pid;
        if (pid === undefined) { writersStopped = true; return; }
        // cwd/permissions are not an OS sandbox. Shell stays denied because the
        // process has the explicitly supplied model credential. Kill the group
        // even on normal exit, before reading files or removing its private root.
        const kill = (signal: NodeJS.Signals | 0) => { try { process.kill(-pid, signal); return true; } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
          throw new GenerationError('MODEL_UPSTREAM');
        } };
        if (kill('SIGTERM')) {
          await delay(350); kill('SIGKILL');
          for (let attempt = 0; attempt < 10; attempt++) {
            await delay(15);
            if (!kill(0)) { writersStopped = true; return; }
          }
          throw new GenerationError('MODEL_UPSTREAM');
        }
        writersStopped = true;
      })();
      return stopping;
    };
    const fail = (code: 'MODEL_UPSTREAM' | 'INVALID_OUTPUT' | 'FILE_POLICY' | 'CANCELLED') => {
      failure ??= new GenerationError(code); void stop().catch(() => { failure = new GenerationError('MODEL_UPSTREAM'); });
    };
    const parseLine = (line: Buffer) => {
      if (line.length > 512 * 1024 || !line.length) throw new GenerationError('INVALID_OUTPUT');
      let value: unknown;
      try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)); } catch { throw new GenerationError('INVALID_OUTPUT'); }
      const parsed = eventSchema.safeParse(value);
      if (!parsed.success) throw new GenerationError('INVALID_OUTPUT');
      const event = parsed.data;
      session ??= event.sessionID;
      if (session !== event.sessionID) throw new GenerationError('INVALID_OUTPUT');
      if (event.type === 'error') throw new GenerationError('MODEL_UPSTREAM');
      if (event.part.sessionID !== session) throw new GenerationError('INVALID_OUTPUT');
      if (!messages.has(event.part.messageID)) {
        messages.add(event.part.messageID); latestMessage = event.part.messageID; latestFinish = undefined;
      }
      if (event.part.messageID === latestMessage && (event.type === 'step_start' || event.type === 'tool_use')) latestFinish = undefined;
      if (event.type === 'step_start') starts.add(event.part.id);
      if (event.type === 'step_finish') {
        finishes.add(event.part.id);
        if (!['stop', 'tool-calls'].includes(event.part.reason)) throw new GenerationError('INVALID_OUTPUT');
        if (event.part.messageID === latestMessage) latestFinish = event.part.reason;
      }
      if (starts.size > 24 || finishes.size > 24) throw new GenerationError('INVALID_OUTPUT');
      if (event.type === 'tool_use') {
        const tool = toolSchema.safeParse(event.part.tool);
        if (!tool.success) throw new GenerationError('FILE_POLICY');
        if (!tools.has(event.part.callID)) {
          if (tools.size >= 512) throw new GenerationError('INVALID_OUTPUT');
          tools.add(event.part.callID);
          // Sample actual completions to leave room in the 128-frame SSE budget
          // for server validation/save and terminal events; still validate all.
          if (event.part.state.status === 'completed' && forwardedTools < 64) {
            forwardedTools++; observe({ type: 'agent-tool-finished', agentTool: tool.data });
          }
        }
      }
    };
    const account = (data: Buffer) => { total += data.length; if (total > 8 * 1024 * 1024) fail('INVALID_OUTPUT'); };
    child.stdout.on('data', (data: Buffer) => {
      account(data); if (failure) return;
      try {
        pending = Buffer.concat([pending, data]);
        let end = pending.indexOf(10);
        while (end >= 0) { parseLine(pending.subarray(0, end)); pending = pending.subarray(end + 1); end = pending.indexOf(10); }
        if (pending.length > 512 * 1024) throw new GenerationError('INVALID_OUTPUT');
      } catch (error) { fail(error instanceof GenerationError && error.code === 'MODEL_UPSTREAM' ? 'MODEL_UPSTREAM' : error instanceof GenerationError && error.code === 'FILE_POLICY' ? 'FILE_POLICY' : 'INVALID_OUTPUT'); }
    });
    child.stderr.on('data', account);
    child.stdout.on('error', () => fail('MODEL_UPSTREAM'));
    child.stderr.on('error', () => fail('MODEL_UPSTREAM'));
    child.stdin.on('error', () => fail('MODEL_UPSTREAM'));
    const abort = () => fail('CANCELLED');
    input.signal.addEventListener('abort', abort, { once: true });
    try {
      const code = await new Promise<number | null>(resolve => {
        child.once('error', () => fail('MODEL_UPSTREAM'));
        child.once('spawn', () => {
          observe({ type: 'agent-started' });
          if (input.signal.aborted) abort();
          else child.stdin.end(input.prompt);
        });
        child.once('exit', () => { void stop().catch(() => fail('MODEL_UPSTREAM')); });
        // Exit starts group cleanup; close alone confirms both pipes drained.
        child.once('close', code => resolve(code));
        if (input.signal.aborted) abort();
      });
      await stop();
      check();
      if (failure) throw failure;
      if (code !== 0) throw new GenerationError('MODEL_UPSTREAM');
      if (pending.length) parseLine(pending);
      // A stop at the configured step cap can be the CLI's forced summary;
      // neither stop nor saved edits prove the user's request is complete.
      if (latestFinish !== 'stop') throw new GenerationError('INVALID_OUTPUT');
    } finally {
      input.signal.removeEventListener('abort', abort);
      try { await stop(); } finally { child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); }
    }
    const files: Array<{ path: string; content: string }> = [];
    let bytes = 0; let entries = 0; let changedBytes = 0;
    const found = new Set<string>();
    const collect = async (directory: string, prefix: string, depth: number): Promise<void> => {
      check();
      if (depth > 32 || !(await lstat(directory)).isDirectory()) throw new GenerationError('FILE_POLICY');
      for await (const entry of await opendir(directory)) {
        const name = entry.name;
        check();
        if (++entries > 192) throw new GenerationError('FILE_POLICY');
        const path = `${prefix}/${name}`;
        if (!validPath(path)) throw new GenerationError('FILE_POLICY');
        const target = join(directory, name); const stat = await lstat(target);
        if (stat.isSymbolicLink()) throw new GenerationError('FILE_POLICY');
        if (stat.isDirectory()) { await collect(target, path, depth + 1); continue; }
        if (!stat.isFile() || stat.nlink !== 1 || found.size >= 64 || stat.size > 2 * 1024 * 1024 - bytes) throw new GenerationError('FILE_POLICY');
        const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        let content: string;
        try {
          const current = await handle.stat();
          if (!current.isFile() || current.nlink !== 1 || current.ino !== stat.ino || current.dev !== stat.dev || current.size !== stat.size) throw new GenerationError('FILE_POLICY');
          content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await handle.readFile());
        } finally { await handle.close(); }
        bytes += Buffer.byteLength(content); found.add(path);
        if (content !== input.base.files[path]) {
          changedBytes += Buffer.byteLength(content);
          if (!writable(path, Object.hasOwn(input.base.files, path)) || !content.trim() || files.length >= 8 || changedBytes > 256 * 1024) throw new GenerationError('FILE_POLICY');
          files.push({ path, content });
        }
      }
    };
    await collect(project, '', 0);
    if (Object.keys(input.base.files).some(path => !found.has(path)) || !files.length) throw new GenerationError('FILE_POLICY');
    check(); completed = true;
    return { files: files.sort((a, b) => a.path.localeCompare(b.path)) };
  } catch (error) {
    if (error instanceof GenerationError) throw error;
    if (input.signal.aborted) throw new GenerationError('CANCELLED');
    throw new GenerationError('FILE_POLICY');
  } finally {
    // If process-group termination cannot be confirmed, retain the private root
    // instead of racing a live writer during recursive removal.
    if (writersStopped) {
      await rm(root, { recursive: true, force: true }).catch(() => { throw new GenerationError('FILE_POLICY'); });
    }
    if (completed) { check(); observe({ type: 'agent-finished' }); }
  }
}
