import { readFile } from 'node:fs/promises';
import { snapshotSchema, templateSchema } from '../contracts/projects.js';
import type { Snapshot } from '../contracts/projects.js';
import { ProjectError } from '../projects/errors.js';
import { companyTemplateIdentity, parseTemplateBundle } from '../template-assets/bundle.mjs';

export function createCatalog(input: unknown) {
  const bundle = snapshotSchema.parse(input);
  parseTemplateBundle(bundle, companyTemplateIdentity);
  return {
    list: () => ({ items: [templateSchema.parse(bundle)] }),
    resolve(id: string, version: number, digest: string): Snapshot {
      if (id !== bundle.id) throw new ProjectError('NOT_FOUND');
      if (version !== bundle.version || digest !== bundle.digest) throw new ProjectError('TEMPLATE_CONFLICT');
      return structuredClone(bundle);
    },
  };
}
export type TemplateCatalog = ReturnType<typeof createCatalog>;
export async function loadCatalog(asset = new URL('../template-assets/company-landing.bundle.json', import.meta.url)): Promise<TemplateCatalog> {
  try {
    const text = await readFile(asset, 'utf8');
    if (Buffer.byteLength(text) > 8 * 1024 * 1024) throw new Error();
    return createCatalog(JSON.parse(text) as unknown);
  } catch { throw new ProjectError('INVALID_CONFIGURATION'); }
}
