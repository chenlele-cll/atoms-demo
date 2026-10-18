import { createHash } from 'node:crypto';
import type { Snapshot } from '../contracts/projects.js';
import { snapshotSchema } from '../contracts/projects.js';
import { canonicalJSON, templateIdentities } from '../template-assets/bundle.mjs';
import { listFilesSchema, readFilesSchema, submitFilesSchema } from './contracts.js';
import { GenerationError } from './errors.js';

export function writable(path: string, existing: boolean): boolean {
  if (!existing) return /^\/src\/generated\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:ts|tsx|css)$/.test(path);
  return ['/App.tsx', '/src/App.tsx'].includes(path) ||
    /^\/(?:src\/)?(?:components|data|lib|generated)\/.+\.tsx?$/.test(path) ||
    /^\/src\/generated\/.+\.css$/.test(path);
}
export function changedPaths(base: Snapshot, candidate: Snapshot) {
  return Object.keys(candidate.files).filter(path => candidate.files[path] !== base.files[path]).sort();
}
export function candidateSummary(paths: string[]) { return `候选已保存，修改 ${paths.length} 个文件；预览未验证：${paths.join('、')}`; }

export function validateCandidate(base: Snapshot, input: unknown) {
  const parsed = submitFilesSchema.safeParse(input);
  if (!parsed.success) throw new GenerationError('FILE_POLICY');
  let bytes = 0;
  for (const file of parsed.data.files) {
    if (!writable(file.path, Object.hasOwn(base.files, file.path)) || !file.content.trim()) throw new GenerationError('FILE_POLICY');
    bytes += Buffer.byteLength(file.content, 'utf8');
  }
  if (bytes > 256 * 1024) throw new GenerationError('FILE_POLICY');
  const files = { ...base.files };
  for (const file of parsed.data.files) files[file.path] = file.content;
  const { digest: previous, ...content } = { ...base, files }; void previous;
  const candidate = { ...content, digest: createHash('sha256').update(canonicalJSON(content)).digest('hex') };
  const valid = snapshotSchema.safeParse(candidate);
  if (!valid.success) throw new GenerationError('FILE_POLICY');
  const changedFiles = changedPaths(base, valid.data);
  if (!changedFiles.length) throw new GenerationError('FILE_POLICY');
  return { snapshot: valid.data, changedFiles, bytes };
}

export function createFileTools(input: Snapshot) {
  const base = snapshotSchema.parse(input);
  if (!templateIdentities.some(template => template.id === base.id) || !Object.keys(base.files).some(path => writable(path, true))) throw new GenerationError('UNSUPPORTED_TEMPLATE');
  const read = new Set<string>(); let submitted = false;
  return {
    list(input: unknown) {
      if (!listFilesSchema.safeParse(input).success || submitted) throw new GenerationError('TOOL_ERROR');
      return { files: Object.entries(base.files).sort(([a], [b]) => a.localeCompare(b)).map(([path, content]) =>
        ({ path, bytes: Buffer.byteLength(content, 'utf8'), writable: writable(path, true) })) };
    },
    read(input: unknown) {
      const parsed = readFilesSchema.safeParse(input);
      if (!parsed.success || submitted) throw new GenerationError('TOOL_ERROR');
      let bytes = 0;
      const files = parsed.data.paths.map(path => {
        if (!Object.hasOwn(base.files, path)) throw new GenerationError('FILE_POLICY');
        const content = base.files[path];
        if (content === undefined) throw new GenerationError('FILE_POLICY');
        bytes += Buffer.byteLength(content, 'utf8'); return { path, content };
      });
      if (bytes > 96 * 1024) throw new GenerationError('FILE_POLICY');
      files.forEach(file => read.add(file.path));
      return { files, bytes };
    },
    submit(input: unknown) {
      const parsed = submitFilesSchema.safeParse(input);
      if (!parsed.success || submitted || read.size === 0) throw new GenerationError('FILE_POLICY');
      for (const file of parsed.data.files) {
        const existing = Object.hasOwn(base.files, file.path);
        if (existing && !read.has(file.path)) throw new GenerationError('FILE_POLICY');
      }
      const candidate = validateCandidate(base, parsed.data);
      submitted = true;
      return candidate;
    },
  };
}
