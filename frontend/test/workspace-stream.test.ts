import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import type { GenerationEvent } from '@atoms/contracts';
import { generate, GenerationStreamError } from '../src/api/generation-stream';
import { jsonResponse, safeErrorResponse, workspaceFixture } from './helpers/workspace';
import { VersionApiError } from '../src/api/versions';

const encode = (events: unknown[], newline = '\n') => events.map(value => { const event = typeof value === 'object' && value !== null && 'event' in value ? value.event : 'activity'; return `event: ${event}${newline}data: ${JSON.stringify(value)}${newline}${newline}`; }).join('');
function streamResponse(text: string, split = false, close = true) {
  const data = new TextEncoder().encode(text); let offset = 0; let cancelled = false;
  return { response: new Response(new ReadableStream<Uint8Array>({ pull(controller) {
    if (offset < data.length) { const end = split ? offset + 1 : data.length; controller.enqueue(data.slice(offset, end)); offset = end; }
    else if (close) controller.close();
  }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } }), cancelled: () => cancelled };
}
test('POST parser handles byte-split UTF-8/CRLF, same-chunk frames, heartbeat and no automatic repeat', async () => {
  const f = workspaceFixture();
  for (const split of [false,true]) {
    let calls = 0; const seen: GenerationEvent[] = []; const response = streamResponse(': 中文🙂 heartbeat\r\n\r\n' + encode([f.accepted,f.activity,f.terminal], '\r\n'), split);
    const result = await generate(f.projectId, f.body, { transport: async (url, init) => { calls++; assert.equal(String(url), `/api/projects/${f.projectId}/generations`); assert.equal(init?.credentials, 'same-origin'); assert.deepEqual(JSON.parse(String(init?.body)), f.body); return response.response; }, onEvent: event => seen.push(event) });
    assert.equal(result.status, 'succeeded'); assert.equal(calls, 1); assert.deepEqual(seen.map(item => item.seq), [1,2,3]);
  }
});
test('200 terminal / 202 running JSON use their own branch and association is checked', async () => {
  const f = workspaceFixture();
  for (const [state, status] of [[f.running,202],[f.succeeded,200]] as const) assert.deepEqual(await generate(f.projectId, f.body, { transport: async () => jsonResponse(state,status), onEvent: () => assert.fail('JSON is not SSE') }), state);
  await assert.rejects(generate(f.projectId, f.body, { transport: async () => safeErrorResponse(503, 'MODEL_CONFIGURATION'), onEvent: () => {} }), error => error instanceof VersionApiError && error.status === 503);
  await assert.rejects(generate(f.projectId, f.body, { transport: async () => jsonResponse({ ...f.succeeded, projectId: crypto.randomUUID() }), onEvent: () => {} }), GenerationStreamError);
});
test('truncation, missing/duplicate/out-of-order frames, wrong identities, extra fields and totals safely fail', async () => {
  const f = workspaceFixture();
  const cases = [
    encode([f.activity,f.terminal]), encode([f.accepted,f.terminal]), encode([f.accepted,f.accepted]),
    encode([f.accepted,{ ...f.activity, projectId: crypto.randomUUID() },f.terminal]),
    encode([f.accepted,{ ...f.activity, runId: crypto.randomUUID() },f.terminal]),
    encode([f.accepted,{ ...f.activity, requestId: crypto.randomUUID() },f.terminal]),
    encode([f.accepted,{ ...f.activity, baseVersionId: crypto.randomUUID() },f.terminal]),
    encode([f.accepted,{ ...f.activity, secret: 'PRIVATE_STREAM_SENTINEL' },f.terminal]),
    encode([f.accepted,f.activity,f.terminal,f.terminal]), encode([f.accepted,f.activity]),
    'id: private\n'+encode([f.accepted,f.activity,f.terminal]), 'retry: 1000\n'+encode([f.accepted,f.activity,f.terminal]),
    'unknown: private\n'+encode([f.accepted,f.activity,f.terminal]),
    encode([f.accepted,f.activity,{...f.terminal,state:{...f.succeeded,baseVersionId:crypto.randomUUID()}}]),
    encode([f.accepted,f.activity,f.terminal]).slice(0,-1), 'event: accepted\ndata: {"PRIVATE_STREAM_SENTINEL":\n\n',
    'data: ' + 'x'.repeat(8193), ': ' + 'x'.repeat(330 * 1024) + '\n\n',
  ];
  for (const text of cases) {
    await assert.rejects(generate(f.projectId, f.body, { transport: async () => streamResponse(text).response, onEvent: () => {} }), error => error instanceof GenerationStreamError && !error.message.includes('PRIVATE_STREAM_SENTINEL'));
  }
  await assert.rejects(generate(f.projectId, f.body, { limits: { frames: 2 }, transport: async () => streamResponse(encode([f.accepted,f.activity,f.terminal])).response, onEvent: () => {} }), GenerationStreamError);
});
test('headers/idle/total deadlines, pre-abort and reader cancellation clean up with no late events', async () => {
  const f = workspaceFixture(); let calls = 0; const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(generate(f.projectId, f.body, { signal: cancelled.signal, transport: async () => { calls++; return jsonResponse(f.running,202); }, onEvent: () => {} }), GenerationStreamError); assert.equal(calls, 0);
  await assert.rejects(generate(f.projectId, f.body, { limits: { headersMs: 5 }, transport: async () => new Promise(() => {}), onEvent: () => {} }), error => error instanceof GenerationStreamError && error.code === 'timeout');
  const held = streamResponse(encode([f.accepted]), false, false); const seen: GenerationEvent[] = [];
  await assert.rejects(generate(f.projectId, f.body, { limits: { idleMs: 5 }, transport: async () => held.response, onEvent: event => seen.push(event) }), GenerationStreamError);
  assert.equal(held.cancelled(), true); assert.equal(seen.length, 1);
  const heldTotal = streamResponse(encode([f.accepted]), false, false);
  await assert.rejects(generate(f.projectId, f.body, { limits: { totalMs: 5, idleMs: 100 }, transport: async () => heldTotal.response, onEvent: () => {} }), GenerationStreamError);
  assert.equal(heldTotal.cancelled(), true);
});
test('JSON body deadline and noncooperative reader cancellation cannot keep a request alive', async () => {
  const f=workspaceFixture(); let cancelled=false;
  const response=new Response(new ReadableStream<Uint8Array>({cancel(){cancelled=true;return new Promise(()=>{});}}),{headers:{'content-type':'text/event-stream'}});
  await assert.rejects(generate(f.projectId,f.body,{limits:{idleMs:5},transport:async()=>response,onEvent:()=>assert.fail('No frame emitted')}),GenerationStreamError); assert.equal(cancelled,true);
  await assert.rejects(generate(f.projectId,f.body,{limits:{headersMs:5},transport:async()=>new Response(new ReadableStream(),{headers:{'content-type':'application/json'}}),onEvent:()=>{}}),error=>error instanceof GenerationStreamError&&error.code==='timeout');
});


