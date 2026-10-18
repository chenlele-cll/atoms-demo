const { randomUUID, createHash } = require('node:crypto');
const { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, lstatSync, realpathSync } = require('node:fs');
const path = require('node:path');
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const HASH = /^[a-f0-9]{64}$/;
const SUITES = new Set(['smoke', 'template', 'projects', 'generation-stream', 'candidate', 'workspace']);
const caseId = value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) + '-' + createHash('sha256').update(String(value)).digest('hex').slice(0, 8);
function atomic(filename, value) {
  mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 }); const temp = filename + '.' + randomUUID() + '.tmp';
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); renameSync(temp, filename);
}
function validateContext(context) {
  if (!context || !ID.test(context.runId) || !SUITES.has(context.suite) || !['product', 'full'].includes(context.profile) || !HASH.test(context.sourceDigest) || !HASH.test(context.buildDigest) || !Number.isSafeInteger(context.minimumCases) || context.minimumCases < 1 || typeof context.report !== 'string' || typeof context.ledger !== 'string') throw new Error('INVALID_REPORT_CONTEXT');
  return context;
}
function createEvidence(suite) {
  if (!SUITES.has(suite)) throw new Error('UNKNOWN_SUITE');
  let context = process.env.ATOMS_VERIFY_CONTEXT ? validateContext(JSON.parse(readFileSync(process.env.ATOMS_VERIFY_CONTEXT, 'utf8'))) : null;
  if (context && context.suite !== suite) throw new Error('WRONG_REPORT_SUITE');
  // Control-test subprocesses of an independent suite cannot overwrite its main report.
  if (context) { const claim = context.report + '.claim'; if (existsSync(claim)) context = null; else writeFileSync(claim, String(process.pid), { flag: 'wx', mode: 0o600 }); }
  const screenshots = [];
  const finish = legacy => {
    if (!context) return;
    const value = { schemaVersion: 1, suite, runId: context.runId, profile: context.profile, sourceDigest: context.sourceDigest, buildDigest: context.buildDigest,
      evidenceKind: 'application-regression', source: 'fixture', status: legacy.status, cleanup: legacy.cleanup,
      cases: (legacy.cases ?? []).map(item => ({ id: caseId(item.id ?? item.name), status: item.status, durationMs: item.durationMs ?? null, observationCode: item.status === 'passed' ? 'ASSERTIONS_PASSED' : 'ASSERTION_FAILED' })), screenshots,
      realModelCalls: legacy.realModelCalls ?? 0 };
    atomic(context.report, value);
  };
  async function screenshot(page, options) {
    // Private captures retain existing detail. Only these masked derivatives can be exported.
    await page.screenshot(options);
    if (!context || suite !== 'workspace' || !['dev-1280.png', 'preview-mobile-adopted.png'].includes(path.basename(options.path))) return;
    const relative = `${suite}-${path.basename(options.path)}`;
    if (screenshots.some(item => item.path === relative)) return;
    const filename = path.join(path.dirname(context.report), relative);
    await page.screenshot({ ...options, path: filename, mask: [page.locator('input,textarea,select,pre,code,p,label,h1,h2,h3,nav,iframe,[role="alert"],[data-message-id],[data-pending-user],[data-task-phase],[data-viewed-version]')], maskColor: '#d7ddd7' });
    screenshots.push({ path: relative, redacted: true, digest: createHash('sha256').update(readFileSync(filename)).digest('hex') });
  }
  return { finish, screenshot };
}
function validateReport(value, expected, exitCode) {
  validateContext(expected);
  if (!value || value.schemaVersion !== 1 || ['suite', 'runId', 'profile', 'sourceDigest', 'buildDigest'].some(key => value[key] !== expected[key]) || value.source !== 'fixture' || value.evidenceKind !== 'application-regression') throw new Error('REPORT_IDENTITY');
  if (exitCode !== 0 || value.status !== 'passed' || value.cleanup !== 'passed' || value.realModelCalls !== 0) throw new Error('REPORT_OUTCOME');
  if (!Array.isArray(value.cases) || value.cases.length < expected.minimumCases || !value.cases.length || new Set(value.cases.map(item => item.id)).size !== value.cases.length || value.cases.some(item => !/^[a-z0-9-]{1,80}$/.test(item.id) || item.status !== 'passed' || item.observationCode !== 'ASSERTIONS_PASSED' || !(item.durationMs === null || Number.isFinite(item.durationMs) && item.durationMs >= 0))) throw new Error('REPORT_CASES');
  if (!Array.isArray(value.screenshots)) throw new Error('REPORT_EVIDENCE');
  return value;
}
function safeEvidence(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(item => !item || item === '..' || item === '.')) throw new Error('UNSAFE_EVIDENCE');
  const base = realpathSync(root); let current = base;
  for (const part of relative.split('/')) { current = path.join(current, part); if (lstatSync(current).isSymbolicLink()) throw new Error('UNSAFE_EVIDENCE'); }
  if (!current.startsWith(base + path.sep) || !lstatSync(current).isFile()) throw new Error('UNSAFE_EVIDENCE'); return current;
}
function screenshotForExport(root, item) {
  if (!item || item.redacted !== true || !HASH.test(item.digest) || !/^(workspace-dev-1280|workspace-preview-mobile-adopted)\.png$/.test(item.path)) throw new Error('UNREDACTED_EVIDENCE');
  const filename = safeEvidence(root, item.path); const bytes = readFileSync(filename);
  if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || createHash('sha256').update(bytes).digest('hex') !== item.digest) throw new Error('INVALID_SCREENSHOT'); return bytes;
}
module.exports = { createEvidence, validateReport, screenshotForExport, safeEvidence, caseId, ID, HASH, atomic };
