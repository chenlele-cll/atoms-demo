import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { WorkspaceController } from '../src/workspace/controller';
import { routeFor, internalClick } from '../src/workspace/routing';
import { PendingRequests } from '../src/workspace/pending';
import { createWorkspaceApi } from '../src/api/workspace';
import { memoryStorage, workspaceServer } from './helpers/workspace-server';
import { jsonResponse, workspaceFixture } from './helpers/workspace';
const until = async (work: () => boolean) => { for (let i=0;i<200;i++) { if (work()) return; await delay(5); } assert.fail('Controller fixture did not settle'); };

test('route matching and native modifier/new-tab semantics are explicit', () => {
  const f=workspaceFixture(); assert.equal(routeFor('/').kind,'home'); assert.equal(routeFor('/diagnostics/connection').kind,'diagnostics');
  assert.equal(routeFor(`/projects/${f.projectId}`).kind,'project'); assert.equal(routeFor(`/projects/${f.projectId}/candidates/${f.versionId}`).kind,'candidate');
  for(const path of ['/unknown','/projects/invalid','/projects/'+f.projectId+'/wrong']) assert.equal(routeFor(path).kind,'missing');
  assert.equal(internalClick({button:0,ctrlKey:false,metaKey:false,altKey:false,shiftKey:false}),true);
  for(const flags of [{button:1},{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true}]) assert.equal(internalClick({button:0,ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,...flags}),false);
});
test('session single-flight survives subscriber replay, reset is explicit, API failures are sanitized', async () => {
  const server=workspaceServer(); server.setSessionStatus(201); let changes=0; const api=createWorkspaceApi({transport:server.transport,onNewSession:()=>changes++});
  await Promise.all([api.session(),api.session(),api.session()]); assert.equal(server.records.filter(call=>call.url==='/api/session').length,1); assert.equal(changes,1);
  api.resetSession(); await api.session(); assert.equal(server.records.filter(call=>call.url==='/api/session').length,2);
  const bad=createWorkspaceApi({transport:async()=>jsonResponse({error:{code:'PRIVATE_SENTINEL',message:'sk-PRIVATE_SENTINEL'},requestId:'fixture'},503)});
  await assert.rejects(bad.projects(),error=>error instanceof Error&&!error.message.includes('PRIVATE_SENTINEL'));
  const empty=createWorkspaceApi({transport:async()=>jsonResponse({items:[]})}); assert.deepEqual((await empty.templates()).items,[]);
});
test('single explicit create command starts exactly once; saved candidate is never a silent next baseline', async t => {
  const server=workspaceServer(); const storage=memoryStorage(); const app=new WorkspaceController({transport:server.transport,storage}); t.after(()=>app.leave());
  app.activate(routeFor('/')); app.activate(routeFor('/')); await until(()=>app.snapshot().home.sessionReady);
  app.editHome({prompt:'Add a quote tool',title:''}); await Promise.all([app.create(),app.create()]);
  await until(()=>app.snapshot().task?.phase==='terminal'&&app.snapshot().selected?.id===server.f.versionId);
  assert.equal(server.records.filter(call=>call.url==='/api/projects'&&call.method==='POST').length,1);
  const posts=()=>server.records.filter(call=>call.url.endsWith('/generations'));
  assert.equal(posts().length,1); assert.equal(app.snapshot().messages.length,2); assert.equal(app.snapshot().draft,'');
  assert.equal(app.snapshot().project?.project.currentVersionId,server.f.baseId); assert.equal(storage.map.size,1);
  app.setDraft('Next change'); await app.start(); assert.equal(posts().length,1); assert.match(app.snapshot().error,/先采用/);
  const selected=app.snapshot().selected; assert.ok(selected);
  app.facts({...server.f.project,project:{...server.f.project.project,currentVersionId:selected.id},currentVersion:selected},app.snapshot().activation);
  server.setMode('unconfigured'); await app.start(); assert.equal(posts().length,2);
  const body=posts()[1]?.body; assert.ok(typeof body==='object'&&body!==null&&'baseVersionId'in body); assert.equal(body.baseVersionId,server.f.versionId);
});
test('creation response after leaving is retained server-side but never navigates back or generates', async t => {
  const server=workspaceServer(); let release:()=>void=()=>{}; server.setCreateGate(new Promise<void>(r=>{release=r;})); let navigation=0;
  const app=new WorkspaceController({transport:server.transport,storage:memoryStorage(),navigate:()=>navigation++}); t.after(()=>app.leave());
  app.activate(routeFor('/')); await until(()=>app.snapshot().home.sessionReady); app.editHome({prompt:'Add a tool'}); const creation=app.create();
  app.activate(routeFor('/diagnostics/connection')); release(); await creation;
  assert.equal(navigation,0); assert.equal(server.records.filter(call=>call.url.endsWith('/generations')).length,0); assert.equal(app.snapshot().home.status,'idle');
});
test('view subscription replay never aborts a live stream; cancellation cannot overwrite a committed success', async t => {
  const server=workspaceServer(); server.setMode('hold'); const app=new WorkspaceController({transport:server.transport,storage:memoryStorage()}); t.after(()=>app.leave());
  app.activate(routeFor(`/projects/${server.f.projectId}`)); await until(()=>app.snapshot().review!==null); app.setDraft('change'); const operation=app.start();
  await until(()=>app.snapshot().task?.phase==='active'); const unsubscribe=app.subscribe(()=>{}); unsubscribe(); const next=app.subscribe(()=>{}); next();
  app.setView('code'); app.setView('chat'); assert.equal(server.generationSignal()?.aborted,false);
  let release:()=>void=()=>{}; server.setCancelGate(new Promise<void>(r=>{release=r;})); const cancel=app.cancel();
  server.success(); await until(()=>app.snapshot().task?.phase==='terminal'); release(); await cancel; await operation;
  assert.equal(app.snapshot().task?.state?.status,'succeeded'); assert.equal(server.records.filter(call=>call.url.endsWith('/generations')).length,1);
});
test('navigation aborts only the original activation, keeps drafts separate and ignores late A events', async t => {
  const server=workspaceServer(); server.setMode('hold'); const app=new WorkspaceController({transport:server.transport,storage:memoryStorage()}); t.after(()=>app.leave());
  app.activate(routeFor(`/projects/${server.f.projectId}`)); await until(()=>app.snapshot().review!==null); app.setDraft('draft A'); const operation=app.start(); await until(()=>app.snapshot().task?.phase==='active');
  app.setDraft('unsent A'); app.activate(routeFor(`/projects/${server.other.projectId}`)); await until(()=>app.snapshot().project?.project.id===server.other.projectId);
  await operation; assert.equal(server.generationSignal()?.aborted,true); app.setDraft('draft B');
  assert.equal(app.snapshot().messages.length,0); assert.equal(app.snapshot().task,null); assert.equal(app.snapshot().selected?.projectId,server.other.projectId);
  app.activate(routeFor(`/projects/${server.f.projectId}`)); await until(()=>app.snapshot().review!==null); assert.equal(app.snapshot().draft,'unsent A');
});
test('pending request recovery queries its original ID, never latestRun or automatic POST; 404 remains unknown', async t => {
  const server=workspaceServer(); const storage=memoryStorage(); const pending=new PendingRequests(storage);
  pending.save({...server.f.body,projectId:server.f.projectId,createdAt:Date.now()}); server.setQueryStatus(404);
  const run=server.f.review.successfulRun; assert.ok(run); server.f.project.latestRun={...run,status:'succeeded'};
  const app=new WorkspaceController({transport:server.transport,storage}); t.after(()=>app.leave()); app.activate(routeFor(`/projects/${server.f.projectId}`));
  await until(()=>app.snapshot().task?.phase==='unknown'); assert.equal(app.snapshot().task?.payload.requestId,server.f.requestId);
  assert.equal(app.snapshot().selected?.id,server.f.baseId); assert.equal(server.records.filter(call=>call.url.endsWith('/generations')).length,0);
  assert.equal(server.records.filter(call=>call.url.includes('/generations/by-request/'))[0]?.url.split('/').at(-1),server.f.requestId);
});
test('expired session clears private state/envelopes and does not create another session on a private URL', async t => {
  const server=workspaceServer(); server.setUnauthorized(); const storage=memoryStorage(); new PendingRequests(storage).save({...server.f.body,projectId:server.f.projectId,createdAt:Date.now()});
  const app=new WorkspaceController({transport:server.transport,storage}); t.after(()=>app.leave()); app.activate(routeFor(`/projects/${server.f.projectId}`));
  await until(()=>app.snapshot().error.includes('会话')); assert.equal(app.snapshot().project,null); assert.equal(new PendingRequests(storage).get(server.f.projectId),undefined);
  app.activate(routeFor('/')); await until(()=>!app.snapshot().loading); assert.equal(server.records.filter(call=>call.url==='/api/session').length,0);
});
test('pending storage enforces TTL/count and falls back to memory without treating it as persisted', () => {
  const f=workspaceFixture(); const storage=memoryStorage(); let now=100; const pending=new PendingRequests(storage,()=>now);
  for(let i=0;i<22;i++) pending.save({...f.body,projectId:crypto.randomUUID(),createdAt:100}); assert.equal(JSON.parse(storage.getItem('atoms.pending-generations.v1')??'[]').length,20);
  pending.save({...f.body,projectId:f.projectId,createdAt:100}); assert.ok(pending.get(f.projectId)); now+=86_400_001; assert.equal(pending.get(f.projectId),undefined);
  const unavailable=new PendingRequests({getItem:()=>{throw new Error('PRIVATE_STORAGE_SENTINEL');},setItem:()=>{throw new Error();},removeItem:()=>{}},()=>100);
  unavailable.save({...f.body,projectId:f.projectId,createdAt:100}); assert.equal(unavailable.available,false); assert.equal(unavailable.get(f.projectId)?.requestId,f.requestId); unavailable.clear(); assert.equal(unavailable.get(f.projectId),undefined);
});
test('network uncertainty never repeats project creation', async t => {
  const server=workspaceServer(); const transport:typeof fetch=async(input,init)=>String(input)==='/api/projects'&&init?.method==='POST'?Promise.reject(new Error('PRIVATE_NETWORK_SENTINEL')):server.transport(input,init);
  const app=new WorkspaceController({transport,storage:memoryStorage()}); t.after(()=>app.leave()); app.activate(routeFor('/')); await until(()=>app.snapshot().home.sessionReady);
  app.editHome({prompt:'Create fixture'}); await app.create(); assert.equal(app.snapshot().home.status,'unknown'); assert.ok(!app.snapshot().home.message.includes('PRIVATE_NETWORK_SENTINEL'));
  assert.equal(server.records.filter(call=>call.url.endsWith('/generations')).length,0);
});
test('a missing terminal frame queries persisted success once without POST replay or invented events', async t => {
  const server=workspaceServer(); server.setMode('eof'); const app=new WorkspaceController({transport:server.transport,storage:memoryStorage()}); t.after(()=>app.leave());
  app.activate(routeFor(`/projects/${server.f.projectId}`)); await until(()=>app.snapshot().review!==null); app.setDraft('lost final frame'); await app.start();
  await until(()=>app.snapshot().task?.phase==='terminal'); assert.equal(app.snapshot().task?.state?.status,'succeeded');
  assert.deepEqual(app.snapshot().task?.events.map(event=>event.event),['accepted']); assert.equal(server.records.filter(call=>call.url.endsWith('/generations')).length,1);
  assert.equal(server.records.filter(call=>call.url.includes('/generations/by-request/')).length,1);
  await until(()=>app.snapshot().messages.length===2); assert.equal(new Set(app.snapshot().messages.map(message=>message.id)).size,2);
});
test('cancel acknowledgement remains cancelling, 503 recovery remains unknown, and only explicit retry reuses payload', async t => {
  const server=workspaceServer(); server.setMode('hold'); const storage=memoryStorage(); const app=new WorkspaceController({transport:server.transport,storage}); t.after(()=>app.leave());
  app.activate(routeFor(`/projects/${server.f.projectId}`)); await until(()=>app.snapshot().review!==null); app.setDraft('original payload'); const operation=app.start();
  await until(()=>app.snapshot().task?.phase==='active'); await app.cancel(); assert.equal(app.snapshot().task?.phase,'cancelling'); assert.equal(server.generationSignal()?.aborted,false);
  const original=app.snapshot().task?.payload; assert.ok(original); app.activate(routeFor('/diagnostics/connection')); await operation; server.setQueryStatus(503);
  app.activate(routeFor(`/projects/${server.f.projectId}`)); await until(()=>app.snapshot().task?.phase==='unknown');
  assert.deepEqual(app.snapshot().task?.payload,original); assert.equal(server.records.filter(call=>call.url.endsWith('/generations')).length,1);
  server.setMode('unconfigured'); await app.start('',undefined,true); const posts=server.records.filter(call=>call.url.endsWith('/generations'));
  assert.equal(posts.length,2); assert.deepEqual(posts[1]?.body,original); assert.equal(app.snapshot().draft,original.prompt);
});
test('running recovery pauses while hidden and stops at the query count limit; manual query resets budget', async t => {
  const server=workspaceServer(); const storage=memoryStorage(); new PendingRequests(storage).save({...server.f.body,projectId:server.f.projectId,createdAt:Date.now()});
  const app=new WorkspaceController({transport:server.transport,storage,pollMs:1}); t.after(()=>app.leave()); app.visibility(true);
  app.activate(routeFor(`/projects/${server.f.projectId}`)); await until(()=>app.snapshot().task?.phase==='active'); const queries=()=>server.records.filter(call=>call.url.includes('/generations/by-request/')).length;
  const first=queries(); await delay(15); assert.equal(queries(),first); app.visibility(false);
  await until(()=>app.snapshot().task?.phase==='unknown'); assert.equal(queries(),75); const stopped=queries(); await delay(15); assert.equal(queries(),stopped);
  app.visibility(true); await app.query(); assert.equal(queries(),stopped+1); assert.equal(app.snapshot().task?.phase,'active');
});
test('automatic query respects Retry-After rather than using its fast local poll interval', async t => {
  const server=workspaceServer(); const storage=memoryStorage(); new PendingRequests(storage).save({...server.f.body,projectId:server.f.projectId,createdAt:Date.now()}); let queries=0;
  const transport:typeof fetch=async(input,init)=>{if(String(input).includes('/generations/by-request/')){queries++;return new Response(JSON.stringify({error:{code:'RATE_LIMITED',message:'fixture'},requestId:'fixture'}),{status:429,headers:{'retry-after':'2','content-type':'application/json'}});}return server.transport(input,init);};
  let now=Date.now(); const app=new WorkspaceController({transport,storage,pollMs:1,now:()=>now}); t.after(()=>app.leave()); app.activate(routeFor(`/projects/${server.f.projectId}`)); await until(()=>app.snapshot().task?.phase==='unknown'); await delay(20); assert.equal(queries,1);
  app.visibility(true); app.visibility(false); await delay(20); assert.equal(queries,1,'Showing the tab cannot shorten Retry-After');
  app.visibility(true); now+=2001; app.visibility(false); await until(()=>queries===2); app.visibility(true);
});
