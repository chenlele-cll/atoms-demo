// Shared execution loop; tests inject real control children at this module boundary only.
export async function schedule({ steps, budgetMs, execute, checkpoint = async () => {}, publish = async () => {}, signal, now = Date.now, evidenceKind = 'application-regression' }) {
  const started = now(); const results = steps.map(step => ({ id: step.id, owner: step.owner, coverage: step.coverage, status: 'not-run', reason: step.selected ? 'EARLIER_FAILURE' : 'NOT_SELECTED', cases: null, durationMs: null }));
  await publish(results);
  let failed = false;
  for (const [index, step] of steps.entries()) {
    if (!step.selected || failed) continue;
    const result = results[index];
    if (signal?.aborted) { Object.assign(result, { status: 'cancelled', reason: 'SIGNAL' }); failed = true; await publish(results); continue; }
    const remaining = budgetMs - (now() - started);
    if (remaining <= 0) { Object.assign(result, { status: 'failed', reason: 'TOTAL_BUDGET' }); failed = true; await publish(results); continue; }
    Object.assign(result, { status: 'running', reason: null }); await publish(results);
    try {
      await checkpoint(step);
      const currentRemaining = budgetMs - (now() - started);
      if (currentRemaining <= 0) Object.assign(result, { status: 'failed', reason: 'TOTAL_BUDGET' });
      else Object.assign(result, await execute(step, Math.min(step.timeoutMs, currentRemaining)));
      if (signal?.aborted && result.status === 'passed') Object.assign(result, { status: 'cancelled', reason: 'SIGNAL' });
    } catch (error) {
      const known = new Set(['STALE_INPUT', 'STALE_BUILD', 'MISSING_REPORT', 'REPORT_IDENTITY', 'REPORT_OUTCOME', 'REPORT_CASES', 'REPORT_EVIDENCE', 'UNSAFE_EVIDENCE', 'UNREDACTED_EVIDENCE', 'INVALID_SCREENSHOT', 'MODEL_NETWORK_FORBIDDEN']);
      Object.assign(result, { status: 'failed', reason: known.has(error.message) ? error.message : 'STEP_FAILED' });
    }
    result.evidenceKind = evidenceKind;
    if (result.status !== 'passed') failed = true;
    await publish(results);
  }
  return results;
}
