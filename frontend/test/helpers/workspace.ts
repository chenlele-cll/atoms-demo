import { snapshotSchema, snapshotDigest, versionReviewSchema, projectDetailSchema, generationEventSchema, generationStatusSchema } from '@atoms/contracts';
export function workspaceFixture() {
  const projectId = crypto.randomUUID(); const baseId = crypto.randomUUID(); const versionId = crypto.randomUUID(); const runId = crypto.randomUUID(); const requestId = crypto.randomUUID(); const at = new Date().toISOString();
  const dependencies = { react: '18.3.1' };
  const content = { id: 'company-landing', version: 1, name: 'Fixture', category: 'company', entry: '/src/index.tsx',
    source: { repository: 'https://github.com/example/fixture', commit: 'a'.repeat(40), license: 'MIT' }, dependencies,
    files: { '/src/index.tsx': 'export const fixture = "UTF-8 中文🙂";', '/src/styles.css': 'body{}', '/public/index.html': '<div id="root"></div>', '/LICENSE': 'MIT License\nCopyright fixture', '/package.json': JSON.stringify({ main: '/src/index.tsx', dependencies }) } };
  const snapshot = snapshotSchema.parse({ ...content, digest: snapshotDigest(content) });
  const base = { id: baseId, projectId, sequence: 0, parentVersionId: null, kind: 'template', snapshot, createdAt: at };
  const project = projectDetailSchema.parse({ project: { id: projectId, title: 'Fixture project', templateId: snapshot.id, templateVersion: 1, templateDigest: snapshot.digest, currentVersionId: baseId, createdAt: at, updatedAt: at }, currentVersion: base, latestRun: null });
  const run = { id: runId, projectId, requestId, baseVersionId: baseId, resultVersionId: versionId, status: 'succeeded', errorCode: null, startedAt: at, finishedAt: at };
  const review = versionReviewSchema.parse({ version: { ...base, id: versionId, sequence: 1, parentVersionId: baseId, kind: 'generated' }, successfulRun: run, changedFiles: ['/src/index.tsx'], currentVersionId: baseId, adoptionAvailability: 'eligible' });
  const currentReview = versionReviewSchema.parse({ version: base, successfulRun: null, changedFiles: [], currentVersionId: baseId, adoptionAvailability: 'not-candidate' });
  const body = { requestId, baseVersionId: baseId, prompt: 'Add a quote tool 中文🙂' };
  const running = generationStatusSchema.parse({ projectId, requestId, runId, baseVersionId: baseId, status: 'running', startedAt: at, finishedAt: null, errorCode: null, cancellationRequested: false, terminalStatePersisted: false, candidateVersionId: null, changedFiles: [], previewStatus: 'unverified', usage: null });
  const succeeded = generationStatusSchema.parse({ ...running, status: 'succeeded', finishedAt: at, terminalStatePersisted: true, candidateVersionId: versionId, changedFiles: ['/src/index.tsx'] });
  const cancelled = generationStatusSchema.parse({ ...running, status: 'cancelled', finishedAt: at, terminalStatePersisted: true, errorCode: 'USER_CANCELLED' });
  const association = { projectId, requestId, runId, baseVersionId: baseId, at };
  const accepted = generationEventSchema.parse({ ...association, event: 'accepted', seq: 1 });
  const activity = generationEventSchema.parse({ ...association, event: 'activity', seq: 2, activity: { type: 'request-started', step: 1 } });
  const terminal = generationEventSchema.parse({ ...association, event: 'terminal', seq: 3, state: succeeded });
  return { projectId, baseId, versionId, runId, requestId, at, snapshot, project, review, currentReview, body, running, succeeded, cancelled, accepted, activity, terminal };
}
export const jsonResponse = (data: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
export const safeErrorResponse = (status: number, code = 'NOT_FOUND') => jsonResponse({ error: { code, message: 'Safe fixture error' }, requestId: 'fixture' }, status);
