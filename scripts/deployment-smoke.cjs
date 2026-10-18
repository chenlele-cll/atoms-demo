/* global window */
const assert=require('node:assert/strict');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {cp,mkdir,readFile,writeFile,chmod,lstat}=require('node:fs/promises');
const {createRequire}=require('node:module');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {setTimeout:delay}=require('node:timers/promises');
const {chromium}=require('playwright-core');
const {closeBrowser,runCommand}=require('./verification/processes.cjs');
const {runtime}=require('./release/runtime.cjs');
const {api,waitCompiled,taskFinished,createViaForm,assertQuote}=require('./verification/workspace-path.cjs');
const exec=promisify(execFile);const root=path.resolve(__dirname,'..');const ORIGIN='http://127.0.0.1:8080';
const REASONS=new Set(['MISSING_NGINX','MISSING_CHROME','PORT_BUSY','VERIFY_BUSY','PORT_OWNER_CHANGED','HEALTH_BODY','STARTUP_FAILED','READINESS_TIMEOUT','RELEASE_PLATFORM','RELEASE_MANIFEST','RELEASE_CHANGED','RELEASE_LAYOUT','UNSAFE_RELEASE','MISSING_ASSET','RELEASE_DEV_DEPENDENCY','NGINX_PATH','SIGNAL','TIMEOUT','REPORT_IDENTITY','CLEANUP_INCOMPLETE','ASSERTION_FAILED','UNSAFE_PATH']);
const REQUIRED=['artifact','nginx','routing','production-template','origin-ownership','production-restart','fixture-generation','proxy-heartbeat-complete','proxy-cancel','proxy-disconnect','graceful-shutdown','crash-recovery','production-reopen','cold-backup-restore','startup-failures','final-integrity'];
function parseDeploymentArgs(args){if(!args.length||args.length===1&&['--help','-h'].includes(args[0]))return{help:true};if(args.length!==2||args[0]!=='--release'||!path.isAbsolute(args[1]))throw Error('INVALID_ARGUMENTS');return{release:args[1]};}
function publicReport(value){
  const hash=value=>/^[a-f0-9]{64}$/.test(value??'')?value:null;
  const uuid=value=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value??'')?value:null;
  const select=(value,allowed)=>allowed.includes(value)?value:null;
  return{schemaVersion:1,runId:uuid(value.runId),releaseId:uuid(value.releaseId),releaseDigest:hash(value.releaseDigest),sourceDigest:hash(value.sourceDigest),buildDigest:hash(value.buildDigest),evidenceKind:'deployment-regression',status:select(value.status,['running','passed','failed','blocked','cancelled']),reason:REASONS.has(value.reason)?value.reason:null,cleanup:select(value.cleanup,['passed','failed','not-run']),platform:`${process.platform}/${process.arch}`,node:process.version,nginx:/^nginx\/\d+\.\d+\.\d+$/.test(value.nginx??'')?value.nginx:null,configDigest:hash(value.configDigest),origin:ORIGIN,durationMs:Number.isFinite(value.durationMs)?value.durationMs:null,realModel:'not-run',publicHTTPS:'not-run',hostedCI:'not-run',fixtureModelRequests:Number.isInteger(value.fixtureModelRequests)?value.fixtureModelRequests:0,cases:value.cases.filter(item=>REQUIRED.includes(item.id)).map(item=>({id:item.id,phase:select(item.phase,['artifact','A','B','C','not-run']),source:select(item.source,['production','fixture','artifact']),status:select(item.status,['passed','failed','not-run']),durationMs:Number.isFinite(item.durationMs)?item.durationMs:null}))};
}
const expectedSource=id=>['artifact','nginx','final-integrity'].includes(id)?'artifact':id.startsWith('fixture-')||id.startsWith('proxy-')||['graceful-shutdown','crash-recovery'].includes(id)?'fixture':'production';
const expectedPhase=id=>['artifact','nginx'].includes(id)?'artifact':['production-reopen','cold-backup-restore','startup-failures','final-integrity'].includes(id)?'C':expectedSource(id)==='fixture'?'B':'A';
function validateDeploymentReport(value,expected){
  const hash=/^[a-f0-9]{64}$/;
  if(value.schemaVersion!==1||value.runId!==expected.runId||value.releaseDigest!==expected.releaseDigest||value.releaseId!==expected.releaseId||value.sourceDigest!==expected.sourceDigest||value.buildDigest!==expected.buildDigest||!hash.test(value.releaseDigest)||!hash.test(value.sourceDigest)||!hash.test(value.buildDigest)||!hash.test(value.configDigest)||!/^nginx\/\d+\.\d+\.\d+$/.test(value.nginx)||value.origin!==ORIGIN||value.evidenceKind!=='deployment-regression'||value.status!=='passed'||value.cleanup!=='passed'||value.realModel!=='not-run'||value.publicHTTPS!=='not-run'||value.hostedCI!=='not-run'||!Number.isFinite(value.durationMs)||value.durationMs<=0||!Number.isInteger(value.fixtureModelRequests)||value.fixtureModelRequests<3||!Array.isArray(value.cases)||value.cases.length!==REQUIRED.length||new Set(value.cases.map(item=>item.id)).size!==REQUIRED.length||REQUIRED.some(id=>!value.cases.some(item=>item.id===id&&item.status==='passed'&&item.source===expectedSource(id)&&item.phase===expectedPhase(id)&&Number.isFinite(item.durationMs)&&item.durationMs>=0)))throw Error('REPORT_IDENTITY');return value;
}
async function launchChrome(launch=options=>chromium.launch(options)){try{return await launch({channel:'chrome',headless:true,handleSIGINT:false,handleSIGTERM:false,timeout:10_000});}catch{throw Error('MISSING_CHROME');}}
async function smoke(releasePath){
  const {validateRelease,nativeProbe}=await import('./release/artifact.mjs');
  const {renderNginx,findNginx}=await import('./release/nginx.mjs');
  const {acquireRunLock,atomicJson,cleanEnvironment,freePorts,sha256}=await import('./verification/input.mjs');
  const runId=randomUUID();const output=path.join(root,'test-results/deployment',runId);const privateDir=path.join(output,'private');const exportDir=path.join(output,'export');
  const {privateDirectory}=await import('./release/paths.mjs');await privateDirectory(root,['test-results','deployment',runId,'private']);await privateDirectory(root,['test-results','deployment',runId,'export']);
  const report={runId,status:'running',reason:null,cleanup:'not-run',cases:[],fixtureModelRequests:0,nginx:null,configDigest:null};
  let browser;let provider;let unlock;let interrupted;let timedOut=false;let backend;let release;let database;let serverEnv;let launcher;let phase='artifact';let sequence=0;
  const cancellation=new AbortController();const request=(url,options={})=>fetch(url,{...options,signal:AbortSignal.any([cancellation.signal,AbortSignal.timeout(5000)])});
  const started=Date.now();const check=()=>{if(interrupted)throw Error('SIGNAL');if(timedOut)throw Error('TIMEOUT');};const owned=runtime(check);
  const abort=()=>{cancellation.abort();if(browser)void browser.close().catch(()=>{});};
  const handlers=['SIGINT','SIGTERM'].map(signal=>{const fn=()=>{interrupted=signal;abort();};process.once(signal,fn);return[signal,fn];});
  const timer=setTimeout(()=>{timedOut=true;abort();},600_000);
  const publish=async()=>{report.durationMs=Date.now()-started;report.fixtureModelRequests=provider?.state.requests??0;await atomicJson(path.join(exportDir,'summary.json'),publicReport(report));};
  async function scenario(id,source,work){check();const start=Date.now();try{await work();report.cases.push({id,phase,source,status:'passed',durationMs:Date.now()-start});console.log(`[deployment] ${id}: passed`);}catch(error){report.cases.push({id,phase,source,status:'failed',durationMs:Date.now()-start});await writeFile(path.join(privateDir,id+'-error.log'),String(error.stack),{mode:0o600});throw error;}await publish();}
  const launchBackend=async(fixture=false,db=database,extra={})=>{
    const args=fixture?[launcher,path.join(release,'backend/dist'),db,'3001',provider.origin]:[path.join(release,'backend/dist/server.js')];
    const child=await owned.launch(process.execPath,args,path.join(release,'backend'),{...serverEnv,DATABASE_PATH:db,...extra},path.join(privateDir,`backend-${++sequence}.log`));return child;
  };
  const startBackend=async(fixture=false,db=database)=>{backend=await launchBackend(fixture,db);await owned.ready('http://127.0.0.1:3001/api/health',backend);};
  let context;let page;let projectId;let current;let generatedProject;let adopted;
  async function detail(id=projectId){const response=await api(page,'GET',`/api/projects/${id}`);assert.equal(response.status,200);return response.body;}
  async function poll(query,status){const deadline=Date.now()+15_000;let result;do{check();const response=await api(page,'GET',query);if(response.status===200){result=response.body;if(result.status===status)return result;}await delay(100);}while(Date.now()<deadline);assert.equal(result?.status,status);}
  async function stream(){
    const base=await detail();const requestId=randomUUID();const query=`/api/projects/${projectId}/generations/by-request/${requestId}`;
    await page.evaluate(async({id,baseVersionId,requestId})=>{
      const controller=new AbortController();window.deploymentStream={controller,text:'',events:[],heartbeats:0,done:false,error:null};const state=window.deploymentStream;
      const response=await fetch(`/api/projects/${id}/generations`,{method:'POST',signal:controller.signal,headers:{'content-type':'application/json',accept:'text/event-stream'},body:JSON.stringify({requestId,baseVersionId,prompt:'本地部署代理流测试，保留企业官网并添加报价。'})});
      if(response.status!==200)throw Error('SSE status '+response.status);const reader=response.body.getReader();const decoder=new TextDecoder();let pending='';
      state.promise=(async()=>{try{for(;;){const chunk=await reader.read();if(chunk.done)break;pending+=decoder.decode(chunk.value,{stream:true});let end;while((end=pending.indexOf('\n\n'))>=0){const frame=pending.slice(0,end);pending=pending.slice(end+2);state.text+=frame+'\n\n';if(frame.startsWith(':'))state.heartbeats++;else{const data=frame.split('\n').find(line=>line.startsWith('data: '));if(data){const event=JSON.parse(data.slice(6));if(event.requestId!==requestId||event.projectId!==id||event.seq!==state.events.length+1)throw Error('SSE identity');state.events.push(event);}}}}}catch(error){state.error=error.name;}finally{state.done=true;}})();
    },{id:projectId,baseVersionId:base.currentVersion.id,requestId});
    await page.waitForFunction(()=>window.deploymentStream.events[0]?.event==='accepted');return{query,requestId};
  }
  async function heldStream(){const count=provider.state.requests;const running=await stream();const deadline=Date.now()+5000;while(provider.state.requests===count&&Date.now()<deadline){check();await delay(20);}assert.equal(provider.state.requests,count+1,'Actual SDK request must reach the held upstream before fault injection');return running;}
  async function terminal(status){await page.waitForFunction(()=>window.deploymentStream.done,undefined,{timeout:15_000});const result=await page.evaluate(()=>({events:window.deploymentStream.events,error:window.deploymentStream.error}));const events=result.events.filter(item=>item.event==='terminal');assert.equal(events.length,1);assert.equal(events[0].state.status,status);return events[0].state;}
  try{
    unlock=await acquireRunLock(root,()=>{timedOut=true;abort();});
    const binary=await findNginx();await freePorts([3001,8080]);
    const version=await exec(binary,['-v'],{timeout:5000,env:cleanEnvironment()});report.nginx=(version.stderr+version.stdout).match(/nginx\/\d+\.\d+\.\d+/)?.[0]??null;if(!report.nginx)throw Error('MISSING_NGINX');
    browser=await launchChrome();
    await scenario('artifact','artifact',async()=>{
      const identity=await validateRelease(releasePath);Object.assign(report,{releaseId:identity.releaseId,releaseDigest:identity.releaseDigest,sourceDigest:identity.sourceDigest,buildDigest:identity.buildDigest});
      // First copy, then move to a path with spaces and discard the transient staging parent.
      const stage=path.join(output,'source-copy');await cp(releasePath,stage,{recursive:true,verbatimSymlinks:true});release=path.join(output,'releases','relocated release',identity.releaseId);await mkdir(path.dirname(release),{recursive:true,mode:0o700});const{rename}=await import('node:fs/promises');await rename(stage,release);await assert.rejects(lstat(stage));await validateRelease(release);
      database=path.join(output,'shared/data/atoms.sqlite');await mkdir(path.dirname(database),{recursive:true,mode:0o700});
      const outcome=await runCommand({command:process.execPath,args:['--input-type=module','-e',nativeProbe,path.join(privateDir,'native.sqlite')],cwd:path.join(release,'backend'),env:cleanEnvironment(),signal:cancellation.signal,timeoutMs:15_000,log:path.join(privateDir,'native.log')});if(outcome.cleanup!=='passed'){report.cleanup='failed';throw Error('CLEANUP_INCOMPLETE');}assert.equal(outcome.status,'passed');
      serverEnv={...cleanEnvironment(),NODE_ENV:'production',HOST:'127.0.0.1',PORT:'3001',DATABASE_PATH:database,APP_ORIGINS:ORIGIN};
      assert.equal(serverEnv.OPENAI_API_KEY,undefined);assert.equal(serverEnv.NODE_OPTIONS,undefined);await assert.rejects(lstat(path.join(release,'backend/.env')));
    });
    const prefix=path.join(privateDir,'nginx prefix');await mkdir(prefix,{mode:0o700});await mkdir(path.join(prefix,'logs'),{mode:0o700});const conf=path.join(prefix,'nginx.conf');
    await scenario('nginx','artifact',async()=>{const text=await renderNginx(path.join(release,'deploy/nginx.conf.template'),prefix,path.join(release,'frontend'));await writeFile(conf,text,{mode:0o600});report.configDigest=sha256(text);await exec(binary,['-p',prefix+path.sep,'-c',conf,'-t'],{env:cleanEnvironment(),timeout:5000});const proxy=await owned.launch(binary,['-p',prefix+path.sep,'-c',conf],prefix,cleanEnvironment(),path.join(privateDir,'nginx.log'));await startBackend();owned.assertListener(proxy,8080,true);assert.deepEqual(await(await request(ORIGIN+'/api/health')).json(),{status:'ok',service:'atoms-backend'});});
    phase='A';context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});page=await context.newPage();page.setDefaultTimeout(15_000);page.setDefaultNavigationTimeout(30_000);
    await scenario('routing','production',async()=>{
      const html=await(await request(ORIGIN)).text();for(const suffix of ['js','css']){const match=html.match(new RegExp('(?:src|href)="([^"]+\\.'+suffix+')"'));assert.ok(match);const response=await request(ORIGIN+match[1]);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),suffix==='js'?/javascript/:/text\/css/);assert.match(response.headers.get('cache-control'),/immutable/);}
      for(const url of ['/assets/missing.js','/template-assets/missing.json','/.env','/atoms.sqlite','/backend/.env','/api/unknown','/api']){const response=await request(ORIGIN+url);assert.equal(response.status,404,url);assert.ok(!(await response.text()).includes('<div id="root">'));}
      assert.match((await request(ORIGIN+'/index.html')).headers.get('cache-control'),/no-cache/);
      await page.goto(ORIGIN+'/templates/company-landing');await page.locator('[data-preview-state="ready"]').waitFor({timeout:70_000});const frame=page.frameLocator('iframe');await frame.getByRole('button',{name:'Is this template free?'}).first().click();
    });
    await scenario('production-template','production',async()=>{await page.goto(ORIGIN);projectId=await createViaForm(page,'本地生产入口验收','保留企业官网并添加报价控件。');await taskFinished(page,/项目已创建.*生成未受理/);await waitCompiled(page);current=(await detail()).currentVersion;assert.equal(current.kind,'template');assert.equal((await detail()).latestRun,null);await page.reload();await waitCompiled(page);assert.equal((await detail()).currentVersion.snapshot.digest,current.snapshot.digest);});
    await scenario('origin-ownership','production',async()=>{
      const bad=await request(ORIGIN+'/api/session',{method:'POST',headers:{origin:'http://localhost:8080','content-type':'application/json'},body:'{}'});assert.equal(bad.status,403);
      const missing=await request(ORIGIN+'/api/session',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(missing.status,403);
      const alien=await browser.newContext();try{const other=await alien.newPage();await other.goto(ORIGIN);await other.getByRole('textbox',{name:'你想创建什么？',exact:true}).fill('仅确认陌生会话就绪，不提交');await other.locator('button[type="submit"]:not(:disabled)').waitFor();assert.equal((await api(other,'GET',`/api/projects/${projectId}`)).status,404);}finally{await alien.close();}
    });
    await scenario('production-restart','production',async()=>{await owned.stop(backend);await page.goto(ORIGIN+'/diagnostics/connection');await page.getByRole('button',{name:'检查后端连接',exact:true}).click();await page.getByText('后端返回 HTTP 502',{exact:true}).waitFor();await startBackend();await page.goto(`${ORIGIN}/projects/${projectId}`);await waitCompiled(page);assert.deepEqual((await detail()).currentVersion,current);});
    phase='B';
    await owned.stop(backend);provider=await(await import('./release/provider.mjs')).fixtureProvider();
    launcher=path.join(privateDir,'fixture-server.mjs');const launcherText=(await readFile(path.join(root,'scripts/generation-stream-server.mjs'),'utf8')).replace("['http://127.0.0.1:5173', 'http://127.0.0.1:4173']",JSON.stringify([ORIGIN]));await writeFile(launcher,launcherText,{mode:0o600});await startBackend(true);
    await scenario('fixture-generation','fixture',async()=>{
      await page.goto(ORIGIN);const before=provider.state.requests;generatedProject=await createViaForm(page,'本地部署受控报价','在企业官网中添加可操作报价控件。');await taskFinished(page,/候选已保存/);await waitCompiled(page);await assertQuote(page);assert.equal(provider.state.requests-before,3);
      const pending=await detail(generatedProject);assert.equal(pending.currentVersion.kind,'template');const candidate=await api(page,'GET',`/api/projects/${generatedProject}/versions/${pending.latestRun.resultVersionId}`);assert.equal(candidate.body.adoptionAvailability,'eligible');
      await page.getByRole('button',{name:'使用这个版本',exact:true}).click();await page.locator('[data-adoption-state="confirmed"]').waitFor();adopted=(await detail(generatedProject)).currentVersion;assert.equal(adopted.id,pending.latestRun.resultVersionId);await page.reload();await waitCompiled(page);assert.deepEqual((await detail(generatedProject)).currentVersion,adopted);
    });
    await page.goto(ORIGIN+'/diagnostics/connection');
    await scenario('proxy-heartbeat-complete','fixture',async()=>{provider.state.hold=true;const before=provider.state.requests;const running=await heldStream();await page.waitForFunction(()=>window.deploymentStream.heartbeats>=1,undefined,{timeout:14_000});assert.equal((await api(page,'GET',running.query)).body.status,'running');assert.equal(provider.state.requests,before+1);assert.equal(provider.state.hold,true);provider.release();await terminal('succeeded');assert.equal((await api(page,'GET',running.query)).body.status,'succeeded');assert.equal((await detail()).currentVersion.id,current.id);});
    await scenario('proxy-cancel','fixture',async()=>{provider.state.hold=true;const running=await heldStream();const cancel=await api(page,'POST',running.query+'/cancel',{});assert.ok([200,202].includes(cancel.status));await terminal('cancelled');assert.equal((await poll(running.query,'cancelled')).errorCode,'USER_CANCELLED');provider.release();});
    await scenario('proxy-disconnect','fixture',async()=>{provider.state.hold=true;const before=provider.state.aborts;const running=await heldStream();await page.evaluate(()=>window.deploymentStream.controller.abort());assert.equal((await poll(running.query,'cancelled')).errorCode,'CLIENT_DISCONNECTED');const deadline=Date.now()+2000;while(provider.state.aborts<=before&&Date.now()<deadline)await delay(20);assert.ok(provider.state.aborts>before);provider.release();});
    await scenario('graceful-shutdown','fixture',async()=>{provider.state.hold=true;const running=await heldStream();const start=Date.now();const stopped=await owned.stop(backend);assert.equal(stopped.escalated,false,'Graceful shutdown must not require SIGKILL');assert.ok(Date.now()-start<8000);provider.release();await startBackend(true);assert.equal((await poll(running.query,'cancelled')).errorCode,'SERVER_SHUTDOWN');assert.equal((await detail()).currentVersion.id,current.id);});
    await scenario('crash-recovery','fixture',async()=>{provider.state.hold=true;const running=await heldStream();await owned.stop(backend,'SIGKILL');const count=provider.state.requests;provider.release();const deadline=Date.now()+32_000;while(Date.now()<deadline){check();await delay(200);}await startBackend(true);const state=await poll(running.query,'interrupted');assert.equal(state.errorCode,'PROCESS_RESTARTED');assert.equal(provider.state.requests,count);assert.deepEqual((await detail()).currentVersion,current);});
    phase='C';
    await scenario('production-reopen','production',async()=>{await owned.stop(backend);const count=provider.state.requests;await startBackend();await page.goto(`${ORIGIN}/projects/${generatedProject}`);await waitCompiled(page);assert.deepEqual((await detail(generatedProject)).currentVersion,adopted);await assertQuote(page);assert.equal(provider.state.requests,count);});
    await owned.stop(backend);const requireBackend=createRequire(path.join(release,'backend/package.json'));const Database=requireBackend('better-sqlite3');
    const backupDir=path.join(output,'shared/backup');const backup=path.join(backupDir,'atoms.sqlite');
    await scenario('cold-backup-restore','production',async()=>{
      await mkdir(backupDir,{mode:0o700});for(const suffix of ['','-wal','-shm']){try{await cp(database+suffix,backup+suffix,{errorOnExist:true,force:false});}catch(error){if(error.code!=='ENOENT')throw error;}}
      const db=new Database(backup,{readonly:true});try{assert.equal(db.pragma('quick_check',{simple:true}),'ok');assert.ok(db.prepare('SELECT id FROM projects WHERE id=?').get(generatedProject));}finally{db.close();}
      const restored=path.join(output,'shared/restored/atoms.sqlite');await mkdir(path.dirname(restored),{mode:0o700});for(const suffix of ['','-wal','-shm']){try{await cp(backup+suffix,restored+suffix,{errorOnExist:true,force:false});}catch(error){if(error.code!=='ENOENT')throw error;}}await startBackend(false,restored);await page.reload();assert.deepEqual((await detail(generatedProject)).currentVersion,adopted);await owned.stop(backend);
    });
    await scenario('startup-failures','production',async()=>{
      for(const kind of ['bad-config','read-only','future-schema','same-database']){
        const folder=path.join(output,'shared/failure-'+kind);await mkdir(folder,{mode:0o700});const dbPath=path.join(folder,'atoms.sqlite');await cp(backup,dbPath);const before=await readFile(dbPath);let owner;
        if(kind==='future-schema'){const db=new Database(dbPath);db.pragma('user_version=999');db.close();}
        if(kind==='read-only'){await chmod(dbPath,0o400);await chmod(folder,0o500);}
        if(kind==='same-database'){owner=await launchBackend(false,dbPath);await owned.ready('http://127.0.0.1:3001/api/health',owner);}
        const negative=await launchBackend(false,dbPath,{PORT:'3002',...(kind==='bad-config'?{APP_ORIGINS:'http://untrusted.example'}:{})});
        const deadline=Date.now()+5000;while(negative.exitCode===null&&negative.signalCode===null&&Date.now()<deadline){check();await delay(50);}assert.notEqual(negative.exitCode,null,kind);assert.notEqual(negative.exitCode,0,kind);const errorLog=await readFile(path.join(privateDir,`backend-${sequence}.log`),'utf8');assert.ok(errorLog.includes(kind==='same-database'||kind==='read-only'?'OWNERSHIP_UNAVAILABLE':'INVALID_CONFIGURATION'),kind);await owned.stop(negative);await owned.stop(owner);
        if(kind==='read-only'){await chmod(folder,0o700);await chmod(dbPath,0o600);}
        if(kind==='bad-config'||kind==='read-only')assert.deepEqual(await readFile(dbPath),before);
        const checkDb=new Database(dbPath,{readonly:true});try{assert.equal(checkDb.pragma('quick_check',{simple:true}),'ok');assert.ok(checkDb.prepare('SELECT id FROM projects WHERE id=?').get(generatedProject));if(kind==='future-schema')assert.equal(checkDb.pragma('user_version',{simple:true}),999);}finally{checkDb.close();}
      }
      await startBackend();await page.reload();assert.deepEqual((await detail(generatedProject)).currentVersion,adopted);
    });
    await scenario('final-integrity','artifact',async()=>{assert.equal((await validateRelease(releasePath)).releaseDigest,report.releaseDigest);assert.equal((await validateRelease(release)).releaseDigest,report.releaseDigest);assert.ok(provider.state.paths.every(value=>value==='/v1/responses'));});report.status='passed';
  }catch(error){if(page)await page.screenshot({path:path.join(privateDir,'failure.png'),timeout:3000}).catch(()=>{});report.status=interrupted?'cancelled':['MISSING_NGINX','MISSING_CHROME','PORT_BUSY','VERIFY_BUSY'].includes(error.message)?'blocked':'failed';report.reason=interrupted?'SIGNAL':timedOut?'TIMEOUT':REASONS.has(error.message)?error.message:'ASSERTION_FAILED';await writeFile(path.join(privateDir,'failure.log'),String(error.stack),{mode:0o600});}
  finally{
    clearTimeout(timer);const results=await Promise.allSettled([closeBrowser(browser),owned.close(),provider?.close()]);try{await unlock?.();}catch{results.push({status:'rejected'});}report.cleanup=report.cleanup==='failed'||results.some(item=>item.status==='rejected')?'failed':'passed';if(report.cleanup==='failed'){report.status='failed';report.reason='CLEANUP_INCOMPLETE';}for(const[signal,fn]of handlers)process.removeListener(signal,fn);
    for(const id of REQUIRED)if(!report.cases.some(item=>item.id===id))report.cases.push({id,phase:'not-run',source:'artifact',status:'not-run',durationMs:0});if(report.status==='passed'){try{validateDeploymentReport(publicReport(report),report);}catch{report.status='failed';report.reason='REPORT_IDENTITY';}}await publish();await writeFile(path.join(exportDir,'summary.md'),`# 本地部署验收\n\nRun: ${runId}\n\n状态: ${report.status}\n\nRelease: ${report.releaseId??'未核验'}\n\nDigest: ${report.releaseDigest??'未核验'}\n\n阶段 A/C 使用生产入口，阶段 B 使用受控 SDK HTTP 传输。真实模型、公网 HTTPS、hosted CI 均未运行。\n`,{mode:0o600});
  }
  console.log(`${report.status}: test-results/deployment/${runId}/export/summary.json`);return interrupted==='SIGINT'?130:interrupted?143:report.status==='passed'?0:report.status==='blocked'?2:1;
}
module.exports={parseDeploymentArgs,publicReport,validateDeploymentReport,REQUIRED,expectedSource,expectedPhase,launchChrome};
if(require.main===module){let args;try{args=parseDeploymentArgs(process.argv.slice(2));}catch{console.error('INVALID_ARGUMENTS');process.exitCode=2;}if(args?.help)console.log('Usage: pnpm smoke:deployment --release /absolute/release/path\nRead-only validation; needs NGINX_BIN (absolute) or nginx on PATH, Chrome, ports 8080/3001. No build/install/live model.');else if(args)smoke(args.release).then(code=>{process.exitCode=code;}).catch(()=>{console.error('DEPLOYMENT_FAILED');process.exitCode=1;});}
