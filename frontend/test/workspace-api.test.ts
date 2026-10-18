import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorkspaceApi } from '../src/api/workspace';
import { VersionApiError } from '../src/api/versions';
import { jsonResponse, safeErrorResponse, workspaceFixture } from './helpers/workspace';

test('workspace JSON reads enforce body/schema/network boundaries and sanitize all HTTP failure details', async () => {
  for (const transport of [
    async () => { throw new Error('PRIVATE_NETWORK_SENTINEL'); },
    async () => new Response('{"PRIVATE_JSON_SENTINEL"'),
    async () => new Response('{}',{headers:{'content-length':String(16*1024*1024+1)}}),
    async () => jsonResponse({items:[{private:'PRIVATE_SCHEMA_SENTINEL'}]}),
  ] satisfies (typeof fetch)[]) await assert.rejects(createWorkspaceApi({transport}).projects(), error=>error instanceof VersionApiError&&!/PRIVATE_/.test(error.message));
  for (const status of [401,404]) {
    let unauthorized=0; const api=createWorkspaceApi({transport:async()=>safeErrorResponse(status,'PRIVATE_HTTP_SENTINEL'),onUnauthorized:()=>unauthorized++});
    await assert.rejects(api.projects(),error=>error instanceof VersionApiError&&error.status===status&&!error.message.includes('PRIVATE_'));
    assert.equal(unauthorized,status===401?1:0);
  }
  const controller=new AbortController(); controller.abort(); let calls=0;
  await assert.rejects(createWorkspaceApi({transport:async()=>{calls++; return jsonResponse({items:[],nextCursor:null});}}).projects(undefined,controller.signal),error=>error instanceof VersionApiError&&error.kind==='cancelled'); assert.equal(calls,0);
});
test('latest/earlier messages use ascending associated pages and reject malformed ordering and foreign projects', async () => {
  const f=workspaceFixture(); const items=[1,2].map(sequence=>({id:crypto.randomUUID(),projectId:f.projectId,sequence,role:'user',content:'fixture',runId:null,createdAt:f.at})); const urls:string[]=[];
  const api=createWorkspaceApi({transport:async(url)=>{urls.push(String(url));return jsonResponse({items,nextBeforeSequence:1,latestSequence:2});}});
  await api.messages(f.projectId); await api.messages(f.projectId,3); assert.match(urls[0]??'',/direction=backward&limit=50$/); assert.match(urls[1]??'',/beforeSequence=3$/);
  for(const wrong of [[items[1],items[0]],[{...items[0],projectId:crypto.randomUUID()}]]) await assert.rejects(createWorkspaceApi({transport:async()=>jsonResponse({items:wrong,nextBeforeSequence:null,latestSequence:2})}).messages(f.projectId),VersionApiError);
  for(const method of ['status','cancel'] as const) await assert.rejects(createWorkspaceApi({transport:async()=>jsonResponse({...f.running,requestId:crypto.randomUUID()})})[method](f.projectId,f.requestId),VersionApiError);
});
