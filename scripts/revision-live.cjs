function parseArgs(args = []) {
  if (!Array.isArray(args)) throw Error('INVALID_ARGUMENTS');
  if (!args.length || args.length === 1 && ['--help', '-h'].includes(args[0])) return {help: true};
  if (args.length === 1 && args[0] === '--live') return {live: true};
  throw Error('INVALID_ARGUMENTS');
}
module.exports = {parseArgs};
if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) console.log('Usage: pnpm smoke:revision:live --live\nExplicit V1/V2/V3 live acceptance; matching fixture required, maximum 18 requests, no retry. No arguments/help only display this text.');
    else require('./revision-smoke.cjs').run(args).then(code => { process.exitCode = code; }).catch(() => { console.error('REVISION_RUN_FAILED'); process.exitCode = 1; });
  } catch { console.error('INVALID_ARGUMENTS'); process.exitCode = 2; }
}
