import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { generateProject } from '../src/generation/service.js';
import { openStore } from '../src/storage/store.js';
import { snapshotSchema } from '../src/contracts/projects.js';
import type { Snapshot } from '../src/contracts/projects.js';
import { canonicalJSON } from '../src/template-assets/bundle.mjs';
import { generationCall, generationFixture, submitCall, successfulGeneration } from './helpers/generation.js';
import { fixtureEnv, response, startFixture } from './helpers/model-fixture.js';
import type { FixtureRequest } from './helpers/model-fixture.js';

function marked(base: Snapshot, marker: string) {
  const { digest, ...body } = base; void digest;
  const content = { ...body, files: { ...base.files, '/src/App.tsx': `${base.files['/src/App.tsx']}\n// ${marker}` } };
  return snapshotSchema.parse({ ...content, digest: createHash('sha256').update(canonicalJSON(content)).digest('hex') });
}

async function restoredFixture(t: TestContext) {
  const f = await generationFixture(t);
  const sql = new Database(f.filename); t.after(() => sql.close());
  const save = (baseVersionId: string, name: string) => {
    const input = { ...f.input, baseVersionId, requestId: randomUUID(), prompt: `HISTORY_${name}_USER` };
    const run = f.store.createRun({ ...input, messages: [{ role: 'user', content: input.prompt }] });
    const saved = f.store.saveCandidate({ projectId: input.projectId, runId: run.id, snapshot: marked(f.bundle, `SOURCE_${name}`),
      messages: [{ role: 'assistant', content: `HISTORY_${name}_ASSISTANT` }] });
    return { ...saved, input };
  };
  const a = save(f.input.baseVersionId, 'A');
  const b = save(a.version.id, 'B');
  const c = save(a.version.id, 'C');
  // Simulate the confirmed restored pointer in this private DB; this is not restore API evidence.
  sql.prepare('UPDATE projects SET current_version_id=? WHERE id=?').run(a.version.id, f.input.projectId);
  const input = { ...f.input, baseVersionId: a.version.id, prompt: 'UNIQUE_RESTORED_CONTINUATION_REQUEST' };
  return { ...f, sql, save, a, b, c, input };
}

function records(sql: Database.Database) {
  return {
    versions: sql.prepare('SELECT * FROM versions ORDER BY project_id,sequence').all(),
    runs: sql.prepare('SELECT * FROM generation_runs ORDER BY rowid').all(),
    messages: sql.prepare('SELECT * FROM messages ORDER BY project_id,sequence').all(),
  };
}

function text(item: FixtureRequest['input'][number]) {
  const content: unknown = item['content'];
  if (typeof content === 'string') return content;
  assert.ok(Array.isArray(content));
  return content.map((part: unknown) => {
    assert.ok(part && typeof part === 'object' && 'text' in part && typeof part.text === 'string');
    return part.text;
  }).join('');
}

