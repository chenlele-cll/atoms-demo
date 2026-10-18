import { appendFileSync } from 'node:fs';
export function isModelDestination(input) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return false;
  return ['api.openai.com', 'ai.elegantyc.com'].includes(url.hostname) || /\/(?:v1\/)?(?:responses|chat\/completions|messages|models)(?:\/|$)/.test(url.pathname);
}
export function guardFetch(fetcher, record) {
  return (input, init) => { if (isModelDestination(input)) { record(); return Promise.reject(new Error('MODEL_NETWORK_FORBIDDEN')); } return fetcher(input, init); };
}
if (process.env.ATOMS_VERIFY_NETWORK_LOG) globalThis.fetch = guardFetch(globalThis.fetch, () => appendFileSync(process.env.ATOMS_VERIFY_NETWORK_LOG, 'MODEL_NETWORK_FORBIDDEN\n', { mode: 0o600 }));
