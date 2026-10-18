export interface TemplateIdentity {
  id: string;
  version: number;
  name: string;
  category: string;
  entry: string;
  source: { repository: string; commit: string; license: string };
  dependencies: Record<string, string>;
}
export interface TemplateBundle extends TemplateIdentity {
  files: Record<string, string>;
  digest: string;
}
export const MAX_TEMPLATE_FILES: number;
export const MAX_TEMPLATE_BYTES: number;
export function canonicalJSON(value: unknown): string;
export function contentDigest(value: unknown): Promise<string>;
export function validateVirtualPath(path: string): void;
export function parseTemplateBundle(input: unknown, expected: TemplateIdentity): TemplateBundle;
export function verifyTemplateBundle(input: unknown, expected: TemplateIdentity): Promise<TemplateBundle>;