test('restored lineage filters before LIMIT, preserves all history and includes a never-adopted current candidate', async t => {
  const f = await restoredFixture(t);
  const ancestor = f.save(f.a.version.id, 'ANCESTOR');
  const tip = f.save(ancestor.version.id, 'TIP');
  f.sql.prepare('UPDATE projects SET current_version_id=? WHERE id=?').run(tip.version.id, f.input.projectId);
  const input = { ...f.input, baseVersionId: tip.version.id };
  for (const status of ['failed', 'cancelled', 'interrupted', 'running'] as const) {
    const run = f.store.createRun({ ...input, requestId: randomUUID(), messages: [{ role: 'user', content: `EXCLUDED_${status}` }] });
    if (status !== 'running') f.store.finishRun({ projectId: input.projectId, runId: run.id, status, errorCode: 'CANCELLED' });
  }
  f.store.appendMessages(input.projectId, Array.from({ length: 12 }, (_, i) => ({ role: 'user' as const, content: `EXCLUDED_UNLINKED_${i}` })));
  const foreign = f.store.createProject(f.session.id, 'foreign', f.bundle);
  const foreignRun = f.store.createRun({ projectId: foreign.project.id, baseVersionId: foreign.currentVersion.id,
    requestId: randomUUID(), messages: [{ role: 'user', content: 'EXCLUDED_FOREIGN' }] });
  f.store.saveCandidate({ projectId: foreign.project.id, runId: foreignRun.id, snapshot: f.bundle });
  // Deliberately inconsistent result/base associations must never qualify as lineage history.
  f.sql.pragma('foreign_keys = OFF');
  f.sql.pragma('ignore_check_constraints = ON');
  f.sql.prepare('UPDATE generation_runs SET result_version_id=? WHERE id=?').run(tip.version.id, foreignRun.id);
  f.sql.prepare("UPDATE generation_runs SET result_version_id=?,base_version_id=? WHERE project_id=? AND status<>'succeeded'")
    .run(tip.version.id, ancestor.version.id, input.projectId);
  for (const mismatch of ['base', 'result']) {
    const run = f.store.createRun({ ...input, requestId: randomUUID(), messages: [{ role: 'user', content: `EXCLUDED_WRONG_${mismatch}` }] });
    f.sql.prepare("UPDATE generation_runs SET status='succeeded',finished_at=started_at,result_version_id=?,base_version_id=? WHERE id=?")
      .run(mismatch === 'result' ? f.b.version.id : tip.version.id, mismatch === 'base' ? f.detail.currentVersion.id : ancestor.version.id, run.id);
  }
  const before = records(f.sql);
  const fixture = await startFixture((_, res) => res.end(JSON.stringify(generationCall('list_files', {}, 1, { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }))));
  try {
    const result = await generateProject(input, { store: f.store, env: fixtureEnv, transport: fixture.transport });
    assert.equal(result.errorCode, 'MODEL_TRUNCATED');
    const first = fixture.requests[0]; assert.ok(first);
    assert.deepEqual(first.input.slice(2, -1).map(text), [
      'HISTORY_A_USER', 'HISTORY_A_ASSISTANT', 'HISTORY_ANCESTOR_USER', 'HISTORY_ANCESTOR_ASSISTANT', 'HISTORY_TIP_USER', 'HISTORY_TIP_ASSISTANT',
    ]);
    const sent = JSON.stringify(first);
    for (const marker of ['HISTORY_B_', 'HISTORY_C_', 'EXCLUDED_']) assert.ok(!sent.includes(marker), marker);
    assert.equal(sent.split(input.prompt).length - 1, 1);
    assert.match(text(first.input[1] ?? {}), /"historyOmitted":22/);
    const after = records(f.sql);
    assert.deepEqual(after.versions, before.versions);
    assert.deepEqual(after.messages.filter(row => (row as { run_id: string }).run_id !== result.runId), before.messages);
  } finally { await fixture.close(); }
});

test('template baseline has no generated history and reports the pre-acceptance total', async t => {
  const f = await restoredFixture(t);
  f.sql.prepare('UPDATE projects SET current_version_id=? WHERE id=?').run(f.detail.currentVersion.id, f.input.projectId);
  const fixture = await startFixture((_, res) => res.end(JSON.stringify(submitCall(1))));
  try {
    await generateProject({ ...f.input, baseVersionId: f.detail.currentVersion.id }, { store: f.store, env: fixtureEnv, transport: fixture.transport });
    const first = fixture.requests[0]; assert.ok(first);
    assert.deepEqual(first.input.slice(2).map(text), [f.input.prompt]);
    assert.match(text(first.input[1] ?? {}), /"historyOmitted":6/);
  } finally { await fixture.close(); }
});

