// Explicit integration controls; run separately with a real release and Nginx, never default CI.
import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {spawn} from 'node:child_process';
import {readFile,readdir,mkdir,writeFile,mkdtemp,cp,rm} from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {cleanEnvironment,freePorts,acquireRunLock} from './verification/input.mjs';
import {validateRelease} from './release/artifact.mjs';
const root=path.resolve(import.meta.dirname,'..');const release=process.env.ATOMS_DEPLOYMENT_TEST_RELEASE;
if(!release||!path.isAbsolute(release))throw Error('ATOMS_DEPLOYMENT_TEST_RELEASE must identify a real immutable package');
const before=await validateRelease(release);const reports=path.join(root,'test-results/deployment');
const observed=[];
after(async()=>{await mkdir(path.join(root,'test-results/gen-009'),{recursive:true,mode:0o700});await writeFile(path.join(root,'test-results/gen-009/deployment-controls.json'),JSON.stringify({schemaVersion:1,evidenceKind:'control-test',releaseId:before.releaseId,releaseDigest:before.releaseDigest,runs:observed},null,2)+'\n',{mode:0o600});});
async function launch(env={},signalAtReady,packagePath=release){
  const old=new Set(await readdir(reports).catch(()=>[]));
  const child=spawn(process.execPath,['scripts/deployment-smoke.cjs','--release',packagePath],{cwd:root,env:{...cleanEnvironment(),NGINX_BIN:process.env.NGINX_BIN,...env},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.resume();const ended=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  let timer;const timed=new Promise((_,reject)=>{timer=setTimeout(()=>{child.kill('SIGTERM');reject(Error('CONTROL_TIMEOUT'));},45_000);});
  let directory;let signalled=false;
  try{
    if(signalAtReady){const deadline=Date.now()+25_000;while(Date.now()<deadline){if(output.includes('[deployment] nginx: passed')){child.kill(signalAtReady);signalled=true;break;}if(child.exitCode!==null)break;await delay(50);}assert.equal(signalled,true,'Actual owned Nginx/backend must be running before interruption');}
    const exit=await Promise.race([ended,timed]);const added=(await readdir(reports)).filter(name=>!old.has(name));assert.equal(added.length,1);directory=path.join(reports,added[0]);const report=JSON.parse(await readFile(path.join(directory,'export/summary.json'),'utf8'));observed.push({runId:report.runId,exitCode:exit.code,status:report.status,reason:report.reason,cleanup:report.cleanup});return{exit,report};
  }finally{clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await ended;}}
}
test('missing Nginx produces a blocked nonzero report without starting application',async()=>{const{exit,report}=await launch({NGINX_BIN:'/nonexistent/atoms-nginx'});assert.equal(exit.code,2);assert.equal(report.status,'blocked');assert.equal(report.reason,'MISSING_NGINX');assert.equal(report.cleanup,'passed');assert.ok(report.cases.every(item=>item.status==='not-run'));});
test('external listener survives real deployment port preflight',async()=>{const server=net.createServer();await new Promise(resolve=>server.listen(8080,'127.0.0.1',resolve));try{const{exit,report}=await launch();assert.equal(exit.code,2);assert.equal(report.reason,'PORT_BUSY');assert.equal(server.listening,true);}finally{await new Promise(resolve=>server.close(resolve));}});
test('an existing verification owner is never taken over',async()=>{const unlock=await acquireRunLock(root);try{const{exit,report}=await launch();assert.equal(exit.code,2);assert.equal(report.reason,'VERIFY_BUSY');}finally{await unlock();}});
for(const signal of ['SIGINT','SIGTERM'])test(`real ${signal} after owned Nginx/backend startup reports cancellation and frees ports`,async()=>{const start=Date.now();const{exit,report}=await launch({},signal);assert.equal(exit.code,signal==='SIGINT'?130:143);assert.equal(report.status,'cancelled');assert.equal(report.cleanup,'passed');assert.ok(Date.now()-start<35_000);await freePorts([3001,8080]);});
test('tampered real package fails before application startup',async()=>{const folder=await mkdtemp(path.join(os.tmpdir(),'atoms deployment malformed '));try{const candidate=path.join(folder,'package');await cp(release,candidate,{recursive:true,verbatimSymlinks:true});await rm(path.join(candidate,'frontend/index.html'));const{exit,report}=await launch({},undefined,candidate);assert.equal(exit.code,1);assert.equal(report.reason,'RELEASE_CHANGED');assert.equal(report.cleanup,'passed');assert.ok(report.cases.every(item=>item.status!=='passed'));await freePorts([3001,8080]);}finally{await rm(folder,{recursive:true,force:true});}});
test('control runs keep exact original package identity',async()=>{assert.equal((await validateRelease(release)).releaseDigest,before.releaseDigest);});
