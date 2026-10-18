// Fixed product acceptance plan. CLI callers cannot supply commands or skip required steps.
export const profiles = Object.freeze({ product: 20 * 60_000, full: 40 * 60_000 });
const step = (id, command, args, minutes, owner, coverage, extra = {}) => Object.freeze({ id, command, args, timeoutMs: minutes * 60_000, owner, coverage, ...extra });
export const suites = Object.freeze([
  step('doctor', './manager.sh', ['doctor', '--json'], 1, 'OPS-003', ['toolchain'], { original: true, fullOnly: true, prerequisite: true }),
  step('install', 'pnpm', ['install', '--offline', '--frozen-lockfile'], 3, 'GEN-008', ['isolated-dependencies'], { prerequisite: true }),
  step('native', 'pnpm', ['--filter', '@atoms/backend', 'exec', 'node', '--input-type=module', '-e', 'import Database from "better-sqlite3";const db=new Database(process.argv[1]);try{db.exec("CREATE TABLE native_check(value INTEGER)");db.prepare("INSERT INTO native_check VALUES(?)").run(1);if(db.prepare("SELECT value FROM native_check").get().value!==1)throw Error("Native check failed");}finally{db.close();}'], 1, 'GEN-003', ['native-sqlite'], { prerequisite: true, native: true }),
  step('check', 'pnpm', ['check'], 6, 'GEN-001–008', ['types', 'sdk', 'storage', 'bounded-stream', 'controller', 'scheduler']),
  step('template-prepare', 'pnpm', ['test:template'], 2, 'GEN-001', ['template-source', 'file-policy']),
  step('infra', 'pnpm', ['test:infra'], 2, 'INF-001', ['infrastructure-boundary'], { original: true }),
  step('manager', 'pnpm', ['test:manager'], 8, 'OPS-001–003', ['process-lifecycle', 'ownership'], { original: true, fullOnly: true }),
  step('build', 'pnpm', ['build'], 3, 'GEN-008', ['production-artifacts']),
  step('smoke', 'node', ['scripts/smoke.cjs'], 3, 'VER-001', ['diagnostics', 'proxy', 'narrow-layout'], { browser: true, minimumCases: 3 }),
  step('template', 'pnpm', ['smoke:template'], 8, 'GEN-001', ['template-preview', 'compile-failure', 'browser-cleanup'], { browser: true, minimumCases: 13, fullOnly: true }),
  step('projects', 'pnpm', ['smoke:projects'], 4, 'GEN-003', ['ownership', 'persistence', 'reopen'], { browser: true, minimumCases: 6, fullOnly: true }),
  step('generation-stream', 'pnpm', ['smoke:generation-stream'], 4, 'GEN-005', ['first-frame', 'cancel', 'disconnect', 'restart'], { browser: true, minimumCases: 8, fullOnly: true }),
  step('candidate', 'pnpm', ['smoke:candidate'], 8, 'GEN-006', ['real-preview', 'adoption-cas', 'unknown-adoption'], { browser: true, minimumCases: 21, fullOnly: true }),
  step('workspace', 'pnpm', ['smoke:workspace'], 6, 'GEN-007', ['visible-create', 'sdk-tools', 'sqlite', 'quote-interaction', 'adopt', 'reopen', 'cancel', 'session-isolation', 'mobile'], { browser: true, minimumCases: 26 }),
  step('openspec', 'pnpm', ['openspec', 'validate', '--all', '--strict', '--no-interactive'], 2, 'OSP-001', ['artifact-structure'], { original: true }),
]);
export function plan(profile) {
  if (!Object.hasOwn(profiles, profile)) throw new Error('INVALID_PROFILE');
  return suites.map(item => ({ ...item, selected: !item.fullOnly || profile === 'full' }));
}
export const requiredScripts = ['check', 'test:template', 'test:infra', 'test:manager', 'build', 'smoke:template', 'smoke:projects', 'smoke:generation-stream', 'smoke:candidate', 'smoke:workspace', 'openspec'];
export const requiredFiles = ['manager.sh', '.nvmrc', '.process-compose-version', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'scripts/smoke.cjs', 'scripts/template-smoke.cjs', 'scripts/project-smoke.cjs', 'scripts/generation-stream-smoke.cjs', 'scripts/candidate-smoke.cjs', 'scripts/workspace-smoke.cjs', 'scripts/verification/evidence.cjs'];