test('SDK history uses the latest ten eligible messages, exact UTF-8 budget, ascending order and no eleventh backfill', async t => {
  const f = await restoredFixture(t);
  const older = `${'界'.repeat(2794)}ab`; // 8384 bytes
  const newer = `${'界'.repeat(2666)}ab`; // 8000 bytes; combined exactly 16 KiB
  const contents = ['ELEVENTH_MUST_NOT_BACKFILL', ...Array.from({ length: 8 }, (_, i) => `SKIP_BUDGET_${i}`), older, newer];
  f.store.appendMessages(f.input.projectId, contents.map(content => ({ role: 'user', content, runId: f.a.run.id })));
  f.store.appendMessages(f.input.projectId, Array.from({ length: 12 }, (_, i) => ({ role: 'user' as const, content: `UNRELATED_RECENT_${i}` })));
  const fixture = await startFixture((_, res) => res.end(JSON.stringify(submitCall(1))));
  try {
    await generateProject(f.input, { store: f.store, env: fixtureEnv, transport: fixture.transport });
    const first = fixture.requests[0]; assert.ok(first);
    assert.deepEqual(first.input.slice(2).map(text), [older, newer, f.input.prompt]);
    assert.match(text(first.input[1] ?? {}), /"historyOmitted":27/);
    assert.equal(JSON.stringify(first).split(f.input.prompt).length - 1, 1);
  } finally { await fixture.close(); }
});

test('SDK skips oversized remaining history without backfilling the eleventh eligible message', async t => {
  const f = await restoredFixture(t);
  const contents = ['SMALL_ELEVENTH_EXCLUDED', ...Array.from({ length: 10 }, (_, i) => `${i}${'界'.repeat(3000)}`)];
  f.store.appendMessages(f.input.projectId, contents.map(content => ({ role: 'user', content, runId: f.a.run.id })));
  const fixture = await startFixture((_, res) => res.end(JSON.stringify(submitCall(1))));
  try {
    await generateProject(f.input, { store: f.store, env: fixtureEnv, transport: fixture.transport });
    const first = fixture.requests[0]; assert.ok(first);
    assert.deepEqual(first.input.slice(2).map(text), [contents[10], f.input.prompt]);
    assert.match(text(first.input[1] ?? {}), /"historyOmitted":16/);
  } finally { await fixture.close(); }
});

test('SDK takes exactly ten eligible messages in persisted order even when more fit the byte budget', async t => {
  const f = await restoredFixture(t);
  const contents = Array.from({ length: 12 }, (_, i) => `ELIGIBLE_ORDER_${i}`);
  f.store.appendMessages(f.input.projectId, contents.map(content => ({ role: 'user', content, runId: f.a.run.id })));
  const fixture = await startFixture((_, res) => res.end(JSON.stringify(submitCall(1))));
  try {
    await generateProject(f.input, { store: f.store, env: fixtureEnv, transport: fixture.transport });
    const first = fixture.requests[0]; assert.ok(first);
    assert.deepEqual(first.input.slice(2).map(text), [...contents.slice(2), f.input.prompt]);
    assert.match(text(first.input[1] ?? {}), /"historyOmitted":8/);
  } finally { await fixture.close(); }
});

test('one UTF-8 byte over the remaining budget skips the entire older message', async t => {
  const f = await restoredFixture(t);
  const older = `${'界'.repeat(2794)}abc`; // 8385 bytes
  const newer = `${'界'.repeat(2666)}ab`; // 8000 bytes
  const contents = ['ELEVENTH_EXCLUDED', ...Array.from({ length: 8 }, (_, i) => `${i}${'界'.repeat(3000)}`), older, newer];
  f.store.appendMessages(f.input.projectId, contents.map(content => ({ role: 'user', content, runId: f.a.run.id })));
  const fixture = await startFixture((_, res) => res.end(JSON.stringify(submitCall(1))));
  try {
    await generateProject(f.input, { store: f.store, env: fixtureEnv, transport: fixture.transport });
    const first = fixture.requests[0]; assert.ok(first);
    assert.deepEqual(first.input.slice(2).map(text), [newer, f.input.prompt]);
    assert.match(text(first.input[1] ?? {}), /"historyOmitted":16/);
  } finally { await fixture.close(); }
});

