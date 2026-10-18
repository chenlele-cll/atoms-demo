import { access, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { plan, profiles, requiredFiles, requiredScripts } from './verification/registry.mjs';
import { acquireRunLock, assertInputs, atomicJson, buildIdentity, cleanEnvironment, copyInputs, freePorts, safePath, sha256 } from './verification/input.mjs';
import { schedule } from './verification/scheduler.mjs';
import processes from './verification/processes.cjs';
import evidence from './verification/evidence.cjs';
const exec = promisify(execFile);
const ROOT = fileURLToPath(new URL('../', import.meta.url));
export function parseArgs(args) {
  if (!args.length || args.length === 1 && ['--help', '-h'].includes(args[0])) return { help: true };
  if (args.length !== 2 || args[0] !== '--profile' || !Object.hasOwn(profiles, args[1])) throw new Error('INVALID_PROFILE');
  return { profile: args[1] };
}
export async function prerequisites(root, profile, signal = undefined) {
  let pkg;
  try { pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')); }
  catch (error) { throw new Error('MISSING_SCRIPT', { cause: error }); }
  if (requiredScripts.some(name => typeof pkg.scripts?.[name] !== 'string')) throw new Error('MISSING_SCRIPT');
  try { for (const name of requiredFiles) { const filename = await safePath(root, name); if (!(await lstat(filename)).isFile()) throw new Error('MISSING_SCRIPT'); } }
  catch (error) { throw new Error('MISSING_SCRIPT', { cause: error }); }
  if (process.version !== 'v' + (await readFile(path.join(root, '.nvmrc'), 'utf8')).trim()) throw new Error('TOOLCHAIN');
  const env = cleanEnvironment();
  try {
    const pnpm = await exec('pnpm', ['--version'], { cwd: root, env, signal, timeout: 5000 }); if ('pnpm@' + pnpm.stdout.trim() !== pkg.packageManager) throw new Error('TOOLCHAIN');
    await exec('npx', ['--version'], { cwd: root, env, signal, timeout: 5000 });
  } catch (error) { if (error.name === 'AbortError') throw error; throw new Error('TOOLCHAIN', { cause: error }); }
  const chrome = await processes.runCommand({ command: process.execPath, args: ['--input-type=module', '-e',
    "import {chromium} from 'playwright-core';const b=await chromium.launch({channel:'chrome',headless:true,handleSIGINT:false,handleSIGTERM:false,timeout:10000});await b.close();"], cwd: root, env, signal, timeoutMs: 15_000 });
  if (chrome.cleanup !== 'passed') throw new Error('CLEANUP_INCOMPLETE');
  if (chrome.status === 'cancelled') throw new Error('SIGNAL');
  if (chrome.status !== 'passed') throw new Error('MISSING_CHROME');
  if (profile === 'full') {
    const version = (await readFile(path.join(root, '.process-compose-version'), 'utf8')).trim();
    try { await access(path.join(root, '.tools/process-compose', version, 'process-compose')); } catch (error) { throw new Error('MISSING_PROCESS_COMPOSE', { cause: error }); }
  }
  await freePorts();
}
export function prerequisiteResult(step, result) {
  if (result.status !== 'passed' && step.prerequisite && result.reason === 'COMMAND_FAILED') return { ...result, status: 'blocked', reason: step.native ? 'NATIVE_BINDING' : step.id === 'install' ? 'OFFLINE_INSTALL' : 'DOCTOR_FAILED' };
  return result;
}
const reasons = new Set(['INVALID_RUN_ID', 'RUN_EXISTS', 'VERIFY_BUSY', 'PORT_BUSY', 'MISSING_SCRIPT', 'MISSING_PROCESS_COMPOSE', 'TOOLCHAIN', 'MISSING_CHROME', 'UNSAFE_INPUT', 'STALE_INPUT', 'UNSAFE_LOCK']);
export function publicSummary(summary) {
  return { schemaVersion: 1, runId: summary.runId, profile: summary.profile, evidenceKind: 'application-regression', source: 'fixture', status: summary.status, reason: summary.reason,
    sourceDigest: summary.sourceDigest, buildDigest: summary.buildDigest, artifactDigest: summary.artifactDigest, platform: `${process.platform}/${process.arch}`, durationMs: summary.durationMs,
    cleanup: summary.cleanup, realModel: 'not-run', deployment: 'not-run', hostedCI: 'not-run', completeBuilds: summary.completeBuilds,
    steps: summary.steps.map(item => ({ id: item.id, owner: item.owner, coverage: item.coverage, status: item.status, reason: item.reason, exitCode: item.exitCode ?? null, cleanup: item.cleanup ?? 'not-run', cases: item.cases, durationMs: item.durationMs, ...(item.evidenceKind ? { evidenceKind: item.evidenceKind } : {}) })), screenshots: summary.screenshots };
}
function markdown(value) {
  return `# 本次产品回归\n\nRun: ${value.runId}\n\n范围: ${value.profile} · 状态: ${value.status} · 原因: ${value.reason ?? '无'}\n\n源码: ${value.sourceDigest ?? '未准备'}\n\n构建: ${value.buildDigest ?? '未构建'}\n\n| 检查 | 状态 | 原因 | 用例数 |\n| --- | --- | --- | --- |\n${value.steps.map(item => `| ${item.id} | ${item.status} | ${item.reason ?? '—'} | ${item.cases ?? '未知'} |`).join('\n')}\n\n模型来源为受控 fixture。真实模型、部署及 hosted CI 均未运行。\n`;
}
async function artifactIdentity(root) {
  const entries = [];
  async function visit(folder) {
    for (const item of await readdir(path.join(root, folder), { withFileTypes: true })) {
      const name = path.posix.join(folder, item.name);
      if (item.isDirectory()) await visit(name); else if (item.isFile() && name.endsWith('.md') || item.isFile() && /\.(?:ya?ml|json)$/.test(name)) entries.push([name, sha256(await readFile(await safePath(root, name)))]);
    }
  }
  await visit('openspec'); return sha256(JSON.stringify(entries.sort((a, b) => a[0].localeCompare(b[0]))));
}
export async function verify(root, profile, suppliedId = undefined) {
  root = await realpath(root); const runId = suppliedId ?? randomUUID();
  if (!evidence.ID.test(runId)) throw new Error('INVALID_RUN_ID');
  let base = root;
  for (const part of ['test-results', 'gen-regression']) { base = path.join(base, part); await mkdir(base, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; }); if (!(await lstat(base)).isDirectory() || (await lstat(base)).isSymbolicLink()) throw new Error('UNSAFE_INPUT'); }
  const directory = path.join(base, runId); try { await mkdir(directory, { mode: 0o700 }); } catch (error) { if (error.code === 'EEXIST') throw new Error('RUN_EXISTS', { cause: error }); throw error; }
  const privateDir = path.join(directory, 'private'); const exportDir = path.join(directory, 'export');
  await mkdir(privateDir, { mode: 0o700 }); await mkdir(exportDir, { mode: 0o700 });
  const started = Date.now(); const controller = new AbortController(); let interrupted; let release; let snapshot; let built;
  const signalHandlers = ['SIGINT', 'SIGTERM'].map(signal => { const handler = () => { interrupted = signal; controller.abort(); }; process.once(signal, handler); return [signal, handler]; });
  const summary = { runId, profile, status: 'running', reason: null, sourceDigest: null, buildDigest: null, artifactDigest: null, durationMs: 0, cleanup: 'not-run', completeBuilds: 0,
    steps: plan(profile).map(item => ({ id: item.id, owner: item.owner, coverage: item.coverage, status: 'not-run', reason: item.selected ? 'EARLIER_FAILURE' : 'NOT_SELECTED', cases: null, durationMs: null })), screenshots: [] };
  const publish = async steps => {
    if (steps) summary.steps = steps;
    summary.durationMs = Date.now() - started; const value = publicSummary(summary);
    await atomicJson(path.join(privateDir, 'summary.json'), value); await atomicJson(path.join(exportDir, 'summary.json'), value);
    const temporary = path.join(exportDir, 'summary.md.tmp'); await writeFile(temporary, markdown(value), { mode: 0o600 });
    const { rename } = await import('node:fs/promises'); await rename(temporary, path.join(exportDir, 'summary.md'));
  };
  try {
    await publish();
    release = await acquireRunLock(root, () => controller.abort());
    await prerequisites(root, profile, controller.signal);
    snapshot = await copyInputs(root, path.join(directory, 'source')); summary.sourceDigest = snapshot.digest;
    await atomicJson(path.join(privateDir, 'input-manifest.json'), snapshot);
    summary.artifactDigest = await artifactIdentity(root);
    const env = cleanEnvironment(); const networkLog = path.join(privateDir, 'model-network.log');
    env.ATOMS_VERIFY_NETWORK_LOG = networkLog;
    const source = path.join(directory, 'source');
    env.NODE_OPTIONS = `--import=${pathToFileURL(path.join(source, 'scripts/verification/network-guard.mjs')).href}`;
    summary.steps = await schedule({ steps: plan(profile), budgetMs: profiles[profile] - (Date.now() - started), signal: controller.signal, publish,
      checkpoint: async step => {
        await assertInputs(root, source, snapshot);
        if (built && step.browser && (await buildIdentity(source)).digest !== built.digest) throw new Error('STALE_BUILD');
      },
      execute: async (step, timeoutMs) => {
        console.log(`[${profile}] ${step.id}…`); const ledger = path.join(privateDir, `${step.id}-processes.jsonl`); const stepEnv = { ...env };
        if (step.id === 'openspec') summary.artifactDigest = await artifactIdentity(root);
        const args = [...step.args]; let context;
        if (step.native) args.push(path.join(privateDir, 'native.sqlite'));
        if (step.browser) {
          context = { runId, profile, suite: step.id, sourceDigest: snapshot.digest, buildDigest: built.digest, report: path.join(privateDir, `${step.id}-report.json`), ledger, minimumCases: step.minimumCases };
          const filename = path.join(privateDir, `${step.id}-context.json`); await atomicJson(filename, context); stepEnv.ATOMS_VERIFY_CONTEXT = filename;
          await freePorts();
        }
        const result = prerequisiteResult(step, await processes.runCommand({ command: step.command, args, cwd: step.original ? root : source, env: stepEnv, signal: controller.signal, timeoutMs, ledger,
          log: path.join(privateDir, `${step.id}.log`) }));
        if (await readFile(networkLog, 'utf8').catch(() => '') !== '') throw new Error('MODEL_NETWORK_FORBIDDEN');
        if (step.id === 'build' && result.status === 'passed') { built = await buildIdentity(source); summary.buildDigest = built.digest; summary.completeBuilds++; await atomicJson(path.join(privateDir, 'build-manifest.json'), built); }
        if (step.browser && result.status === 'passed') {
          let raw; try { raw = await readFile(context.report, 'utf8'); } catch { throw new Error('MISSING_REPORT'); }
          if (raw.length > 1024 * 1024) throw new Error('REPORT_CASES');
          let report; try { report = JSON.parse(raw); } catch { throw new Error('REPORT_IDENTITY'); }
          evidence.validateReport(report, context, result.exitCode); result.cases = report.cases.length;
          for (const item of report.screenshots) { const bytes = evidence.screenshotForExport(privateDir, item); await writeFile(path.join(exportDir, item.path), bytes, { mode: 0o600, flag: 'wx' }); summary.screenshots.push({ path: item.path, redacted: true, digest: item.digest }); }
          if ((await buildIdentity(source)).digest !== built.digest) throw new Error('STALE_BUILD');
          await freePorts();
        }
        console.log(`[${profile}] ${step.id}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`); return result;
      } });
    await assertInputs(root, source, snapshot);
    summary.status = summary.steps.some(item => item.status === 'cancelled') ? 'cancelled' : summary.steps.some(item => item.status === 'blocked') ? 'blocked' : summary.steps.some(item => !['passed', 'not-run'].includes(item.status) || item.status === 'not-run' && item.reason !== 'NOT_SELECTED') ? 'failed' : 'passed';
    summary.reason = summary.steps.find(item => ['failed', 'blocked', 'cancelled'].includes(item.status))?.reason ?? null;
  } catch (error) {
    summary.status = interrupted ? 'cancelled' : reasons.has(error.message) && error.message !== 'STALE_INPUT' ? 'blocked' : 'failed';
    summary.reason = reasons.has(error.message) ? error.message : interrupted ? 'SIGNAL' : 'PRECONDITION_FAILED';
    if (error.message === 'CLEANUP_INCOMPLETE') summary.cleanup = 'failed';
  }
  finally {
    for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
    try { await release?.(); summary.cleanup = summary.cleanup === 'failed' || summary.steps.some(item => item.cleanup === 'failed') ? 'failed' : 'passed'; }
    catch { summary.cleanup = 'failed'; }
    if (summary.cleanup === 'failed') { summary.status = 'failed'; summary.reason = 'CLEANUP_INCOMPLETE'; }
    await publish();
  }
  console.log(`${summary.status}: test-results/gen-regression/${runId}/export/summary.json`);
  return interrupted === 'SIGINT' ? 130 : interrupted === 'SIGTERM' ? 143 : summary.status === 'passed' ? 0 : summary.status === 'blocked' ? 2 : 1;
}
async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) { console.log('Usage: node scripts/verify.mjs --profile product|full\nproduct: isolated check/build/diagnostics/workspace (20 min).\nfull: additionally doctor/manager/template/projects/stream/candidate (40 min).\nNo live model calls. ATOMS_VERIFY_RUN_ID optionally selects a new unique artifact id.'); return; }
    process.exitCode = await verify(ROOT, args.profile, process.env.ATOMS_VERIFY_RUN_ID);
  } catch (error) { console.error(reasons.has(error.message) || error.message === 'INVALID_PROFILE' ? error.message : 'VERIFICATION_FAILED'); process.exitCode = 2; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
