import { mkdir, open, realpath } from 'node:fs/promises';
import { dirname } from 'node:path';
import lockfile from 'proper-lockfile';
import { ProjectError } from '../projects/errors.js';

export async function acquireOwnership(filename: string, onCompromised: () => void) {
  try {
    await mkdir(dirname(filename), { recursive: true });
    try { const handle = await open(filename, 'wx', 0o600); await handle.close(); }
    catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error; }
    const canonical = await realpath(filename);
    let compromised = false; let released = false;
    const release = await lockfile.lock(canonical, { stale: 30_000, update: 5000, retries: 0,
      lockfilePath: `${canonical}.generation.lock`, onCompromised: () => { compromised = true; onCompromised(); } });
    return { filename: canonical, release: async () => {
      if (released) return; released = true;
      // The library has already revoked a compromised owner. Never remove another owner's lock.
      if (!compromised) await release();
    } };
  } catch { throw new ProjectError('OWNERSHIP_UNAVAILABLE'); }
}