for (const damage of ['missing', 'foreign-parent', 'cycle', 'generated-root', 'template-parent', 'template-sequence', 'nondecreasing', 'long-cycle'] as const) {
  test(`corrupt lineage ${damage} fails finitely before SDK or acceptance writes`, { timeout: 10000 }, async t => {
    const f = await restoredFixture(t);
    f.sql.pragma('foreign_keys = OFF');
    f.sql.exec('DROP TRIGGER versions_immutable');
    f.sql.pragma('ignore_check_constraints = ON');
    let base = f.a.version.id;
    if (damage === 'long-cycle') {
      const insert = f.sql.prepare("INSERT INTO versions(id,project_id,sequence,parent_version_id,kind,snapshot_json,created_at) VALUES(?,?,?,?,'generated',?,?)");
      f.sql.transaction(() => {
        for (let i = 4; i < 2004; i++) {
          const id = randomUUID(); insert.run(id, f.input.projectId, i, base, JSON.stringify(f.bundle), new Date().toISOString()); base = id;
        }
      })();
      f.sql.prepare('UPDATE versions SET parent_version_id=? WHERE id=?').run(base, f.a.version.id);
      f.sql.prepare('UPDATE projects SET current_version_id=? WHERE id=?').run(base, f.input.projectId);
    } else if (damage === 'foreign-parent') {
      const other = f.store.createProject(f.session.id, 'foreign parent', f.bundle);
      f.sql.prepare('UPDATE versions SET parent_version_id=? WHERE id=?').run(other.currentVersion.id, base);
    } else if (damage === 'missing' || damage === 'cycle') {
      f.sql.prepare('UPDATE versions SET parent_version_id=? WHERE id=?').run(damage === 'missing' ? randomUUID() : f.b.version.id, base);
    } else if (damage === 'generated-root') f.sql.prepare('UPDATE versions SET parent_version_id=NULL WHERE id=?').run(base);
    else if (damage === 'template-parent') f.sql.prepare('UPDATE versions SET parent_version_id=? WHERE id=?').run(base, f.detail.currentVersion.id);
    else if (damage === 'template-sequence') f.sql.prepare('UPDATE versions SET sequence=100 WHERE id=?').run(f.detail.currentVersion.id);
    else {
      f.sql.prepare('UPDATE versions SET parent_version_id=? WHERE id=?').run(f.detail.currentVersion.id, f.b.version.id);
      f.sql.prepare('UPDATE versions SET parent_version_id=? WHERE id=?').run(f.b.version.id, base);
    }
    const before = records(f.sql); let calls = 0;
    const input = { ...f.input, baseVersionId: base };
    assert.throws(() => f.store.acceptGeneration(input, () => {}), { code: 'DATA_CORRUPT' });
    const result = await generateProject(input, { store: f.store, env: fixtureEnv,
      transport: async () => { calls++; throw new Error('Unexpected model call'); } });
    assert.equal(result.errorCode, 'DATA_CORRUPT', JSON.stringify(result));
    assert.equal(result.runId, null); assert.equal(calls, 0); assert.equal(result.metrics.requestCount, 0);
    assert.deepEqual(records(f.sql), before);
  });
}

test('long valid lineage terminates, selects bounded history and accepts without loading ancestor snapshots', async t => {
  const f = await restoredFixture(t); let base = f.a.version.id;
  const insert = f.sql.prepare("INSERT INTO versions(id,project_id,sequence,parent_version_id,kind,snapshot_json,created_at) VALUES(?,?,?,?,'generated',?,?)");
  f.sql.transaction(() => {
    for (let i = 4; i < 2004; i++) {
      const id = randomUUID(); insert.run(id, f.input.projectId, i, base, JSON.stringify(f.bundle), new Date().toISOString()); base = id;
    }
  })();
  f.sql.prepare('UPDATE projects SET current_version_id=? WHERE id=?').run(base, f.input.projectId);
  const accepted = f.store.acceptGeneration({ ...f.input, baseVersionId: base }, () => {});
  assert.ok(accepted.accepted);
  assert.deepEqual(accepted.history.map(message => message.content), ['HISTORY_A_ASSISTANT', 'HISTORY_A_USER']);
  assert.equal(accepted.totalHistory, 6);
});

