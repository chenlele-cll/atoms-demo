#!/usr/bin/env node
// Deterministic subprocess protocol fixture. Never contacts a model provider.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const request = JSON.parse(input);
  const mode = request.mode;
  const project = process.cwd();
  let sequence = 0;
  const emit = (type, part) => process.stdout.write(JSON.stringify({ type, timestamp: Date.now(), sessionID: 'session',
    part: { id: `part-${++sequence}`, messageID: 'message', sessionID: 'session', ...part } }) + '\n');
  const done = () => emit('step_finish', { type: 'step-finish', reason: 'stop' });
  const change = () => {
    const previous = fs.readFileSync('src/App.tsx', 'utf8');
    fs.writeFileSync('src/App.tsx', previous + '\n// fixture edit');
    emit('tool_use', { type: 'tool', callID: 'read', tool: 'read', state: { status: 'completed' } });
    emit('tool_use', { type: 'tool', callID: 'edit', tool: 'edit', state: { status: 'completed' } });
  };
  if (request.report) fs.writeFileSync(request.report, JSON.stringify({ project, root: path.dirname(project), pid: process.pid,
    args: process.argv.slice(2), env: process.env, prompt: request.secret,
    managedEntries: process.env.OPENCODE_TEST_MANAGED_CONFIG_DIR ? fs.readdirSync(process.env.OPENCODE_TEST_MANAGED_CONFIG_DIR) : null }));
  if (mode === 'cancel' || mode === 'descendant') {
    const child = spawn(process.execPath, ['-e', `
      const fs = require('node:fs');
      process.on('SIGTERM', () => {});
      fs.writeFileSync(${JSON.stringify(request.descendant)}, String(process.pid));
      setInterval(() => {
        fs.mkdirSync(${JSON.stringify(path.join(project, 'src/generated'))}, { recursive: true });
        fs.writeFileSync(${JSON.stringify(path.join(project, 'src/generated/writer.ts'))}, 'export {};');
      }, 20);
    `], { stdio: 'ignore' });
    child.unref();
    change();
    if (mode === 'cancel') { process.on('SIGTERM', () => {}); setInterval(() => {}, 100); }
    else {
      const ready = setInterval(() => {
        if (!fs.existsSync(request.descendant)) return;
        clearInterval(ready); done(); process.exit(0);
      }, 10);
    }
    return;
  }
  if (mode === 'malformed') { process.stdout.write('sensitive malformed provider output\n'); return; }
  if (mode === 'malformed-tail') { process.stdout.write('sensitive malformed provider output'); return; }
  if (mode === 'invalid-event') { process.stdout.write('{"type":"text","part":{"text":"sensitive"}}\n'); return; }
  if (mode === 'invalid-json-utf8') { process.stdout.write(Buffer.from([0xff, 10])); return; }
  if (mode === 'large-line') { process.stdout.write('x'.repeat(512 * 1024 + 1)); return; }
  if (mode === 'noisy') { for (let i = 0; i < 145; i++) process.stderr.write('sensitive'.repeat(8192)); return; }
  if (mode === 'error') { process.stdout.write(JSON.stringify({ type: 'error', timestamp: 1, sessionID: 'session', error: { name: 'APIError', data: { message: 'sensitive secret upstream body' } } }) + '\n'); return; }
  if (mode === 'nonzero') { change(); done(); process.stderr.write('sensitive secret stderr'); process.exitCode = 3; return; }
  if (mode === 'empty') return;
  if (mode === 'noop') { done(); return; }
  change();
  fs.mkdirSync('src/generated', { recursive: true });
  if (mode === 'intermediate-error') {
    emit('text', { type: 'text', text: 'sensitive intermediate commentary', time: { start: 1, end: 2 } });
    emit('tool_use', { type: 'tool', callID: 'failed', tool: 'edit', state: { status: 'error' } });
    emit('step_finish', { type: 'step-finish', reason: 'tool-calls' });
    return;
  }
  if (mode.startsWith('prior-stop-')) {
    done();
    if (mode === 'prior-stop-start') emit('step_start', { type: 'step-start' });
    if (mode === 'prior-stop-tool') emit('tool_use', { type: 'tool', callID: 'later', tool: 'read', state: { status: 'completed' } });
    if (mode === 'prior-stop-tool-error') emit('tool_use', { type: 'tool', callID: 'later', tool: 'read', state: { status: 'error' } });
    if (mode === 'prior-stop-text' || mode === 'prior-stop-stale') emit('text', { type: 'text', messageID: 'later-message', text: 'sensitive later work', time: { start: 3, end: 4 } });
    if (mode === 'prior-stop-stale') done();
    if (mode === 'prior-stop-tool-calls') emit('step_finish', { type: 'step-finish', reason: 'tool-calls' });
    return;
  }
  if (mode === 'tool-error-no-stop') {
    emit('tool_use', { type: 'tool', callID: 'failed', tool: 'read', state: { status: 'error' } });
    return;
  }
  if (mode === 'many-tools' || mode === 'too-many-tools' || mode === 'sampled-error' || mode === 'sampled-denied') {
    const count = mode === 'too-many-tools' ? 511 : mode.startsWith('sampled-') ? 509 : 510;
    for (let i = 0; i < count; i++) emit('tool_use', { type: 'tool', callID: `many-${i}`, tool: 'read', state: { status: 'completed' } });
    // Keep the oversized producer alive until the parent can reject and stop it.
    if (mode === 'too-many-tools') setTimeout(() => {}, 50);
    if (mode === 'sampled-error') {
      emit('tool_use', { type: 'tool', callID: 'late-failed', tool: 'edit', state: { status: 'error' } });
      emit('step_finish', { type: 'step-finish', reason: 'tool-calls' }); return;
    }
    if (mode === 'sampled-denied') emit('tool_use', { type: 'tool', callID: 'late-denied', tool: 'bash', state: { status: 'error' } });
  }
  if (mode === 'at-step-cap') {
    for (let i = 0; i < 24; i++) {
      const messageID = `step-${i}`;
      emit('step_start', { type: 'step-start', messageID });
      if (i === 23) emit('text', { type: 'text', messageID, text: 'sensitive forced summary', time: { start: 1, end: 2 } });
      emit('step_finish', { type: 'step-finish', messageID, reason: i === 23 ? 'stop' : 'tool-calls' });
    }
    return;
  }
  if (mode === 'add') {
    fs.writeFileSync('src/generated/new.ts', 'export const fixture = true;');
    for (const tool of ['glob', 'grep', 'write', 'apply_patch']) emit('tool_use', { type: 'tool', callID: tool, tool, state: { status: 'completed' } });
    emit('tool_use', { type: 'tool', callID: 'write', tool: 'write', state: { status: 'completed' } });
  }
  if (mode === 'delete') fs.unlinkSync('src/main.tsx');
  if (mode === 'protected') fs.writeFileSync('src/main.tsx', 'sensitive protected change');
  if (mode === 'symlink') fs.symlinkSync('/etc/passwd', 'src/generated/link.ts');
  if (mode === 'directory-symlink') fs.symlinkSync('/tmp', 'src/generated/link');
  if (mode === 'hardlink') fs.linkSync('src/App.tsx', 'src/generated/link.ts');
  if (mode === 'invalidutf8') fs.writeFileSync('src/generated/bad.ts', Buffer.from([0xff]));
  if (mode === 'special') require('node:child_process').execFileSync('/usr/bin/mkfifo', ['src/generated/pipe.ts']);
  if (mode === 'badpath') fs.writeFileSync('src/generated/bad%2e.ts', 'export {};');
  if (mode === 'blank') fs.writeFileSync('src/App.tsx', '  ');
  if (mode === 'oversized-change') fs.writeFileSync('src/App.tsx', 'x'.repeat(256 * 1024 + 1));
  if (mode === 'oversized-snapshot') fs.writeFileSync('src/generated/huge.ts', 'x'.repeat(2 * 1024 * 1024));
  if (mode === 'too-many-changes') for (let i = 0; i < 8; i++) fs.writeFileSync(`src/generated/new${i}.ts`, 'export {};');
  if (mode === 'too-many-files') for (let i = 0; i < 65; i++) fs.writeFileSync(`src/generated/new${i}.ts`, 'export {};');
  if (mode === 'denied-tool') emit('tool_use', { type: 'tool', callID: 'bash', tool: 'bash', state: { status: 'completed' } });
  if (mode === 'tool-error') emit('tool_use', { type: 'tool', callID: 'failed', tool: 'read', state: { status: 'error' } });
  if (mode === 'steps') for (let i = 0; i < 25; i++) emit('step_start', { type: 'step-start' });
  if (mode === 'finish-steps') for (let i = 0; i < 25; i++) emit('step_finish', { type: 'step-finish', reason: 'tool-calls' });
  if (mode === 'truncated') { emit('text', { type: 'text', text: 'sensitive partial text', time: { start: 1, end: 2 } }); emit('step_finish', { type: 'step-finish', reason: 'length' }); return; }
  if (mode === 'text' || mode === 'text-only') emit('text', { type: 'text', text: 'sensitive finished text', time: { start: 1, end: 2 } });
  if (mode !== 'no-completion' && mode !== 'text-only') done();
});
