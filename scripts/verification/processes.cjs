const { execFileSync, spawn } = require('node:child_process');
const { appendFileSync, createWriteStream, existsSync, readFileSync } = require('node:fs');
const { setTimeout: delay } = require('node:timers/promises');

function processRows() {
  const text = execFileSync('/bin/ps', ['-axww', '-o', 'pid=,ppid=,pgid=,stat=,lstart=,command='], { encoding: 'utf8', env: { PATH: process.env.PATH, LC_ALL: 'C' }, timeout: 2000, maxBuffer: 16 * 1024 * 1024 });
  return text.split('\n').flatMap(line => {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+\d\d:\d\d:\d\d\s+\d{4})\s+(.+)$/);
    return m && !/[ZE]/.test(m[4]) ? [{ pid: +m[1], parent: +m[2], group: +m[3], stat: m[4], start: m[5].replace(/\s+/g, ' '), command: m[6] }] : [];
  });
}
const matches = (a, b) => !!a && !!b && a.pid === b.pid && a.start === b.start && a.command === b.command;
// macOS briefly reports only '(node)' while an exiting process still has an Ss row.
// Never signal such an ambiguous row: wait for disappearance within the cleanup budget.
const exitStub = (expected, current) => expected?.start === current?.start && /^\([a-zA-Z0-9._-]+\)$/.test(current.command);
const identities = new Map();
function descendants(rows, seeds) {
  const owned = new Map(seeds.filter(seed => rows.some(row => matches(seed, row))).map(seed => [seed.pid, rows.find(row => matches(seed, row))]));
  for (;;) { const next = rows.filter(row => !owned.has(row.pid) && owned.has(row.parent)); if (!next.length) break; for (const row of next) owned.set(row.pid, row); }
  return [...owned.values()];
}
function ownChild(child) {
  if (!child.pid) return child;
  const row = processRows().find(item => item.pid === child.pid); if (!row) return child;
  identities.set(child, [row]);
  const contextPath = process.env.ATOMS_VERIFY_CONTEXT;
  if (contextPath) {
    const context = JSON.parse(readFileSync(contextPath, 'utf8'));
    if (typeof context.ledger !== 'string' || !context.ledger.endsWith('.jsonl')) throw new Error('UNSAFE_PROCESS_LEDGER');
    appendFileSync(context.ledger, JSON.stringify(row) + '\n', { mode: 0o600 });
  }
  return child;
}
function ownedRows(child) {
  if (!child?.pid) return [];
  const seeds = identities.get(child); if (!seeds) { if (processRows().some(row => row.pid === child.pid)) throw new Error('CLEANUP_INCOMPLETE'); return []; }
  const rows = processRows();
  const pending = [];
  for (const seed of seeds) { const current = rows.find(row => row.pid === seed.pid); if (current && !matches(seed, current)) { if (exitStub(seed, current)) pending.push(current); else throw new Error('CLEANUP_INCOMPLETE'); } }
  const owned = descendants(rows, seeds); identities.set(child, [...new Map([...seeds, ...owned].map(row => [row.pid, row])).values()]);
  return [...owned, ...pending];
}
function signalOwned(child, signal) {
  const rows = ownedRows(child);
  for (const row of rows.reverse()) {
    const seed = identities.get(child)?.find(item => item.pid === row.pid); if (!matches(seed, row)) continue;
    if (/^\([a-zA-Z0-9._-]+\)$/.test(row.command)) continue;
    const current = processRows().find(item => item.pid === row.pid); if (!current) continue;
    if (!matches(row, current)) { if (exitStub(row, current)) continue; throw new Error('CLEANUP_INCOMPLETE'); }
    try { process.kill(row.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}
function groupAlive(child) { return ownedRows(child).length > 0; }

// Parent watchdog also follows pnpm/browser descendants and explicitly enrolled detached services.
async function runCommand({ command, args = [], cwd, env, timeoutMs, signal, log, ledger, cleanupMs = 10_000, graceMs = 3000, observe = processRows }) {
  const started = Date.now(); const output = log ? createWriteStream(log, { flags: 'a', mode: 0o600 }) : null;
  const known = new Map(); let compromised = false; let reason = null; let child;
  const collect = () => {
    try {
      const rows = observe();
      for (const row of descendants(rows, [...known.values()])) known.set(row.pid, row);
      if (ledger && existsSync(ledger)) {
        const raw = readFileSync(ledger, 'utf8'); if (raw.length > 4 * 1024 * 1024) throw new Error();
        for (const line of raw.split('\n').filter(Boolean)) { const item = JSON.parse(line);
          if (!Number.isSafeInteger(item.pid) || item.pid <= 1 || typeof item.start !== 'string' || typeof item.command !== 'string') throw new Error();
          const current = rows.find(row => row.pid === item.pid); if (current && !matches(current, item) && !exitStub(item, current)) compromised = true;
          if (!known.has(item.pid)) { if (!known.has(item.parent)) { compromised = true; continue; } known.set(item.pid, item); }
        }
      }
      for (const row of descendants(rows, [...known.values()])) known.set(row.pid, row);
      return rows;
    } catch { compromised = true; return []; }
  };
  try {
    if (signal?.aborted) return { status: 'cancelled', reason: 'SIGNAL', exitCode: null, cleanup: 'passed', durationMs: 0 };
    child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    if (output) { child.stdout.pipe(output, { end: false }); child.stderr.pipe(output, { end: false }); } else { child.stdout.resume(); child.stderr.resume(); }
    if (child.pid) { const first = observe().find(row => row.pid === child.pid); if (first) known.set(first.pid, first); }
    const monitor = setInterval(collect, 100); monitor.unref();
    let timer; let abort;
    const ended = new Promise(resolve => {
      child.once('error', () => resolve({ code: null, error: true })); child.once('exit', (code, exitSignal) => resolve({ code, exitSignal }));
    });
    const stopped = new Promise(resolve => {
      abort = () => { reason = 'SIGNAL'; resolve({ code: null }); }; signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      timer = setTimeout(() => { reason = 'TIMEOUT'; resolve({ code: null }); }, Math.max(1, timeoutMs));
    });
    let result;
    try { result = await Promise.race([ended, stopped]); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    // Give the runner's normal finally a brief opportunity before identifying residue.
    if (!reason) await delay(100);
    let rows = collect(); const survivors = () => [...known.values()].flatMap(item => {
      const current = rows.find(row => row.pid === item.pid); if (!current) return [];
      if (!matches(item, current)) { if (exitStub(item, current)) return [{ ...current, ambiguous: true }]; compromised = true; return []; } return [current];
    });
    const hadResidue = survivors().some(row => !row.ambiguous); const deadline = Date.now() + cleanupMs;
    function send(sig) {
      for (const row of survivors().reverse()) {
        if (row.ambiguous) continue;
        const current = observe().find(item => item.pid === row.pid); if (!current) continue;
        if (!matches(row, current)) { if (!exitStub(row, current)) compromised = true; continue; }
        try { process.kill(row.pid, sig); } catch (error) { if (error.code !== 'ESRCH') compromised = true; }
      }
    }
    if (hadResidue) send('SIGTERM');
    const escalate = Date.now() + graceMs;
    while (survivors().length && Date.now() < deadline) { if (Date.now() >= escalate) send('SIGKILL'); await delay(50); rows = collect(); }
    clearInterval(monitor); rows = collect();
    const cleanup = compromised || survivors().length ? 'failed' : 'passed';
    const status = cleanup === 'failed' || !reason && hadResidue ? 'failed' : reason === 'SIGNAL' ? 'cancelled' : reason || result.code !== 0 ? 'failed' : 'passed';
    return { status, reason: cleanup === 'failed' || !reason && hadResidue ? 'CLEANUP_INCOMPLETE' : reason ?? (result.error ? 'SPAWN_FAILED' : result.code !== 0 ? 'COMMAND_FAILED' : null), exitCode: result.code, cleanup, durationMs: Date.now() - started };
  } finally { if (output) await new Promise(resolve => output.end(resolve)); }
}
async function closeBrowser(browser) {
  if (!browser) return;
  let timer;
  try { await Promise.race([browser.close(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('CLEANUP_INCOMPLETE')), 3000); })]); }
  finally { clearTimeout(timer); }
}
module.exports = { processRows, matches, descendants, ownChild, signalOwned, groupAlive, closeBrowser, runCommand };
