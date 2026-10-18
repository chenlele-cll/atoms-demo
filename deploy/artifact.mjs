// The producer remains authoritative. This entry also runs in the private
// transported kit, without loading dependencies from an unverified package.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { lstat, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { validateRelease } from '../scripts/release/artifact.mjs';

const CODES = new Set(['RELEASE_MANIFEST', 'RELEASE_PLATFORM', 'RELEASE_CHANGED', 'UNSAFE_RELEASE',
  'RELEASE_LAYOUT', 'MISSING_ASSET', 'RELEASE_DEV_DEPENDENCY', 'UNSAFE_INPUT', 'STALE_INPUT']);
async function main() {
  const [action, directory, extra] = process.argv.slice(2);
  if (!directory || !path.isAbsolute(directory)) throw Error('INVALID_ARGUMENTS');
  if (action === 'snapshot') {
    if (!extra || !path.isAbsolute(extra)) throw Error('INVALID_ARGUMENTS');
    const { copyInputs } = await import('../scripts/verification/input.mjs');
    const { releaseInput } = await import('../scripts/release.mjs');
    const result = await copyInputs(directory, extra, { select: releaseInput });
    if (result.entries.some(entry => entry.target)) throw Error('UNSAFE_INPUT');
    return { sourceDigest: result.copyDigest, count: result.entries.length };
  }
  // Metadata mode still verifies every byte/link/mode. It merely defers native
  // platform validation to the target node that will run the application.
  const file = await lstat(path.join(directory, 'release.json'));
  if (!file.isFile() || file.isSymbolicLink() || file.size > 16 * 1024 * 1024) throw Error('RELEASE_MANIFEST');
  const metadata = action === 'metadata' ? JSON.parse(await readFile(path.join(directory, 'release.json'), 'utf8')) : null;
  const manifest = await validateRelease(directory, metadata
    ? { platform: metadata.platform, arch: metadata.arch, modulesABI: metadata.modulesABI } : {});
  // Root-owned releases must be readable/traversable by the service and Nginx.
  // pnpm's three installation metadata files are deliberately private and are
  // never read by Node at runtime. Do not rewrite any inventoried modes.
  const privateMetadata = new Set(['backend/pnpm-lock.yaml', 'backend/pnpm-workspace.yaml', 'backend/node_modules/.pnpm-workspace-state-v1.json']);
  for (const entry of manifest.entries) {
    if (entry.type !== 'link' && (entry.mode & 0o022)
      || entry.type === 'directory' && (entry.mode & 0o005) !== 0o005
      || entry.type === 'file' && !privateMetadata.has(entry.path) && !(entry.mode & 0o004)) throw Error('RELEASE_LAYOUT');
  }
  const result = Object.fromEntries(['releaseId', 'releaseDigest', 'sourceDigest', 'buildDigest', 'lockDigest', 'platform', 'arch', 'modulesABI', 'node', 'pnpm'].map(key => [key, manifest[key]]));
  if (action === 'schema') {
    const module = await import(pathToFileURL(path.join(directory, 'backend/dist/storage/migrations.js')).href);
    const versions = module.migrations.map(item => item.version);
    if (!versions.length || versions.some((version, index) => version !== index + 1)) throw Error('INVALID_SCHEMA');
    return { ...result, schemaMax: versions.at(-1) };
  }
  if (action === 'probe') {
    if (!extra || !path.isAbsolute(extra)) throw Error('INVALID_ARGUMENTS');
    const require = createRequire(path.join(directory, 'backend/package.json'));
    const Database = require('better-sqlite3');
    const contracts = await import(pathToFileURL(path.join(directory, 'backend/node_modules/@atoms/contracts/dist/index.js')).href);
    if (!contracts.snapshotSchema) throw Error('NATIVE_PROBE_FAILED');
    const db = new Database(extra);
    try { db.exec('CREATE TABLE probe(value INTEGER)'); db.prepare('INSERT INTO probe VALUES(?)').run(7); if (db.prepare('SELECT value FROM probe').get().value !== 7) throw Error('NATIVE_PROBE_FAILED'); }
    finally { db.close(); await unlink(extra).catch(() => {}); }
  } else if (!['verify', 'metadata'].includes(action)) throw Error('INVALID_ARGUMENTS');
  return result;
}
try { console.log(JSON.stringify({ ok: true, ...await main() })); }
catch (error) { console.log(JSON.stringify({ ok: false, code: CODES.has(error.message) ? error.message : 'ARTIFACT_INVALID' })); process.exitCode = 2; }
