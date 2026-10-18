import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.js';
import { readModelConfig } from '../src/model/config.js';
import { ModelError } from '../src/model/errors.js';
import { fixtureEnv, sentinel } from './helpers/model-fixture.js';

test('model config is lazy and health does not import or initialize model services', async () => {
  const app = buildApp({ logger: false });
  try { assert.equal((await app.inject('/api/health')).statusCode, 200); }
  finally { await app.close(); }
  assert.deepEqual(readModelConfig(fixtureEnv), {
    apiKey: sentinel, modelId: 'gpt-6.1-sol', baseURL: 'https://api.openai.com/v1', timeoutMs: 1000, maxOutputTokens: 4096,
  });
  assert.equal(readModelConfig({ ...fixtureEnv, MODEL_TIMEOUT_MS: undefined }).timeoutMs, 60_000);
  assert.equal(readModelConfig({ ...fixtureEnv, MODEL_TIMEOUT_MS: '120000', MODEL_MAX_OUTPUT_TOKENS: '8192' }).maxOutputTokens, 8192);
  assert.equal(readModelConfig({ ...fixtureEnv, MODEL_MAX_OUTPUT_TOKENS: '256' }).maxOutputTokens, 256);
});

test('invalid credentials, identifiers and bounded integer settings fail without echoing values', () => {
  const invalid: NodeJS.ProcessEnv[] = [{},
    ...['', ' ', 'secret\nheader'].map(OPENAI_API_KEY => ({ ...fixtureEnv, OPENAI_API_KEY })),
    ...['', ' ', 'bad\nmodel', sentinel].map(MODEL_ID => ({ ...fixtureEnv, MODEL_ID })),
    ...['', ' ', '999', '120001', '1.5', '1e3', '-1000', 'NaN'].map(MODEL_TIMEOUT_MS => ({ ...fixtureEnv, MODEL_TIMEOUT_MS })),
    ...['255', '8193', '', '1.5', 'Infinity'].map(MODEL_MAX_OUTPUT_TOKENS => ({ ...fixtureEnv, MODEL_MAX_OUTPUT_TOKENS })),
    ...['', 'http://ai.elegantyc.com/v1', 'https://unapproved.example/v1', 'https://user:secret@ai.elegantyc.com/v1',
      'https://ai.elegantyc.com/v1?key=secret', 'http://127.0.0.1/v1'].map(OPENAI_BASE_URL => ({ ...fixtureEnv, OPENAI_BASE_URL })),
  ];
  for (const env of invalid) {
    assert.throws(() => readModelConfig(env), error => {
      assert.ok(error instanceof ModelError);
      assert.equal(error.safe.code, 'configuration');
      assert.ok(!String(error).includes(sentinel));
      return true;
    });
  }
});
