import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,chmod,cp} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {parseReleaseArgs,requireNewDirectory,buildRelease} from './release.mjs';
import {sealRelease,validateRelease,inventory} from './release/artifact.mjs';
import {renderNginx,nginxPath,findNginx} from './release/nginx.mjs';
import {allowedInput,copyInputs,assertInputs,cleanEnvironment,freePorts,sha256,acquireRunLock} from './verification/input.mjs';
import processes from './verification/processes.cjs';
import deployment from './deployment-smoke.cjs';
const exec=promisify(execFile);const root=path.resolve(import.meta.dirname,'..');
async function temp(work){const folder=await mkdtemp(path.join(os.tmpdir(),'atoms release control '));try{return await work(folder);}finally{await rm(folder,{recursive:true,force:true});}}
async function file(folder,name,value='control'){const target=path.join(folder,name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,value);}
async function fixture(folder){
  await file(folder,'backend/package.json',JSON.stringify({name:'@atoms/backend',type:'module'}));
  for(const name of ['backend/dist/server.js','backend/dist/app.js','backend/node_modules/.pnpm/contracts/dist/index.js','frontend/index.html','deploy/nginx.conf.template'])await file(folder,name);
  await mkdir(path.join(folder,'backend/node_modules/@atoms'),{recursive:true});await symlink('../.pnpm/contracts',path.join(folder,'backend/node_modules/@atoms/contracts'));
  const bundle=JSON.stringify({id:'company-landing',version:1,digest:'1'.repeat(64),files:{'/LICENSE':'MIT'}});
  await file(folder,'backend/dist/template-assets/company-landing.bundle.json',bundle);await file(folder,'frontend/template-assets/company-landing.bundle.json',bundle);
  return sealRelease(folder,{releaseId:randomUUID(),sourceDigest:'2'.repeat(64),lockDigest:'3'.repeat(64),buildDigest:'4'.repeat(64),pnpm:'pnpm@12.11.2'});
}
test('fixed release/deployment CLI: help and malformed arguments never build or start',async()=>{
  assert.deepEqual(parseReleaseArgs([]),{json:false});assert.deepEqual(parseReleaseArgs(['--json']),{json:true});assert.equal(parseReleaseArgs(['--help']).help,true);
  for(const args of [['--output','/tmp/x'],['--json','--json'],['--live']])assert.throws(()=>parseReleaseArgs(args));
  assert.equal(deployment.parseDeploymentArgs([]).help,true);assert.equal(deployment.parseDeploymentArgs(['--release','/tmp/control']).release,'/tmp/control');
  for(const args of [['--release','relative'],['--live'],['--release','/tmp/x','--build']])assert.throws(()=>deployment.parseDeploymentArgs(args));
  for(const script of ['release.mjs','deployment-smoke.cjs']){const output=await exec(process.execPath,[path.join(root,'scripts',script),'--help'],{env:cleanEnvironment(),timeout:5000});assert.match(output.stdout,/Usage:/);await assert.rejects(exec(process.execPath,[path.join(root,'scripts',script),'--live'],{env:cleanEnvironment(),timeout:5000}),error=>error.code===2);}
});
test('release seal detects changed bytes, file modes, missing assets, manifest edits and wrong ABI',()=>temp(async folder=>{
  const identity=await fixture(folder);assert.equal((await validateRelease(folder)).releaseDigest,identity.releaseDigest);
  await assert.rejects(validateRelease(folder,{platform:'other'}),/RELEASE_PLATFORM/);await assert.rejects(validateRelease(folder,{modulesABI:'0'}),/RELEASE_PLATFORM/);
  const app=path.join(folder,'backend/dist/app.js');await writeFile(app,'modified');await assert.rejects(validateRelease(folder),/RELEASE_CHANGED/);await writeFile(app,'control');
  await chmod(app,0o755);await assert.rejects(validateRelease(folder),/RELEASE_CHANGED/);await chmod(app,0o644);
  const json=path.join(folder,'release.json');const text=await readFile(json,'utf8');await writeFile(json,text.replace('company-landing','tampered'));await assert.rejects(validateRelease(folder),/RELEASE_MANIFEST/);await writeFile(json,text);
  await rm(path.join(folder,'frontend/index.html'));await assert.rejects(validateRelease(folder),/RELEASE_CHANGED/);
}));
test('release refuses external/dangling links, secrets, self source/dev dependencies and partial packages',()=>temp(async folder=>{
  await fixture(folder);await symlink(os.tmpdir(),path.join(folder,'outside'));await assert.rejects(inventory(folder),/UNSAFE_RELEASE/);await rm(path.join(folder,'outside'));
  for(const name of ['backend/.env','backend/src/private.ts','backend/node_modules/tsx/index.js']){await file(folder,name,'SECRET_SENTINEL');await rm(path.join(folder,'release.json'));await assert.rejects(sealRelease(folder,{releaseId:randomUUID()}));await rm(path.join(folder,name));if(name.includes('node_modules/tsx/'))await rm(path.join(folder,'backend/node_modules/tsx'),{recursive:true});if(name.includes('/src/'))await rm(path.join(folder,'backend/src'),{recursive:true});await sealRelease(folder,{releaseId:randomUUID()});}
}));
test('moving sealed package preserves identity and existing output is never overwritten',()=>temp(async folder=>{
  const source=path.join(folder,'source');await mkdir(source);const identity=await fixture(source);const moved=path.join(folder,'moved release');await cp(source,moved,{recursive:true,verbatimSymlinks:true});await rm(source,{recursive:true});assert.equal((await validateRelease(moved)).releaseDigest,identity.releaseDigest);await assert.rejects(requireNewDirectory(moved),/OUTPUT_EXISTS/);await requireNewDirectory(path.join(folder,'new'));
}));
test('release input copies only the concrete nginx template, rejects escaping links and source mutation',()=>temp(async folder=>{
  await exec('git',['init','-q'],{cwd:folder});await file(folder,'package.json','{}');await file(folder,'deploy/nginx.conf.template','local nginx');await file(folder,'deploy/private.env','SECRET_SENTINEL');await file(folder,'backend/.env','SECRET_SENTINEL');await file(folder,'data/live.sqlite','secret');
  assert.equal(allowedInput('deploy/nginx.conf.template'),true);assert.equal(allowedInput('deploy/private.env'),false);
  const copy=path.join(folder,'copy');const snapshot=await copyInputs(folder,copy);assert.equal(snapshot.entries.length,2);await assertInputs(folder,copy,snapshot);await file(copy,'deploy/nginx.conf.template','changed');await assert.rejects(assertInputs(folder,copy,snapshot),/STALE_INPUT/);
  await symlink('/etc/passwd',path.join(folder,'backend/escape.ts'));await assert.rejects(copyInputs(folder,path.join(folder,'badcopy')),/UNSAFE_INPUT/);
}));
test('Nginx path rendering quotes complete paths with spaces and rejects injection',()=>temp(async folder=>{
  const template=path.join(root,'deploy/nginx.conf.template');const text=await renderNginx(template,path.join(folder,'nginx prefix'),path.join(folder,'static files'));
  assert.ok(text.includes('"'+path.join(folder,'nginx prefix/nginx.pid')+'";'));assert.ok(!text.includes('{{'));assert.match(text,/proxy_buffering off/);assert.match(text,/proxy_pass http:\/\/127.0.0.1:3001;/);
  for(const value of ['/tmp/x\nerror_log /tmp/bad','/tmp/$prefix','/tmp/"bad','relative','/tmp/a;pid x'])assert.throws(()=>nginxPath(value),/NGINX_PATH/);
  await assert.rejects(findNginx({PATH:'/nonexistent'}),/MISSING_NGINX/);await assert.rejects(findNginx({NGINX_BIN:'relative'}),/MISSING_NGINX/);
}));
test('deployment export projects safe fields, preserves not-run boundaries and rejects empty/stale/mismatched evidence',()=>{
  const value={runId:randomUUID(),releaseId:randomUUID(),releaseDigest:'a'.repeat(64),sourceDigest:'b'.repeat(64),buildDigest:'c'.repeat(64),status:'passed',cleanup:'passed',reason:null,nginx:'nginx/1.30.6',configDigest:'d'.repeat(64),durationMs:100,fixtureModelRequests:3,cookie:'SECRET_SENTINEL',prompt:'SECRET_SENTINEL',cases:deployment.REQUIRED.map(id=>({id,phase:deployment.expectedPhase(id),source:deployment.expectedSource(id),status:'passed',durationMs:1,raw:'SECRET_SENTINEL'}))};
  assert.ok(!JSON.stringify(deployment.publicReport({...value,reason:'SECRET_SENTINEL',nginx:'SECRET_SENTINEL',cases:[...value.cases,{id:'SECRET_SENTINEL',source:'SECRET_SENTINEL'}]})).includes('SECRET_SENTINEL'));
  const output=deployment.publicReport(value);assert.ok(!JSON.stringify(output).includes('SECRET_SENTINEL'));assert.equal(output.realModel,'not-run');assert.equal(output.publicHTTPS,'not-run');assert.equal(output.hostedCI,'not-run');deployment.validateDeploymentReport(output,value);
  for(const modified of [{...output,cases:[]},{...output,runId:randomUUID()},{...output,releaseDigest:'e'.repeat(64)},{...output,cleanup:'failed'},{...output,realModel:'passed'},{...output,cases:output.cases.map((item,i)=>i?item:{...item,status:'not-run'})}])assert.throws(()=>deployment.validateDeploymentReport(modified,value),/REPORT_IDENTITY/);
});
test('mutex refuses concurrent deployment and occupied ports retain unknown listeners',()=>temp(async folder=>{
  const release=await acquireRunLock(folder);try{await assert.rejects(acquireRunLock(folder),/VERIFY_BUSY/);}finally{await release();}
  const net=await import('node:net');const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));try{await assert.rejects(freePorts([server.address().port]),/PORT_BUSY/);assert.equal(server.listening,true);}finally{await new Promise(resolve=>server.close(resolve));}
}));
test('owned lifecycle timeout and abort return nonzero, clean children and leave unrelated process alone',async()=>{
  const {spawn}=await import('node:child_process');const unknown=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
  try{
    const timed=await processes.runCommand({command:process.execPath,args:['-e','setInterval(()=>{},1000)'],env:cleanEnvironment(),timeoutMs:150});assert.equal(timed.reason,'TIMEOUT');assert.equal(timed.status,'failed');assert.equal(timed.cleanup,'passed');process.kill(unknown.pid,0);
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),150);try{const outcome=await processes.runCommand({command:process.execPath,args:['-e','setInterval(()=>{},1000)'],env:cleanEnvironment(),timeoutMs:5000,signal:controller.signal});assert.equal(outcome.status,'cancelled');assert.equal(outcome.cleanup,'passed');}finally{clearTimeout(timer);}
  }finally{unknown.kill('SIGTERM');await new Promise(resolve=>unknown.once('exit',resolve));}
});
test('a missing SQLite binding and failed build remain control-test failures',async()=>{
  const missing=await processes.runCommand({command:process.execPath,args:['--input-type=module','-e',"await import('definitely-missing-native-control-fixture')"],cwd:os.tmpdir(),env:cleanEnvironment(),timeoutMs:5000});assert.equal(missing.status,'failed');assert.equal(missing.exitCode,1);assert.equal(missing.cleanup,'passed');
  const build=await processes.runCommand({command:process.execPath,args:['-e','process.exit(9)'],env:cleanEnvironment(),timeoutMs:5000});assert.equal(build.status,'failed');assert.equal(build.exitCode,9);
  const require=createRequire(import.meta.url);assert.ok(require.resolve('playwright-core'));assert.equal(sha256('fixed control').length,64);
});

