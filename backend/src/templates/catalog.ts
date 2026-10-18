import { readFile } from 'node:fs/promises';
import { snapshotSchema, templateSchema } from '../contracts/projects.js';
import type { Snapshot } from '../contracts/projects.js';
import { ProjectError } from '../projects/errors.js';
import { templateIdentities, parseTemplateBundle } from '../template-assets/bundle.mjs';

export function createCatalog(input: unknown[]) {
  const bundles = input.map(value => {
    const bundle = snapshotSchema.parse(value);
    const identity = templateIdentities.find(template => template.id === bundle.id);
    if (!identity) throw new ProjectError('INVALID_CONFIGURATION');
    parseTemplateBundle(bundle, identity);
    return bundle;
  });
  if (!bundles.length || new Set(bundles.map(bundle => bundle.id)).size !== bundles.length) throw new ProjectError('INVALID_CONFIGURATION');
  return {
    list: () => ({ items: bundles.map(bundle => templateSchema.parse(bundle)) }),
    resolve(id: string, version: number, digest: string): Snapshot {
      const bundle = bundles.find(template => template.id === id);
      if (!bundle) throw new ProjectError('NOT_FOUND');
      if (version !== bundle.version || digest !== bundle.digest) throw new ProjectError('TEMPLATE_CONFLICT');
      return structuredClone(bundle);
    },
  };
}
export type TemplateCatalog = ReturnType<typeof createCatalog>;
export async function loadCatalog(): Promise<TemplateCatalog> {
  try {
    const bundles = await Promise.all(templateIdentities.map(async identity => {
      const text = await readFile(new URL(`../template-assets/${identity.id}.bundle.json`, import.meta.url), 'utf8');
      if (Buffer.byteLength(text) > 8 * 1024 * 1024) throw new Error();
      return JSON.parse(text) as unknown;
    }));
    return createCatalog(bundles);
  } catch { throw new ProjectError('INVALID_CONFIGURATION'); }
}
