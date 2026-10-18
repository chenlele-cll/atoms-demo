import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { buildApp } from './app.js';
import { readConfig } from './config.js';
import { readPersistenceConfig } from './projects/config.js';
import { ProjectError } from './projects/errors.js';
import { openStore } from './storage/store.js';
import type { ProjectStore } from './storage/store.js';
import { loadCatalog } from './templates/catalog.js';
import { acquireOwnership } from './storage/ownership.js';

let app: ReturnType<typeof buildApp> | undefined;
let store: ProjectStore | undefined;
let stopping = false;
let ownership: Awaited<ReturnType<typeof acquireOwnership>> | undefined;
const ownershipLost = new AbortController();
let closing: Promise<void> | undefined;

async function close() {
  stopping = true;
  return closing ??= (async () => {
    try { await app?.close(); } finally {
      try { store?.close(); } finally { await ownership?.release(); }
    }
  })();
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    close().catch(() => { process.stderr.write('Backend shutdown failed.\n'); process.exitCode = 1; });
  });
}

async function start() {
  if (existsSync('.env')) {
    loadEnvFile('.env');
  }

  const config = readConfig(process.env);
  const persistence = readPersistenceConfig(process.env);
  const catalog = await loadCatalog();
  if (stopping) return;
  ownership = await acquireOwnership(persistence.databasePath, () => {
    ownershipLost.abort();
    process.stderr.write('Database service ownership lost.\n');
    process.exitCode = 1;
    void close().catch(() => { process.stderr.write('Backend shutdown failed.\n'); });
  });
  if (stopping) { await ownership.release(); return; }
  store = openStore(ownership.filename);
  store.recoverRunning();
  app = buildApp({}, { store, catalog, origins: persistence.origins, secureCookies: persistence.secureCookies,
    ownershipSignal: ownershipLost.signal, releaseOwnership: ownership.release });
  if (stopping) { await close(); return; }
  await app.listen(config);
}

start().catch(async (error: unknown) => {
  const safe = error instanceof ProjectError ? error : new ProjectError('INVALID_CONFIGURATION');
  if (app) app.log.error({ err: { name: 'ProjectError', message: safe.message, code: safe.code } }, 'Backend startup failed');
  else process.stderr.write(`${JSON.stringify({ error: { code: safe.code, message: safe.message } })}\n`);
  try { await close(); } catch { process.stderr.write('Backend cleanup failed.\n'); }
  finally { process.exitCode = 1; }
});
