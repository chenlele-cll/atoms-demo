import { runProbeCli } from './probe-cli.js';

// Explicit command entry only. Application startup/health never import this file.
runProbeCli(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(() => {
  process.stderr.write('Model probe failed before producing a report.\n');
  process.exitCode = 1;
});
