import { mkdir, readFile, cp, rename, rm, lstat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireRunLock, assertInputs, atomicJson, buildIdentity, cleanEnvironment, copyInputs, sha256 } from './verification/input.mjs';
import processes from './verification/processes.cjs';
import {privateDirectory} from './release/paths.mjs';
import { nativeProbe, sqliteProbe, sealRelease, validateRelease } from './release/artifact.mjs';
const exec = promisify(execFile);
const REASONS=new Set(['TOOLCHAIN','OFFLINE_INSTALL','NATIVE_BINDING','VERIFY_BUSY','OUTPUT_EXISTS','UNSAFE_INPUT','STALE_INPUT','UNSAFE_LOCK','BUILD_FAILED','DEPLOY_FAILED','SIGNAL','CLEANUP_INCOMPLETE','UNSAFE_RELEASE','RELEASE_LAYOUT','MISSING_ASSET','RELEASE_MANIFEST','RELEASE_PLATFORM','RELEASE_CHANGED','UNSAFE_PATH','RELEASE_DEV_DEPENDENCY']);
const ROOT = fileURLToPath(new URL('../',import.meta.url));
export const releaseInput = name => name !== 'README.md' && !name.startsWith('.github/');
export function parseReleaseArgs(args) {
  if (args.length===1 && ['--help','-h'].includes(args[0])) return {help:true};
  if (!args.length || args.length===1 && args[0]==='--json') return {json:args.length===1};
  throw Error('INVALID_ARGUMENTS');
}
export async function requireNewDirectory(directory) {
  try { await lstat(directory); } catch(error) { if(error.code==='ENOENT')return; throw error; } throw Error('OUTPUT_EXISTS');
}
export async function buildRelease(root, json = false) {
  const releaseId=randomUUID(); const base=path.join(root,'.runtime/releases'); const destination=path.join(base,releaseId);
  const work=path.join(root,'.runtime/release-build',releaseId); const source=path.join(work,'source'); const stage=path.join(work,'package');
  let workReady=false; let unlock; let interrupted; const abort=new AbortController(); const start=Date.now(); const steps=[]; let snapshot; let artifact;
  const handlers=['SIGINT','SIGTERM'].map(signal=>{const fn=()=>{interrupted=signal;abort.abort();};process.once(signal,fn);return[signal,fn];});
  const result={schemaVersion:1,releaseId,status:'running',reason:null,evidenceKind:'release-build',cleanup:'not-run',completeBuilds:0};
  const run=async(id,args,cwd=source)=>{
    if(abort.signal.aborted)throw Error('SIGNAL');
    if(!json)console.log(`[release] ${id}…`);
    const outcome=await processes.runCommand({command:args[0],args:args.slice(1),cwd,env:cleanEnvironment(),signal:abort.signal,timeoutMs:Math.min(180_000,600_000-(Date.now()-start)),log:path.join(work,id+'.log')});
    steps.push({id,...outcome});
    if(outcome.status!=='passed')throw Error(outcome.cleanup==='failed'?'CLEANUP_INCOMPLETE':outcome.status==='cancelled'?'SIGNAL':id==='install'?'OFFLINE_INSTALL':id==='native'?'NATIVE_BINDING':id==='build'?'BUILD_FAILED':'DEPLOY_FAILED');
  };
  try {
    await privateDirectory(root,['.runtime','release-build',releaseId]);workReady=true;unlock=await acquireRunLock(root,()=>abort.abort());await privateDirectory(root,['.runtime','releases']);
    const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
    if(process.version!=='v'+(await readFile(path.join(root,'.nvmrc'),'utf8')).trim() || 'pnpm@'+(await exec('pnpm',['--version'],{cwd:root,env:cleanEnvironment(),timeout:5000})).stdout.trim()!==pkg.packageManager)throw Error('TOOLCHAIN');
    await requireNewDirectory(destination); snapshot=await copyInputs(root,source,{select:releaseInput});
    await run('install',['pnpm','install','--offline','--frozen-lockfile']);
    await run('native',['pnpm','--filter','@atoms/backend','exec','node','--input-type=module','-e',sqliteProbe,path.join(work,'native.sqlite')]);
    await assertInputs(root,source,snapshot,{select:releaseInput}); await run('build',['pnpm','build']); result.completeBuilds++;
    const built=await buildIdentity(source); await mkdir(stage,{mode:0o700});
    await run('deploy',['pnpm','--filter','@atoms/backend','deploy','--prod','--frozen-lockfile',path.join(stage,'backend')]);
    await cp(path.join(source,'frontend/dist'),path.join(stage,'frontend'),{recursive:true});
    await mkdir(path.join(stage,'deploy')); await cp(path.join(source,'deploy/nginx.conf.template'),path.join(stage,'deploy/nginx.conf.template'));
    artifact=await sealRelease(stage,{releaseId,sourceDigest:snapshot.digest,lockDigest:sha256(await readFile(path.join(source,'pnpm-lock.yaml'))),buildDigest:built.digest,pnpm:pkg.packageManager});
    await validateRelease(stage);
    await run('relocated-native',[process.execPath,'--input-type=module','-e',nativeProbe,path.join(work,'relocated.sqlite')],path.join(stage,'backend'));
    await assertInputs(root,source,snapshot,{select:releaseInput}); await rm(source,{recursive:true});
    await mkdir(base,{recursive:true,mode:0o700}); if((await lstat(base)).isSymbolicLink())throw Error('UNSAFE_PATH');
    await requireNewDirectory(destination); await rename(stage,destination); result.status='passed';
  } catch(error) { result.status=interrupted?'cancelled':['TOOLCHAIN','OFFLINE_INSTALL','NATIVE_BINDING','VERIFY_BUSY'].includes(error.message)?'blocked':'failed'; result.reason=REASONS.has(error.message)?error.message:'RELEASE_FAILED'; }
  finally {
    try{await unlock?.();result.cleanup=steps.some(step=>step.cleanup==='failed')?'failed':'passed';}catch{result.cleanup='failed';}
    for(const[signal,fn]of handlers)process.removeListener(signal,fn);
    if(result.cleanup==='failed'){result.status='failed';result.reason='CLEANUP_INCOMPLETE';}
    result.durationMs=Date.now()-start;result.steps=steps; result.sourceDigest=snapshot?.digest??null; result.releaseDigest=artifact?.releaseDigest??null;
    if(workReady)await atomicJson(path.join(work,'report.json'),result);
  }
  if(json)console.log(JSON.stringify({...result,...(result.status==='passed'?{directory:destination}:{})}));
  else console.log(`${result.status}${result.reason?' ('+result.reason+')':''}: ${result.status==='passed'?path.relative(root,destination):workReady?path.relative(root,work+'/report.json'):'no private diagnostic directory created'}`);
  return interrupted==='SIGINT'?130:interrupted?143:result.status==='passed'?0:result.status==='blocked'?2:1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{const args=parseReleaseArgs(process.argv.slice(2));if(args.help)console.log('Usage: pnpm release:build [--json]\nOne isolated offline frozen install/build; same platform/Node ABI only. Output: .runtime/releases/<UUID>.');else process.exitCode=await buildRelease(ROOT,args.json);}catch{console.error('INVALID_ARGUMENTS');process.exitCode=2;}
}
