import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProjectError } from './errors.js';

export function readPersistenceConfig(env: NodeJS.ProcessEnv) {
  const rawPath = env['DATABASE_PATH'] ?? '../data/atoms.sqlite';
  const databasePath = resolve(rawPath.trim());
  const dist = fileURLToPath(new URL('../../dist/', import.meta.url));
  const relation = relative(dist, databasePath);
  if (!rawPath.trim() || rawPath.includes('\0') || rawPath.trim() === ':memory:' || rawPath.startsWith('file:') ||
      relation === '' || (!relation.startsWith('..') && !isAbsolute(relation))) throw new ProjectError('INVALID_CONFIGURATION');
  const origins = (env['APP_ORIGINS'] ?? 'http://127.0.0.1:5173,http://127.0.0.1:4173').split(',');
  let secureCookies: boolean;
  try {
    if (!origins.length || origins.length > 8) throw new Error();
    const urls = origins.map(origin => {
      const url = new URL(origin);
      if (url.origin !== origin || url.username || url.password || !['http:', 'https:'].includes(url.protocol)) throw new Error();
      if (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error();
      return url;
    });
    if (urls.some(url => url.protocol === 'http:') && urls.some(url => url.protocol === 'https:')) throw new Error();
    secureCookies = urls.every(url => url.protocol === 'https:');
  } catch { throw new ProjectError('INVALID_CONFIGURATION'); }
  return { databasePath, origins, secureCookies };
}
