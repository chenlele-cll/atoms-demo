import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { createHash } from 'node:crypto';
import { canonicalJSON } from '../../src/template-assets/bundle.mjs';
import { snapshotSchema } from '../../src/contracts/projects.js';
import type { Snapshot } from '../../src/contracts/projects.js';
import { createCatalog } from '../../src/templates/catalog.js';
import { openStore } from '../../src/storage/store.js';

export async function projectFixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'atoms project persistence '));
  const filename = join(directory, 'data', 'test.sqlite');
  const store = openStore(filename);
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  const bundle = snapshotSchema.parse(JSON.parse(await readFile(new URL('../../src/template-assets/company-landing.bundle.json', import.meta.url), 'utf8')) as unknown);
  return { directory, filename, store, bundle, catalog: createCatalog([bundle]) };
}
export function changedSnapshot(original: Snapshot): Snapshot {
  const { digest: previous, ...body } = structuredClone(original);
  void previous;
  body.files[body.entry] += '\n// explicit persistence test fixture; no model call\n';
  return snapshotSchema.parse({ ...body, digest: createHash('sha256').update(canonicalJSON(body)).digest('hex') });
}