for(const native of [true,false])test(`actual isolated release pipeline ${native?'build failure':'missing native prerequisite'} never publishes a package`,()=>temp(async folder=>{
  await file(folder,'.nvmrc',process.version.slice(1));
  await file(folder,'package.json',JSON.stringify({name:'release-control-fixture',private:true,packageManager:'pnpm@12.11.2',scripts:{build:'node -e "process.exit(7)"'}}));
  await file(folder,'pnpm-workspace.yaml','packages:\n  - backend\nengineStrict: true\n');
  await file(folder,'backend/package.json',JSON.stringify({name:'@atoms/backend',private:true,type:'module',dependencies:native?{'better-sqlite3':'13.0.3'}:{}}));
  // Keep the pinned toolchain and package resolutions without resolving a new offline project.
  const lock=await readFile(path.join(root,'pnpm-lock.yaml'),'utf8');
  const importers=`\nimporters:\n\n  .: {}\n\n  backend:${native?"\n    dependencies:\n      better-sqlite3:\n        specifier: 13.0.3\n        version: 13.0.3":" {}"}\n`;
  const boundary=lock.indexOf('\n---\n');assert.ok(boundary>=0);
  const applicationLock=lock.slice(boundary);const packagesAt=applicationLock.indexOf('\npackages:\n'),snapshotsAt=applicationLock.indexOf('\nsnapshots:\n');
  assert.ok(packagesAt>=0&&snapshotsAt>packagesAt);
  const select=section=>section.split(/(?=^ {2}\S)/m).filter(block=>/^ {2}(?:better-sqlite3@13\.0\.3|node-addon-api@[^:]+):/m.test(block)).join('');
  const packages=native?select(applicationLock.slice(packagesAt+'\npackages:\n'.length,snapshotsAt)):'';
  const snapshots=native?select(applicationLock.slice(snapshotsAt+'\nsnapshots:\n'.length)):'';
  const application=applicationLock.slice(0,packagesAt).replace(/\nimporters:\n[\s\S]*$/,importers)+
    (native?`\npackages:\n\n${packages}\nsnapshots:\n\n${snapshots}`:'\npackages: {}\n\nsnapshots: {}\n');
  await file(folder,'pnpm-lock.yaml',lock.slice(0,boundary)+application);
  await exec('git',['init','-q'],{cwd:folder});
  assert.equal(await buildRelease(folder,true),native?1:2);
  const{readdir}=await import('node:fs/promises');const ids=await readdir(path.join(folder,'.runtime/release-build'));assert.equal(ids.length,1);
  const report=JSON.parse(await readFile(path.join(folder,'.runtime/release-build',ids[0],'report.json'),'utf8'));
  assert.equal(report.reason,native?'BUILD_FAILED':'NATIVE_BINDING');assert.equal(report.status,native?'failed':'blocked');assert.equal(report.completeBuilds,0);assert.equal(report.cleanup,'passed');
  assert.ok(report.steps.some(step=>step.id==='native'&&step.status===(native?'passed':'failed')));
  assert.deepEqual(await readdir(path.join(folder,'.runtime/releases')).catch(()=>[]),[]);
}));

