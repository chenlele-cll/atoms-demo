import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createModelClient, ModelFailure } from '../src/model/client.js';
import { readModelConfig } from '../src/model/config.js';
import { safeModelIdentifier, safeProviderRequestId } from '../src/model/observation.js';
import type { ModelObservation, GenerationObservation } from '../src/model/observation.js';
import { fixtureEnv, response, sentinel, startFixture } from './helpers/model-fixture.js';
test('actual SDK transport records one dispatch/unchanged response/step and preserves signal and private metadata boundary', async t => {
  const events: ModelObservation[] = []; let observedSignal: AbortSignal | null | undefined; let returned: Response | undefined;
  const upstream = await startFixture((body,res) => { void body;res.setHeader('x-request-id','req_public_fixture_1234');res.end(JSON.stringify(response())); });t.after(upstream.close);
  const transport: typeof fetch = async (url,init) => {observedSignal=init?.signal;returned=await upstream.transport(url,init);return returned;};
  const result=await createModelClient(readModelConfig(fixtureEnv),transport).run(1,session=>session.step({messages:[{role:'user',content:sentinel}]}),undefined,undefined,event=>events.push(event));
  assert.equal(result.value.text,'Hello from the public fixture.');assert.equal(result.metrics.requestCount,1);assert.equal(upstream.requests.length,1);assert.equal(returned?.bodyUsed,true);assert.ok(observedSignal instanceof AbortSignal);
  assert.deepEqual(events.map(event=>event.event),['dispatch','response','step-finished']);assert.equal(new Set(events.map(event=>event.requestAttemptId)).size,1);assert.ok(events.every(event=>event.step===1));assert.equal(events[1]?.providerRequestId,'req_public_fixture_1234');assert.equal(events[2]?.responseModel,'gpt-6.1-sol');assert.deepEqual(events[2]?.usage,{inputTokens:12,outputTokens:7,totalTokens:19});assert.ok(!JSON.stringify(events).includes(sentinel));
});
test('missing usage/request ID stays null; raw provider/body/header/error sentinels are never copied',async t=>{
 const events:ModelObservation[]=[];const upstream=await startFixture((body,res)=>{void body;res.setHeader('x-request-id',sentinel);res.setHeader('x-private-header',sentinel);res.end(JSON.stringify(response(undefined,{usage:undefined,private_field:sentinel})));});t.after(upstream.close);
 await createModelClient(readModelConfig(fixtureEnv),upstream.transport).run(1,s=>s.step({messages:[{role:'user',content:'public'}]}),undefined,undefined,event=>events.push(event));
 assert.equal(events[1]?.providerRequestId,null);assert.equal(events[2]?.usage,null);assert.ok(!JSON.stringify(events).includes(sentinel));assert.equal(safeModelIdentifier(sentinel,sentinel),null);assert.equal(safeProviderRequestId('req_'+sentinel,sentinel),null);
});
test('network/cancellation observes attempted dispatch without fabricating a provider response and observer exceptions do not retry',async()=>{
 const events:ModelObservation[]=[];let calls=0;const transport:typeof fetch=()=>{calls++;return Promise.reject(new Error(sentinel));};
 await assert.rejects(createModelClient(readModelConfig(fixtureEnv),transport).run(1,s=>s.step({messages:[{role:'user',content:'public'}]}),undefined,undefined,event=>{events.push(event);throw Error(sentinel);}),ModelFailure);
 assert.equal(calls,1);assert.deepEqual(events.map(event=>event.event),['dispatch','step-finished']);assert.equal(events[1]?.httpStatus,null);assert.equal(events[1]?.errorCode,'network');assert.ok(!JSON.stringify(events).includes(sentinel));
});
test('real cancellation terminates the fixture transport and no late response observation is fabricated',async t=>{
 const controller=new AbortController();const events:ModelObservation[]=[];const upstream=await startFixture(()=>{});t.after(upstream.close);const pending=createModelClient(readModelConfig({...fixtureEnv,MODEL_TIMEOUT_MS:'2000'}),upstream.transport).run(1,s=>s.step({messages:[{role:'user',content:'public'}]}),controller.signal,undefined,e=>events.push(e));
 const deadline=Date.now()+1000;while(!upstream.requests.length&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(upstream.requests.length,1);controller.abort();await assert.rejects(pending,(error:unknown)=>error instanceof ModelFailure&&error.safe.code==='cancelled');const count=events.length;await new Promise(resolve=>setTimeout(resolve,50));assert.equal(events.length,count);assert.equal(events.filter(e=>e.event==='dispatch').length,1);assert.equal(events.filter(e=>e.event==='response').length,0);assert.equal(upstream.aborted(),1);
});
test('generation observations bind all actual SDK attempts to the one persisted project/run/request without altering public activities',async t=>{
 const {generationFixture,successfulGeneration}=await import('./helpers/generation.js');const {generateProject}=await import('../src/generation/service.js');const f=await generationFixture(t);const observations:GenerationObservation[]=[];const upstream=await startFixture((body,res,index)=>res.end(JSON.stringify(successfulGeneration(body,index))));t.after(upstream.close);
 const result=await generateProject(f.input,{store:f.store,env:fixtureEnv,transport:upstream.transport,audit:event=>observations.push(event)});assert.equal(result.status,'succeeded');assert.equal(upstream.requests.length,3);assert.equal(observations.length,9);assert.ok(observations.every(e=>e.runId===result.runId&&e.projectId===f.input.projectId&&e.requestId===f.input.requestId));assert.equal(new Set(observations.map(e=>e.requestAttemptId)).size,3);assert.equal(f.store.getProject(f.session.id,f.detail.project.id).currentVersion.id,f.detail.currentVersion.id);assert.ok(!JSON.stringify(observations).includes(sentinel));
});