test('restored frozen list/read/submit branches at global max+1, retains immutable records across reopen and permits a second writer', async t => {
  const f = await restoredFixture(t); const before = records(f.sql);
  let received: () => void = () => {}; let release: () => void = () => {};
  const active = new Promise<void>(resolve => { received = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const fixture = await startFixture((body, res, index) => {
    if (index === 1) { received(); void gate.then(() => res.end(JSON.stringify(successfulGeneration(body, index)))); }
    else res.end(JSON.stringify(successfulGeneration(body, index)));
  });
  try {
    const pending = generateProject(f.input, { store: f.store, env: { ...fixtureEnv, MODEL_TIMEOUT_MS: '5000' }, transport: fixture.transport });
    await active;
    f.sql.prepare('UPDATE projects SET title=? WHERE id=?').run('Independent writer during model wait', f.input.projectId);
    release(); const result = await pending;
    assert.equal(result.status, 'succeeded', JSON.stringify(result)); assert.equal(result.previewStatus, 'unverified');
    assert.equal(fixture.requests.length, 3);
    const read = fixture.requests[2]?.input.filter(item => item['type'] === 'function_call_output').at(-1);
    assert.ok(read);
    const output = JSON.parse(String(read['output'])) as { files: { content: string }[] };
    assert.equal(output.files[0]?.content, f.a.version.snapshot.files['/src/App.tsx']);
    assert.ok(!JSON.stringify(fixture.requests).includes('SOURCE_B'));
    const saved = f.store.inspectGeneration(f.input); assert.ok(saved?.candidateVersion);
    assert.equal(saved.candidateVersion.parentVersionId, f.a.version.id); assert.equal(saved.candidateVersion.sequence, 4);
    assert.equal(f.store.getProject(f.session.id, f.input.projectId).project.currentVersionId, f.a.version.id);
    const after = records(f.sql);
    assert.deepEqual(after.versions.slice(0, before.versions.length), before.versions);
    assert.deepEqual(after.runs.slice(0, before.runs.length), before.runs);
    assert.deepEqual(after.messages.slice(0, before.messages.length), before.messages);
    assert.deepEqual(f.store.listMessages(f.session.id, f.input.projectId, 0, 50).items.map(message => message.sequence), [1, 2, 3, 4, 5, 6, 7, 8]);
    f.store.close(); f.sql.close();
    const reopened = openStore(f.filename); t.after(() => reopened.close());
    const reader = new Database(f.filename); t.after(() => reader.close());
    assert.deepEqual(records(reader), after); assert.deepEqual(reopened.inspectGeneration(f.input), saved);
    assert.equal(reopened.getProject(f.session.id, f.input.projectId).project.currentVersionId, f.a.version.id);
  } finally { release(); await fixture.close(); }
});

test('restored replay of B precedes baseline/config checks, returns unknown metrics and conflicts on changed payload without writes', async t => {
  const f = await restoredFixture(t); const before = records(f.sql); let calls = 0;
  const dependencies = { store: f.store, env: {}, transport: async () => { calls++; throw new Error('Unexpected call'); } };
  const replay = await generateProject(f.b.input, dependencies);
  assert.equal(replay.status, 'succeeded'); assert.equal(replay.replayed, true); assert.equal(replay.runId, f.b.run.id);
  assert.equal(replay.candidateVersionId, f.b.version.id); assert.equal(replay.candidateDigest, f.b.version.snapshot.digest);
  assert.deepEqual(replay.metrics, { requestCount: null, usage: null, requests: null });
  for (const input of [{ ...f.b.input, baseVersionId: f.detail.currentVersion.id }, { ...f.b.input, prompt: 'changed prompt' }]) {
    assert.equal((await generateProject(input, dependencies)).errorCode, 'REQUEST_CONFLICT');
  }
  assert.equal(calls, 0); assert.deepEqual(records(f.sql), before);
  assert.equal(f.store.getProject(f.session.id, f.input.projectId).project.currentVersionId, f.a.version.id);
});

test('known restored failure replays without automatic retry and an explicit new ID can succeed independently', async t => {
  const f = await restoredFixture(t);
  const fixture = await startFixture((_, res, index) => res.end(JSON.stringify(index === 1
    ? generationCall('list_files', {}, 1, { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } })
    : index === 2 ? generationCall('read_files', { paths: ['/src/App.tsx'] }, index) : submitCall(index))));
  try {
    const deps = { store: f.store, env: fixtureEnv, transport: fixture.transport };
    const failed = await generateProject(f.input, deps); assert.equal(failed.errorCode, 'MODEL_TRUNCATED');
    const before = records(f.sql);
    const replay = await generateProject(f.input, { ...deps, env: {} });
    assert.equal(replay.runId, failed.runId); assert.equal(replay.replayed, true); assert.equal(replay.status, 'failed');
    assert.deepEqual(records(f.sql), before); assert.equal(fixture.requests.length, 1);
    const retry = await generateProject({ ...f.input, requestId: randomUUID() }, deps);
    assert.equal(retry.status, 'succeeded'); assert.notEqual(retry.runId, failed.runId); assert.equal(fixture.requests.length, 3);
    assert.equal(f.store.getProject(f.session.id, f.input.projectId).project.currentVersionId, f.a.version.id);
  } finally { await fixture.close(); }
});

test('restored acceptance failure rolls back its running row and user message before model work', async t => {
  const f = await restoredFixture(t); const before = records(f.sql); let calls = 0;
  f.sql.exec("CREATE TRIGGER reject_input BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT,'PRIVATE_ACCEPT_FAILURE'); END;");
  const result = await generateProject(f.input, { store: f.store, env: fixtureEnv,
    transport: async () => { calls++; throw new Error('Unexpected model call'); } });
  assert.equal(result.errorCode, 'STORAGE_UNAVAILABLE'); assert.equal(result.runId, null); assert.equal(calls, 0);
  assert.deepEqual(records(f.sql), before);
  assert.equal(f.store.getProject(f.session.id, f.input.projectId).project.currentVersionId, f.a.version.id);
});

test('restored deadline at the final transaction checkpoint rolls back candidate, summary and succeeded together', async t => {
  const f = await restoredFixture(t); const before = records(f.sql); let clock = 0;
  const complete = f.store.completeGeneration.bind(f.store);
  t.mock.method(f.store, 'completeGeneration', (...args: Parameters<typeof complete>) => {
    const [input, runId, snapshot, summary, check, now] = args; let checkpoints = 0;
    return complete(input, runId, snapshot, summary, () => { if (++checkpoints === 2) clock = 1001; check(); }, now);
  });
  const fixture = await startFixture((_, res, index) => res.end(JSON.stringify(index === 1
    ? generationCall('read_files', { paths: ['/src/App.tsx'] }, index) : submitCall(index))));
  try {
    const result = await generateProject(f.input, { store: f.store, env: fixtureEnv, transport: fixture.transport, clock: () => clock });
    assert.equal(result.errorCode, 'GENERATION_TIMEOUT'); assert.equal(result.terminalStatePersisted, true);
    const after = records(f.sql); assert.deepEqual(after.versions, before.versions);
    assert.equal(after.messages.length, before.messages.length + 1);
    assert.deepEqual(after.messages.slice(0, before.messages.length), before.messages);
    assert.equal(f.store.inspectGeneration(f.input)?.run.status, 'failed');
    assert.equal(f.store.inspectGeneration(f.input)?.candidateVersion, null);
    assert.equal(f.store.getProject(f.session.id, f.input.projectId).project.currentVersionId, f.a.version.id);
  } finally { await fixture.close(); }
});

for (const failure of ['refusal', 'truncation', 'file-policy', 'cancel', 'timeout', 'base-change', 'candidate', 'summary', 'success-state', 'terminal', 'context-limit'] as const) {
  test(`restored failure matrix: ${failure} retains current and has no partial success`, async t => {
    const f = await restoredFixture(t); const controller = new AbortController();
    if (failure === 'context-limit') {
      const large = f.store.createRun({ ...f.input, requestId: randomUUID() });
      const snapshot = marked(f.bundle, 'LARGE_BASE');
      const { digest, ...body } = snapshot; void digest;
      body.files['/src/generated/Large.ts'] = 'x'.repeat(90 * 1024);
      const saved = f.store.saveCandidate({ projectId: f.input.projectId, runId: large.id,
        snapshot: snapshotSchema.parse({ ...body, digest: createHash('sha256').update(canonicalJSON(body)).digest('hex') }) });
      f.input.baseVersionId = saved.version.id;
      f.sql.prepare('UPDATE projects SET current_version_id=? WHERE id=?').run(saved.version.id, f.input.projectId);
    }
    const before = records(f.sql);
    const trigger = failure === 'candidate' ? 'BEFORE INSERT ON versions' : failure === 'summary'
      ? "BEFORE INSERT ON messages WHEN NEW.role='assistant'" : failure === 'success-state'
        ? "BEFORE UPDATE ON generation_runs WHEN NEW.status='succeeded'" : failure === 'terminal' ? 'BEFORE UPDATE ON generation_runs' : null;
    if (trigger) f.sql.exec(`CREATE TRIGGER reject_success ${trigger} BEGIN SELECT RAISE(ABORT,'PRIVATE_FAILURE'); END;`);
    const fixture = await startFixture((_, res, index) => {
      if (failure === 'cancel' || failure === 'timeout') { if (failure === 'cancel') controller.abort(); return; }
      const body = failure === 'refusal' ? response([{ type: 'message', id: 'refusal', role: 'assistant', content: [{ type: 'refusal', refusal: 'fixture refusal' }] }])
        : failure === 'truncation' ? generationCall('list_files', {}, index, { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } })
          : failure === 'file-policy' && index > 1 ? generationCall('submit_files', { files: [{ path: '/package.json', content: '{}' }] }, index)
            : failure === 'context-limit' ? generationCall('read_files', { paths: ['/src/generated/Large.ts'] }, index)
              : index === 1 ? generationCall('read_files', { paths: ['/src/App.tsx'] }, index) : submitCall(index);
      res.end(JSON.stringify(body));
    });
    try {
      const result = await generateProject(f.input, { store: f.store, env: fixtureEnv, transport: fixture.transport, signal: controller.signal,
        observe: event => { if (failure === 'base-change' && event.type === 'validated') {
          f.sql.prepare('UPDATE projects SET current_version_id=? WHERE id=?').run(f.b.version.id, f.input.projectId);
        } } });
      const code = { refusal: 'MODEL_REFUSAL', truncation: 'MODEL_TRUNCATED', 'file-policy': 'FILE_POLICY', cancel: 'CANCELLED',
        timeout: 'GENERATION_TIMEOUT', 'base-change': 'BASE_VERSION_CHANGED', candidate: 'STORAGE_UNAVAILABLE', summary: 'STORAGE_UNAVAILABLE',
        'success-state': 'STORAGE_UNAVAILABLE', terminal: 'STORAGE_UNAVAILABLE', 'context-limit': 'CONTEXT_LIMIT' }[failure];
      assert.equal(result.errorCode, code, JSON.stringify(result)); assert.equal(result.candidateVersionId, null);
      assert.equal(result.terminalStatePersisted, failure !== 'terminal');
      const record = f.store.inspectGeneration(f.input); assert.ok(record); assert.equal(record.candidateVersion, null);
      assert.equal(record.run.status, failure === 'terminal' ? 'running' : failure === 'cancel' ? 'cancelled' : 'failed');
      const after = records(f.sql);
      assert.deepEqual(after.versions, before.versions);
      assert.deepEqual(after.runs.slice(0, before.runs.length), before.runs);
      assert.deepEqual(after.messages.slice(0, before.messages.length), before.messages);
      assert.equal(after.messages.length, before.messages.length + 1);
      assert.equal(f.store.getProject(f.session.id, f.input.projectId).project.currentVersionId, failure === 'base-change' ? f.b.version.id : f.input.baseVersionId);
      assert.equal(fixture.requests.length, ['refusal', 'truncation', 'cancel', 'timeout'].includes(failure) ? 1 : failure === 'context-limit' ? 3 : 2);
      assert.ok(!JSON.stringify(result).includes('PRIVATE_FAILURE'));
      if (failure === 'terminal') {
        const count = fixture.requests.length;
        const replay = await generateProject(f.input, { store: f.store, env: {}, transport: fixture.transport });
        assert.equal(replay.status, 'running'); assert.equal(replay.replayed, true); assert.equal(replay.terminalStatePersisted, false);
        assert.deepEqual(replay.metrics, { requestCount: null, usage: null, requests: null });
        assert.equal(fixture.requests.length, count); assert.deepEqual(records(f.sql), after);
      }
    } finally { await fixture.close(); }
  });
}
