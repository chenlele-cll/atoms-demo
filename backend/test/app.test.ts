import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';

test('health endpoint identifies the backend and disables caching', async (t) => {
  const app = buildApp({ logger: false });
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/api/health' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok', service: 'atoms-backend' });
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('unknown API routes return 404 rather than the frontend document', async (t) => {
  const app = buildApp({ logger: false });
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/api/missing' });

  assert.equal(response.statusCode, 404);
  assert.match(String(response.headers['content-type']), /application\/json/);
});
