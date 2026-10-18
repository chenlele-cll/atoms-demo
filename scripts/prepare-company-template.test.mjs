import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { prepareBackendTemplate, prepareCompanyTemplate, prepareTemplates, templateSource, templateSources } from './prepare-company-template.mjs';
import { contentDigest, verifyTemplateBundle } from '../templates/bundle.mjs';

const root = fileURLToPath(new URL('../test-results/template-preparation/', import.meta.url));
await mkdir(root, { recursive: true });

async function fixture(t) {
  const directory = await mkdtemp(path.join(root, 'case-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourceDirectory = path.join(directory, 'source');
  const outputFile = path.join(directory, 'out/bundle.json');
  await cp(templateSource, sourceDirectory, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(sourceDirectory, 'manifest.json'), 'utf8'));
  return { directory, sourceDirectory, outputFile, manifest };
}

test('backend source/build targets carry an independent identical bundle and neutral runtime contract', async t => {
  const f = await fixture(t);
  const frontend = await prepareCompanyTemplate(f);
  const source = path.join(f.directory, 'backend-src');
  const built = path.join(f.directory, 'backend-dist');
  for (const outputDirectory of [source, built]) {
    const bundle = await prepareBackendTemplate({ sourceDirectory: f.sourceDirectory, outputDirectory });
    assert.equal(bundle.digest, frontend.digest);
    assert.deepEqual(await readFile(path.join(outputDirectory, 'company-landing.bundle.json')), await readFile(f.outputFile));
    assert.deepEqual((await readdir(outputDirectory)).sort(), ['bundle.d.mts', 'bundle.mjs', 'company-landing.bundle.json']);
  }
  const previous = await readFile(path.join(built, 'company-landing.bundle.json'));
  await rm(path.join(f.sourceDirectory, 'LICENSE'));
  await assert.rejects(prepareBackendTemplate({ sourceDirectory: f.sourceDirectory, outputDirectory: built }));
  assert.deepEqual(await readFile(path.join(built, 'company-landing.bundle.json')), previous);
  assert.ok(!(await readdir(f.directory)).some(name => name.endsWith('.tmp') || name.endsWith('.previous')));
  const absent = path.join(f.directory, 'absent-target');
  await assert.rejects(prepareBackendTemplate({ sourceDirectory: f.sourceDirectory, outputDirectory: absent }));
  await assert.rejects(readdir(absent));
});

test('fixed source prepares deterministic, self-contained files and compiled CSS', async (t) => {
  const f = await fixture(t);
  const first = await prepareCompanyTemplate(f);
  const bytes = await readFile(f.outputFile);
  const second = await prepareCompanyTemplate(f);
  assert.deepEqual(await readFile(f.outputFile), bytes);
  assert.equal(first.digest, second.digest);
  await verifyTemplateBundle(JSON.parse(bytes.toString()), f.manifest);
  assert.equal(first.dependencies.react, '18.3.1');
  assert.equal(first.dependencies['react-dom'], '18.3.1');
  assert.match(first.files['/src/styles.css'], /--primary/);
  assert.match(first.files['/src/styles.css'], /\.text-3xl/);
  assert.doesNotMatch(first.files['/src/styles.css'], /@tailwind|@apply/);
  assert.equal(Object.keys(first.files).filter((name) => name.endsWith('.asset.ts')).length, 6);
  for (const [name, code] of Object.entries(first.files)) {
    assert.doesNotMatch(name, /\.env|node_modules|\.runtime/);
    assert.doesNotMatch(code, /https:\/\/(?:i\.pravatar\.cc|github\.com\/shadcn\.png)|vite-ui-theme|Subscribed!/);
    if (name.endsWith('.asset.ts')) assert.match(code, /^export default "data:image\/(?:png|svg\+xml);base64,/);
  }
});

test('complete catalog prepares matching assets and rejects a partial backend update', async t => {
  const f = await fixture(t);
  const sources = [];
  for (const source of templateSources) {
    const target = path.join(f.directory, path.basename(source));
    await cp(source, target, { recursive: true });
    sources.push(target);
  }
  const frontend = await prepareTemplates({ sourceDirectories: sources, outputDirectory: path.join(f.directory, 'frontend') });
  assert.deepEqual(frontend.map(bundle => bundle.id), ['company-landing', 'brand-store', 'personal-portfolio']);
  const outputDirectory = path.join(f.directory, 'backend');
  await prepareBackendTemplate({ sourceDirectories: sources, outputDirectory });
  for (const bundle of frontend) {
    const backend = JSON.parse(await readFile(path.join(outputDirectory, `${bundle.id}.bundle.json`), 'utf8'));
    assert.deepEqual(backend, bundle);
    const again = await prepareCompanyTemplate({ sourceDirectory: sources.find(source => source.endsWith(bundle.id)), outputFile: path.join(f.directory, 'again.json') });
    assert.equal(again.digest, bundle.digest);
  }
  const previous = await Promise.all((await readdir(outputDirectory)).sort().map(async name => [name, await readFile(path.join(outputDirectory, name), 'utf8')]));
  await rm(path.join(sources[2], 'LICENSE'));
  await assert.rejects(prepareBackendTemplate({ sourceDirectories: sources, outputDirectory }));
  assert.deepEqual(await Promise.all((await readdir(outputDirectory)).sort().map(async name => [name, await readFile(path.join(outputDirectory, name), 'utf8')])), previous);
  assert.ok(!(await readdir(f.directory)).some(name => name.endsWith('.tmp') || name.endsWith('.previous')));
});

test('missing source, license or entry fails without replacing a previous complete output', async (t) => {
  for (const missing of ['commit', 'LICENSE', 'src/main.tsx']) {
    await t.test(missing, async (t) => {
      const f = await fixture(t);
      await prepareCompanyTemplate(f);
      const before = await readFile(f.outputFile);
      if (missing === 'commit') {
        delete f.manifest.source.commit;
        await writeFile(path.join(f.sourceDirectory, 'manifest.json'), JSON.stringify(f.manifest));
      } else await rm(path.join(f.sourceDirectory, missing));
      await assert.rejects(prepareCompanyTemplate(f));
      assert.deepEqual(await readFile(f.outputFile), before);
      assert.deepEqual(await readdir(path.dirname(f.outputFile)), ['bundle.json']);
    });
  }
});

test('paths, symlinks and unresolved or undeclared imports are rejected', async (t) => {
  const mutations = {
    'dot file': async (f) => writeFile(path.join(f.sourceDirectory, 'src/.env'), 'PRIVATE_SENTINEL'),
    'traversal in manifest': async (f) => {
      f.manifest.source.upstreamFiles[0].localPath = '../outside';
      await writeFile(path.join(f.sourceDirectory, 'manifest.json'), JSON.stringify(f.manifest));
    },
    'source symlink': async (f) => symlink(path.join(f.sourceDirectory, 'LICENSE'), path.join(f.sourceDirectory, 'src/secret.ts')),
    'license symlink': async (f) => {
      await rm(path.join(f.sourceDirectory, 'LICENSE'));
      await symlink(path.join(templateSource, 'LICENSE'), path.join(f.sourceDirectory, 'LICENSE'));
    },
    'unresolved relative import': async (f) => writeFile(path.join(f.sourceDirectory, 'src/broken.ts'), 'import "./missing";'),
    'undeclared package import': async (f) => writeFile(path.join(f.sourceDirectory, 'src/broken.ts'), 'import value from "unlisted-package"; export default value;'),
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    await t.test(name, async (t) => {
      const f = await fixture(t);
      await mutate(f);
      await assert.rejects(prepareCompanyTemplate(f));
      await assert.rejects(readFile(f.outputFile), { code: 'ENOENT' });
    });
  }
});

test('oversized content or file count fails before publishing', async (t) => {
  await t.test('content', async (t) => {
    const f = await fixture(t);
    await writeFile(path.join(f.sourceDirectory, 'src/huge.ts'), 'x'.repeat(2 * 1024 * 1024 + 1));
    await assert.rejects(prepareCompanyTemplate(f), /大小超限|2 MiB/);
    await assert.rejects(readFile(f.outputFile), { code: 'ENOENT' });
  });
  await t.test('file count', async (t) => {
    const f = await fixture(t);
    for (let i = 0; i < 65; i++) await writeFile(path.join(f.sourceDirectory, `src/extra-${i}.ts`), 'export {};');
    await assert.rejects(prepareCompanyTemplate(f), /数量超限/);
    await assert.rejects(readFile(f.outputFile), { code: 'ENOENT' });
  });
});

test('public boundary rejects tampering, invalid paths, missing files, drift and size limits', async (t) => {
  const f = await fixture(t);
  const valid = await prepareCompanyTemplate(f);
  const mutations = {
    'content digest': (bundle) => { bundle.files[bundle.entry] += '\n// changed'; },
    'path': (bundle) => { bundle.files['/src/../secret.ts'] = 'x'; },
    'host path': (bundle) => { bundle.files['/etc/passwd'] = 'not a virtual source file'; },
    'entry': (bundle) => { delete bundle.files[bundle.entry]; },
    'license': (bundle) => { delete bundle.files['/LICENSE']; },
    'version': (bundle) => { bundle.version = 2; },
    'dependency drift': (bundle) => { bundle.dependencies.react = '19.3.1'; },
    'dependency range': (bundle) => { bundle.dependencies.react = '^18.3.1'; },
    'source': (bundle) => { bundle.source.commit = 'a'.repeat(40); },
    'oversized aggregate': (bundle) => { bundle.files['/src/big.ts'] = '中'.repeat(1024 * 1024); },
    'file count': (bundle) => { for (let i = 0; i < 65; i++) bundle.files[`/file-${i}.ts`] = ''; },
    'package config': (bundle) => { bundle.files['/package.json'] = '{"scripts":{"start":"bad"}}'; },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    await t.test(name, async () => {
      const changed = structuredClone(valid);
      mutate(changed);
      await assert.rejects(verifyTemplateBundle(changed, f.manifest));
    });
  }
  // A legitimate content change with a new digest remains compilable input;
  // the browser, not the structural validator, must detect invalid syntax.
  const syntaxError = structuredClone(valid);
  syntaxError.files[syntaxError.entry] = 'export default ( ;';
  const content = { ...syntaxError };
  delete content.digest;
  syntaxError.digest = await contentDigest(content);
  await verifyTemplateBundle(syntaxError, f.manifest);
});
