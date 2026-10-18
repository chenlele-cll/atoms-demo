import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialPreview, previewKey, previewTransition } from '../src/preview/state';
import { confirmation } from '../src/candidate-review/adoption';

test('preview key includes every identity and connected/initial load never claim compiled', () => {
  const key = previewKey('project', 'version', 'digest', 0); const initial = initialPreview(key);
  for (const event of [{ key, type: 'connected' }, { key, type: 'load' }] as const) assert.equal(previewTransition(initial, event), initial);
  assert.notEqual(previewKey('other', 'version', 'digest', 0), key); assert.notEqual(previewKey('project', 'other', 'digest', 0), key);
  assert.notEqual(previewKey('project', 'version', 'other', 0), key); assert.notEqual(previewKey('project', 'version', 'digest', 1), key);
  assert.equal(previewTransition(initial, { key, type: 'done', compilationError: false }).status, 'compiled');
});
test('errors and timeout lock their attempt, old events never enable new instance', () => {
  for (const type of ['compileError', 'runtimeError', 'timeout'] as const) {
    const initial = initialPreview('new'); const failed = previewTransition(initial, { key: 'new', type });
    assert.equal(failed.status, type);
    for (const event of [{ key: 'new', type: 'done', compilationError: false }, { key: 'new', type: 'connected' }, { key: 'old', type: 'done', compilationError: false }] as const) assert.equal(previewTransition(failed, event), failed);
  }
  const compiling = initialPreview('new'); assert.equal(previewTransition(compiling, { key: 'old', type: 'done', compilationError: false }), compiling);
  assert.equal(previewTransition(compiling, { key: 'old', type: 'runtimeError' }), compiling);
  assert.equal(initialPreview('retry').status, 'compiling');
});
test('runtime failure and document reload invalidate prior success without reverting adoption', () => {
  const compiled = previewTransition(initialPreview('key'), { key: 'key', type: 'done', compilationError: false });
  assert.equal(previewTransition(compiled, { key: 'key', type: 'runtimeError' }).status, 'runtimeError');
  assert.equal(previewTransition(compiled, { key: 'key', type: 'load' }).status, 'runtimeError');
  assert.equal(previewTransition(compiled, { key: 'key', type: 'timeout' }), compiled);
  assert.equal(confirmation('target', 'target', 'base').status, 'confirmed');
});
test('adoption query confirms only current facts, original base stays unknown and another target conflicts', () => {
  assert.equal(confirmation('target', 'target', 'base').status, 'confirmed');
  assert.equal(confirmation('base', 'target', 'base').status, 'unknown');
  assert.equal(confirmation('other', 'target', 'base').status, 'conflict');
});
