import {readFile,writeFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateReview,summary} from './live/report.mjs';
import {atomicJson,safePath} from './verification/input.mjs';
export async function mergeReview(runDirectory){
 const privateDir=path.join(runDirectory,'private');const reportFile=await safePath(privateDir,'report.json');const reviewFile=await safePath(privateDir,'manual-review.json');for(const file of[reportFile,reviewFile])if((await lstat(file)).size>1024*1024)throw Error('REVIEW_SIZE');
 const report=JSON.parse(await readFile(reportFile,'utf8'));const review=JSON.parse(await readFile(reviewFile,'utf8'));const {default:live}=await import('./live-smoke.cjs');if(await live.harnessDigest()!==report.harnessDigest)throw Error('REVIEW_HARNESS');const cleanup=JSON.parse(await readFile(await safePath(privateDir,'review-server-cleanup.json'),'utf8'));if(cleanup.runId!==report.runId||cleanup.cleanup!=='passed'||cleanup.noModelConfiguration!==true)throw Error('REVIEW_CLEANUP');const accepted=await validateReview(report,review,privateDir);const exported=await safePath(runDirectory,'export');if(!(await lstat(exported)).isDirectory())throw Error('REVIEW_EVIDENCE');await atomicJson(reportFile,accepted);await atomicJson(path.join(exported,'summary.json'),summary(accepted));await writeFile(path.join(exported,'summary.md'),`# Top 1 最终验收\n\nRun: ${accepted.runId}\n\n自动化、两例业务、真实浏览器视觉复核与清理全部通过。\n\nRelease: ${accepted.releaseId}\n\nDigest: ${accepted.releaseDigest}\n\n范围仅限本轮 studio/schedule，本地 HTTP；公网/远端部署/hosted CI 未运行。\n`,{mode:0o600});return summary(accepted);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);if(args.length===1&&args[0]==='--help')console.log('Usage: pnpm review:live --run /absolute/live-generation/run\nMerge an actual private/manual-review.json; never performs model calls.');else if(args.length===2&&args[0]==='--run'&&path.isAbsolute(args[1])){try{const result=await mergeReview(args[1]);console.log(JSON.stringify(result));}catch{console.error('REVIEW_REJECTED');process.exitCode=1;}}else{console.error('INVALID_ARGUMENTS');process.exitCode=2;}
}
