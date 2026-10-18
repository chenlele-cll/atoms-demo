import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readConfig } from '../src/config.js';

test('configuration defaults bind to a local interface', () => {
  const config = readConfig({});

  assert.deepEqual(config, { host: '127.0.0.1', port: 3001 });
});

test('explicit server configuration overrides defaults', () => {
  const config = readConfig({ HOST: '0.0.0.0', PORT: '3101' });

  assert.deepEqual(config, { host: '0.0.0.0', port: 3101 });
});

test('invalid ports fail before the server starts', () => {
  for (const port of ['', '0', '65536', '3001abc', '3.5', '-1']) {
    assert.throws(() => readConfig({ PORT: port }), RangeError);
  }
});

test('blank bind address fails before the server starts', () => {
  assert.throws(() => readConfig({ HOST: ' ' }), TypeError);
});
