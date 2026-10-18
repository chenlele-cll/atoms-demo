// Explicit test SDK HTTP upstream; never part of a production release.
import {createServer} from 'node:http';
import {quoteCode} from '../verification/quote-fixture.mjs';
export async function fixtureProvider() {
  const state={requests:0,aborts:0,hold:false,waiters:[],paths:[]};
  const quotePath='/src/generated/DeploymentQuote.tsx';
  const server=createServer(async(req,res)=>{
    try{
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const body=JSON.parse(Buffer.concat(chunks));state.requests++;state.paths.push(req.url);
      res.on('close',()=>{if(!res.writableEnded)state.aborts++;});
      if(state.hold)await new Promise(resolve=>state.waiters.push(resolve));if(res.destroyed)return;
      const outputs=body.input.filter(item=>item.type==='function_call_output');const step=outputs.length;
      let name='list_files';let input={};
      if(step===1){name='read_files';const directory=JSON.parse(outputs[0].output);input={paths:['/src/App.tsx',...(directory.files.some(file=>file.path===quotePath)?[quotePath]:[])]};}
      else if(step>=2){name='submit_files';const read=JSON.parse(outputs.at(-1).output);let app=read.files.find(file=>file.path==='/src/App.tsx').content;
        if(!app.includes('import DeploymentQuote '))app="import DeploymentQuote from './generated/DeploymentQuote';\n"+app.replace('<Navbar />','<Navbar /><DeploymentQuote />');
        input={files:[{path:'/src/App.tsx',content:app},{path:quotePath,content:quoteCode()}]};}
      res.setHeader('content-type','application/json');res.end(JSON.stringify({id:'resp_deployment_fixture',object:'response',created_at:1790000000,status:'completed',model:'gpt-6.1-sol',output:[{type:'function_call',id:`fc_${step}`,call_id:`call_${step}`,name,arguments:JSON.stringify(input),status:'completed'}],usage:{input_tokens:12,output_tokens:7,total_tokens:19}}));
    }catch{if(!res.destroyed){res.statusCode=500;res.end('{}');}}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {state,origin:`http://127.0.0.1:${server.address().port}`,release(){state.hold=false;for(const resolve of state.waiters.splice(0))resolve();},async close(){this.release();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
