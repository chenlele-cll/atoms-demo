import type { TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { projectFixture } from './projects.js';
import { response } from './model-fixture.js';
import type { FixtureRequest } from './model-fixture.js';
import type { Snapshot } from '../../src/contracts/projects.js';

export async function generationFixture(t: TestContext, change?: (base: Snapshot) => Snapshot) {
  const f = await projectFixture(t);
  const session = f.store.createSession();
  const bundle = change ? change(f.bundle) : f.bundle;
  const detail = f.store.createProject(session.id, 'Generation fixture', bundle);
  const input = { sessionId: session.id, projectId: detail.project.id, baseVersionId: detail.currentVersion.id,
    requestId: randomUUID(), prompt: 'Add a small quote estimator; explicit fixture request.' };
  return { ...f, bundle, session, detail, input };
}
export function generationCall(name: string, input: unknown, index: number, extra: Record<string, unknown> = {}) {
  return response([{ type: 'function_call', id: `fc_generation_${index}`, call_id: `call_generation_${index}`, name,
    arguments: JSON.stringify(input), status: 'completed' }], extra);
}
export function submitCall(index: number) {
  return generationCall('submit_files', { files: [{ path: '/src/generated/FixtureQuote.tsx',
    content: 'export default function FixtureQuote() { return <div>Explicit test fixture, no real generation claim.</div>; }' }] }, index);
}
export function successfulGeneration(_body: FixtureRequest, index: number) {
  if (index === 1) return generationCall('list_files', {}, index);
  if (index === 2) return generationCall('read_files', { paths: ['/src/App.tsx'] }, index);
  return submitCall(index);
}
