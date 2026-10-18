#!/usr/bin/env node
// Exercises the default CLI boundary without a provider or injected transport.
const fs = require('node:fs');
const path = require('node:path');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const messages = JSON.parse(input);
  if (!Array.isArray(messages) || messages.some(message => typeof message.content !== 'string')) {
    throw new Error('Expected serialized ModelMessage context');
  }
  const prompt = messages.at(-1).content;
  const mode = /ATOMS_FIXTURE:(success|add|protected|noop|cancel|error)/.exec(prompt)?.[1];
  if (!mode) throw new Error('Missing current-request fixture mode');
  const project = process.cwd();
  let sequence = 0;
  const emit = (type, part) => process.stdout.write(JSON.stringify({ type, timestamp: Date.now(), sessionID: 'fixture-session',
    part: { id: `part-${++sequence}`, messageID: 'fixture-message', sessionID: 'fixture-session', ...part } }) + '\n');
  const tool = name => emit('tool_use', { type: 'tool', callID: name, tool: name,
    state: { status: 'completed', input: { secret: 'PRIVATE_TOOL_INPUT' }, output: 'PRIVATE_TOOL_OUTPUT' } });
  const original = fs.readFileSync('src/App.tsx', 'utf8');
  if (mode === 'cancel') {
    process.on('SIGTERM', () => fs.writeFileSync(__filename + '.term', 'ignored'));
    setInterval(() => {}, 100);
  }
  fs.appendFileSync(__filename + '.reports', JSON.stringify({ pid: process.pid, root: path.dirname(project), project,
    args: process.argv.slice(2), messages, original, backendSecret: process.env.ATOMS_BACKEND_TEST_SECRET ?? null }) + '\n');
  process.stderr.write('PRIVATE_STDERR fake-opencode-api-secret\n');
  if (mode === 'error') {
    process.stdout.write(JSON.stringify({ type: 'error', timestamp: Date.now(), sessionID: 'fixture-session',
      error: { name: 'APIError', data: { message: 'PRIVATE_PROVIDER_ERROR fake-opencode-api-secret' } } }) + '\n');
    return;
  }
  tool('read');
  if (mode !== 'noop') {
    fs.writeFileSync('src/App.tsx', original + '\nexport function OpenCodeFixture() { return <aside>Fixture change</aside>; }\n');
    tool('edit');
  }
  if (mode === 'add') {
    fs.mkdirSync('src/generated', { recursive: true });
    fs.writeFileSync('src/generated/fixture.ts', 'export const fixture = true;\n');
    tool('write');
  }
  if (mode === 'protected') fs.writeFileSync('src/main.tsx', '// PRIVATE_PROTECTED_CHANGE\n');
  if (mode === 'cancel') return;
  emit('text', { type: 'text', text: 'PRIVATE_AGENT_STDOUT fake-opencode-api-secret', time: { start: 1, end: 2 } });
  emit('step_finish', { type: 'step-finish', reason: 'stop' });
});