test('missing Chrome is a blocked prerequisite without publishing fake browser evidence',async()=>{let calls=0;await assert.rejects(deployment.launchChrome(async()=>{calls++;throw Error('private launch details');}),/MISSING_CHROME/);assert.equal(calls,1);});

test('a healthy foreign service cannot satisfy readiness for the owned backend',()=>temp(async folder=>{
  const{createServer}=await import('node:http');const {runtime}=await import('./release/runtime.cjs');const owned=runtime();const server=createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({status:'ok',service:'atoms-backend'}));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{const child=await owned.launch(process.execPath,['-e','setInterval(()=>{},1000)'],folder,cleanEnvironment(),path.join(folder,'child.log'));await assert.rejects(owned.ready(`http://127.0.0.1:${server.address().port}/api/health`,child),/PORT_OWNER_CHANGED/);assert.equal(server.listening,true);}finally{await owned.close();await new Promise(resolve=>server.close(resolve));}
}));

test('runtime and evidence parents reject existing symlinks without writing outside',()=>temp(async folder=>{
  const{privateDirectory}=await import('./release/paths.mjs');const outside=path.join(folder,'outside');await mkdir(outside);await symlink(outside,path.join(folder,'test-results'));
  await assert.rejects(privateDirectory(folder,['test-results','deployment','new-run']),/UNSAFE_PATH/);const{readdir}=await import('node:fs/promises');assert.deepEqual(await readdir(outside),[]);await assert.rejects(privateDirectory(folder,['..','escape']),/UNSAFE_PATH/);
}));

test('a busy release build preserves its own safe blocked report without taking ownership',()=>temp(async folder=>{
  const unlock=await acquireRunLock(folder);try{assert.equal(await buildRelease(folder,true),2);const{readdir}=await import('node:fs/promises');const ids=await readdir(path.join(folder,'.runtime/release-build'));assert.equal(ids.length,1);const report=JSON.parse(await readFile(path.join(folder,'.runtime/release-build',ids[0],'report.json'),'utf8'));assert.equal(report.reason,'VERIFY_BUSY');assert.equal(report.status,'blocked');assert.equal(report.cleanup,'passed');assert.equal(report.completeBuilds,0);}finally{await unlock();}
}));
