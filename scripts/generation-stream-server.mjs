// Test-only launcher: uses the built application and a loopback SDK transport, never production credentials.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [dist, database, portValue, upstream] = process.argv.slice(2);
const port = Number(portValue);
if (!dist || !database || !Number.isInteger(port) || port < 0 || port > 65535 || !upstream || !/^http:\/\/127\.0\.0\.1:\d+$/.test(upstream)) {
  process.stderr.write('Invalid generation fixture launcher arguments.\n'); process.exit(1);
}
const load = name => import(pathToFileURL(resolve(dist, name)).href);
const { acquireOwnership } = await load('storage/ownership.js');
const { openStore } = await load('storage/store.js');
const { loadCatalog } = await load('templates/catalog.js');
const { buildApp } = await load('app.js');
let ownership; let store; let app; let closing; let stopping = false;
const lost = new AbortController();
function close() {
  stopping = true;
  return closing ??= (async () => {
    try { await app?.close(); } finally { try { store?.close(); } finally { await ownership?.release(); } }
  })();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void close().catch(() => { process.exitCode = 1; }); });
try {
  const catalog = await loadCatalog();
  ownership = await acquireOwnership(database, () => { lost.abort(); process.exitCode = 1; void close().catch(() => {}); });
  if (stopping) await ownership.release();
  else {
    store = openStore(ownership.filename); store.recoverRunning();
    app = buildApp({ logger: false }, { store, catalog, origins: ['http://127.0.0.1:5173', 'http://127.0.0.1:4173'], secureCookies: false,
      limits: { sessionPerMinute: 1000, projectsPerMinute: 1000, projectsPerSession: 100 },
      ownershipSignal: lost.signal, releaseOwnership: ownership.release,
      generation: { env: { OPENAI_API_KEY: 'sk-explicit-stream-fixture', MODEL_ID: 'gpt-6.1-sol', MODEL_TIMEOUT_MS: '120000' },
        limits: { postPerMinute: 1000, queryPerMinute: 1000, cancelPerMinute: 1000 },
        transport: (url, init) => {
          const target = new URL(String(url));
          if (target.origin !== 'https://api.openai.com') throw new Error('Unexpected fixture origin');
          return fetch(`${upstream}${target.pathname}`, init);
        } } });
    if (stopping) await close();
    else { const address = await app.listen({ port, host: '127.0.0.1' }); process.stdout.write(`${JSON.stringify({ source: 'fixture', address })}\n`); }
  }
} catch {
  process.stderr.write('Generation fixture startup failed.\n'); process.exitCode = 1;
  await close().catch(() => {});
}
