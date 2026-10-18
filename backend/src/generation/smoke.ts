import { runGenerationSmokeCli } from './smoke-cli.js';

runGenerationSmokeCli(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(() => {
  process.stderr.write('Generation smoke failed before producing a safe report.\n'); process.exitCode = 1;
});
