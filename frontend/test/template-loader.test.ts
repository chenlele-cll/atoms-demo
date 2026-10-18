import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contentDigest } from '../../templates/bundle.mjs';
import type { TemplateIdentity } from '../../templates/bundle.mjs';
import { companyTemplate, companyTemplateURL, loadCompanyTemplate, loadTemplate, templateManifests } from '../src/templates/companyLanding';

async function fixture(manifest: TemplateIdentity) {
  const { repository, commit, license } = manifest.source;
  const source = { repository, commit, license };
  const content = { ...manifest, source, files: {
    [manifest.entry]: 'export const fixture = true;',
    '/src/styles.css': 'body {}',
    '/public/index.html': '<div id="root"></div>',
    '/LICENSE': 'MIT License\nCopyright fixture',
    '/package.json': JSON.stringify({ main: manifest.entry, dependencies: manifest.dependencies }),
  } };
  return { ...content, digest: await contentDigest(content) };
}

test('each trusted manifest selects its own asset and verifies the selected identity', async t => {
  for (const manifest of templateManifests) {
    const bundle = await fixture(manifest);
    const controller = new AbortController();
    const transport = t.mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
      assert.equal(url, `/template-assets/${manifest.id}.bundle.json`);
      assert.equal(init?.cache, 'no-store');
      assert.ok(init?.signal instanceof AbortSignal);
      return Response.json(bundle);
    });
    assert.deepEqual(await loadTemplate(manifest.id, controller.signal, bundle), bundle);
    transport.mock.restore();
  }
});

test('company exports preserve the existing loader entry and asset URL', async t => {
  const bundle = await fixture(companyTemplate);
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    assert.equal(url, companyTemplateURL);
    return Response.json(bundle);
  });
  assert.deepEqual(await loadCompanyTemplate(new AbortController().signal), bundle);
});

test('unknown IDs and mismatched catalog IDs, versions or invalid digests never fetch an asset', async t => {
  const transport = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected fetch'); });
  const signal = new AbortController().signal;
  await assert.rejects(loadTemplate('../company-landing', signal), /交互预览/);
  const identity = { id: companyTemplate.id, version: companyTemplate.version, digest: 'a'.repeat(64) };
  for (const expected of [{ ...identity, id: 'brand-store' }, { ...identity, version: 2 }, { ...identity, digest: 'invalid' }]) {
    await assert.rejects(loadTemplate(companyTemplate.id, signal, expected), /模板版本已变化/);
  }
  assert.equal(transport.mock.callCount(), 0);
});

test('valid bundles still reject stale catalog digests, substituted templates and tampered content', async t => {
  const bundle = await fixture(companyTemplate);
  let response: unknown = bundle;
  t.mock.method(globalThis, 'fetch', async () => Response.json(response));
  const signal = new AbortController().signal;
  await assert.rejects(loadTemplate(bundle.id, signal, { ...bundle, digest: 'a'.repeat(64) }), /模板版本已变化/);
  await assert.rejects(loadTemplate('brand-store', signal), /模板标识/);
  response = { ...bundle, files: { ...bundle.files, [bundle.entry]: 'changed' } };
  await assert.rejects(loadTemplate(bundle.id, signal), /内容标识校验失败/);
});

test('asset HTTP, malformed JSON, oversized responses and cancellation remain explicit failures', async t => {
  let response = new Response(null, { status: 404 });
  t.mock.method(globalThis, 'fetch', async (_url: string | URL | Request, init?: RequestInit) => {
    init?.signal?.throwIfAborted();
    return response;
  });
  const signal = new AbortController().signal;
  await assert.rejects(loadTemplate(companyTemplate.id, signal), /HTTP 404/);
  response = new Response('invalid JSON');
  await assert.rejects(loadTemplate(companyTemplate.id, signal), /有效的 JSON/);
  response = new Response('{}', { headers: { 'content-length': String(8 * 1024 * 1024 + 1) } });
  await assert.rejects(loadTemplate(companyTemplate.id, signal), /大小/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(loadTemplate(companyTemplate.id, controller.signal), { name: 'AbortError' });
});
