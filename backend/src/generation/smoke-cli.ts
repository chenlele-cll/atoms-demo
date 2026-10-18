import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { runGenerationSmoke } from './smoke-runner.js';
import type { SmokeCase } from './smoke-cases.js';

const help = `Usage: pnpm generation:smoke [--help] | --live --case quote|filter
No arguments / --help: no environment loading or model requests.
--live with one public case is required; uses OpenCode CLI 1.18.23 (24 agent steps).
Actual CLI provider request/token counts are unknown; no automatic application retry.
Uses a new isolated project/database, ignoring production DATABASE_PATH.
Saves sanitized report in test-results/generation-smoke/<id>/report.json.
Candidate saved does not mean compiled, previewed or adopted.
`;
export async function runGenerationSmokeCli(args: string[], dependencies: {
  env?: NodeJS.ProcessEnv;
  transport?: typeof fetch;
  directory?: string;
} = {}): Promise<number> {
  if (args.length === 0 || (args.length === 1 && args[0] === '--help')) { process.stdout.write(help); return 0; }
  const selected = args[2];
  if (args.length !== 3 || args[0] !== '--live' || args[1] !== '--case' || (selected !== 'quote' && selected !== 'filter')) {
    process.stderr.write(`Invalid arguments.\n${help}`); return 1;
  }
  const controller = new AbortController(); let signalExit: number | undefined;
  const interrupt = () => { signalExit ??= 130; controller.abort(); };
  const terminate = () => { signalExit ??= 143; controller.abort(); };
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
  try {
    let env = dependencies.env ?? process.env;
    if (!dependencies.env) {
      try { if (existsSync('.env')) loadEnvFile('.env'); } catch { env = {}; }
    }
    const directory = dependencies.directory ?? fileURLToPath(new URL('../../../test-results/generation-smoke/', import.meta.url));
    const report = await runGenerationSmoke(selected as SmokeCase, { env, directory, signal: controller.signal,
      ...(dependencies.transport ? { transport: dependencies.transport } : {}) });
    const json = `${JSON.stringify(report, null, 2)}\n`; process.stdout.write(json);
    try {
      const destination = `${directory}/${report.id}`;
      await mkdir(destination, { recursive: true, mode: 0o700 });
      await writeFile(`${destination}/report.json`, json, { flag: 'wx', mode: 0o600 });
    } catch { process.stderr.write('Unable to save generation smoke report.\n'); return signalExit ?? 1; }
    return signalExit ?? (report.status === 'passed' ? 0 : 1);
  } finally { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); }
}
