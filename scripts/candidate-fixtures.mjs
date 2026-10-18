import { quoteCode } from './verification/quote-fixture.mjs';
export { quoteCode } from './verification/quote-fixture.mjs';
import { randomUUID } from 'node:crypto';
import { snapshotDigest, snapshotSchema } from '../packages/contracts/dist/index.js';

export const quotePath = `/src/generated/${'LongPath'.repeat(16)}QuoteFixture.tsx`;
export function candidateSnapshot(original, kind = 'normal', base = 5000) {
  const content = structuredClone(original); delete content.digest;
  if (!content.files['/src/App.tsx'].includes('import FixtureQuote ')) {
    content.files['/src/App.tsx'] = `import FixtureQuote from '.${quotePath.replace(/^\/src/, '').replace(/\.tsx$/, '')}';\n` +
      content.files['/src/App.tsx'].replace('<Navbar />', '<Navbar /><FixtureQuote />');
  }
  content.files[quotePath] = kind === 'syntax' ? 'export default function FixtureQuote(){ return <div>UNFINISHED_EXPLICIT_FIXTURE' :
    kind === 'runtime' ? 'export default function FixtureQuote(){throw new Error("EXPLICIT_RUNTIME_FIXTURE");return <div/>;}' : quoteCode(base);
  return snapshotSchema.parse({ ...content, digest: snapshotDigest(content) });
}
export function seedCandidate(store, ownerId, bundle, name, kind = 'normal') {
  const detail = store.createProject(ownerId, `Explicit fixture: ${name}`, bundle, 100);
  const candidates = [5000, 6000].map(base => {
    const run = store.createRun({ projectId: detail.project.id, requestId: randomUUID(), baseVersionId: detail.currentVersion.id });
    const result = store.saveCandidate({ projectId: detail.project.id, runId: run.id, snapshot: candidateSnapshot(bundle, kind, base) });
    return result.version;
  });
  return { detail, first: candidates[0], second: candidates[1] };
}