test('default SSE stays alive beyond 150 seconds while heartbeats continue, then accepts the real terminal', async t => {
  t.mock.timers.enable({apis:['setTimeout']});const f=workspaceFixture();let stream:ReadableStreamDefaultController<Uint8Array>|undefined;
  const encoder=new TextEncoder();const seen:GenerationEvent[]=[];let failure:unknown;
  const response=new Response(new ReadableStream<Uint8Array>({start(controller){stream=controller;controller.enqueue(encoder.encode(encode([f.accepted])));}}),{headers:{'content-type':'text/event-stream'}});
  const pending=generate(f.projectId,f.body,{transport:async()=>response,onEvent:event=>seen.push(event)}).catch((error:unknown)=>{failure=error;return undefined;});
  await nextTurn();assert.equal(seen.length,1);assert.ok(stream);
  for(let i=0;i<20;i++){t.mock.timers.tick(10_000);await nextTurn();assert.equal(failure,undefined);stream.enqueue(encoder.encode(': heartbeat\n\n'));await nextTurn();}
  stream.enqueue(encoder.encode(encode([f.activity,f.terminal])));stream.close();
  const result=await pending;assert.equal(failure,undefined);assert.equal(result?.status,'succeeded');assert.deepEqual(seen.map(event=>event.seq),[1,2,3]);
});
