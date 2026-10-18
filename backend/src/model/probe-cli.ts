import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { caseNames } from './probe-cases.js';
import type { CaseName } from './probe-cases.js';
import { runProbe } from './probe-runner.js';

const help = `Usage: pnpm model:probe [--help] | --case text|files|tools|all [--report]
Explicit --case performs paid OpenAI API requests with backend configuration.
No arguments / --help: help only, no env file loading or network.
--report: additionally save sanitized JSON in test-results/model-probe/<runId>.json.
Text/files: at most 1 request each; tools: at most 2; all: at most 4. No retries.
ChatGPT Pro does not provide an OpenAI Platform API key or API credit.
`;

function parseArgs(args: string[]): { selected: CaseName | 'all'; report: boolean } | 'help' | 'invalid' {
  if (!args.length || (args.length === 1 && args[0] === '--help')) return 'help';
  if ((args.length !== 2 && args.length !== 3) || args[0] !== '--case' ||
      (args.length === 3 && args[2] !== '--report')) return 'invalid';
  const selected = args[1];
  if (selected !== 'all' && !caseNames.some(name => name === selected)) return 'invalid';
  return { selected: selected as CaseName | 'all', report: args.length === 3 };
}

export async function runProbeCli(args: string[], dependencies: {
  env?: NodeJS.ProcessEnv;
  loadEnvironment?: () => void;
  transport?: typeof fetch;
  reportDirectory?: string;
} = {}): Promise<number> {
  const parsed = parseArgs(args);
  if (parsed === 'help') { process.stdout.write(help); return 0; }
  if (parsed === 'invalid') { process.stderr.write(`Invalid arguments.\n${help}`); return 1; }
  const controller = new AbortController();
  let signalExit: number | undefined;
  const cancelInt = () => { signalExit ??= 130; controller.abort(); };
  const cancelTerm = () => { signalExit ??= 143; controller.abort(); };
  process.on('SIGINT', cancelInt);
  process.on('SIGTERM', cancelTerm);
  try {
    let environmentLoaded = true;
    try {
      if (dependencies.loadEnvironment) dependencies.loadEnvironment();
      else if (!dependencies.env && existsSync('.env')) loadEnvFile('.env');
    } catch { environmentLoaded = false; }
    const report = await runProbe(parsed.selected, {
      env: environmentLoaded ? dependencies.env ?? process.env : {},
      signal: controller.signal,
      ...(dependencies.transport ? { transport: dependencies.transport } : {}),
    });
    const json = `${JSON.stringify(report, null, 2)}\n`;
    process.stdout.write(json);
    if (parsed.report) {
      try {
        const directory = dependencies.reportDirectory ?? fileURLToPath(new URL('../../../test-results/model-probe/', import.meta.url));
        await mkdir(directory, { recursive: true });
        await writeFile(`${directory}/${report.runId}.json`, json, { flag: 'wx', mode: 0o600 });
      } catch { process.stderr.write('Unable to save sanitized model probe report.\n'); return signalExit ?? 1; }
    }
    return signalExit ?? (report.status === 'passed' ? 0 : 1);
  } finally {
    process.off('SIGINT', cancelInt);
    process.off('SIGTERM', cancelTerm);
  }
}
