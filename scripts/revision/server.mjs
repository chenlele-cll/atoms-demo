// Test-only construction: the production server has no fixture configuration.
import {resolve, isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';

const [dist, database, upstream] = process.argv.slice(2);
if (!dist || !isAbsolute(dist) || !database || !isAbsolute(database) || !/^http:\/\/127\.0\.0\.1:\d+$/.test(upstream ?? '')) {
  process.stderr.write('INVALID_FIXTURE_ARGUMENTS\n'); process.exit(2);
}
const load = name => import(pathToFileURL(resolve(dist, name)).href);
const {acquireOwnership} = await load('storage/ownership.js');
const {openStore} = await load('storage/store.js');
const {loadCatalog} = await load('templates/catalog.js');
const {buildApp} = await load('app.js');
let app, store, ownership, closing, stopping = false;
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
  ownership = await acquireOwnership(database, () => { lost.abort(); void close(); });
  if (stopping) await ownership.release();
  else {
    store = openStore(ownership.filename); store.recoverRunning();
    app = buildApp({}, {store, catalog, origins: ['http://127.0.0.1:4173'], secureCookies: false,
      ownershipSignal: lost.signal, releaseOwnership: ownership.release,
      generation: {env: {OPENAI_API_KEY: 'sk-revision-explicit-fixture', MODEL_ID: 'gpt-6.1-sol'},
        transport: (url, init) => {
          const target = new URL(String(url));
          if (target.origin !== 'https://api.openai.com' || target.pathname !== '/v1/responses') throw Error('FIXTURE_REMOTE_FORBIDDEN');
          return fetch(upstream + target.pathname, {...init, redirect: 'error'});
        }}});
    if (stopping) await close();
    else await app.listen({host: '127.0.0.1', port: 3001});
  }
} catch {
  process.stderr.write('FIXTURE_STARTUP_FAILED\n'); process.exitCode = 1;
  await close().catch(() => {});
}
