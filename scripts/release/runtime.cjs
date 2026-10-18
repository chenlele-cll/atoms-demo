const {spawn}=require('node:child_process');
const {setTimeout:delay}=require('node:timers/promises');
const {createWriteStream}=require('node:fs');
const {execFileSync}=require('node:child_process');
const {ownChild,signalOwned,groupAlive,processRows,descendants}=require('../verification/processes.cjs');
function runtime(check=()=>{}){
  const children=new Set();let counter=0;
  async function launch(command,args,cwd,env,log){
    check();const stream=createWriteStream(log,{flags:'a',mode:0o600});
    const child=spawn(command,args,{cwd,env,detached:true,stdio:['ignore','pipe','pipe']});children.add(child);
    child.on('error',()=>{});child.stdout.pipe(stream,{end:false});child.stderr.pipe(stream,{end:false});child.once('close',()=>stream.end());
    // nginx rewrites its process title during initialization; enroll its stable master identity.
    await delay(120);ownChild(child);counter++;return child;
  }
  async function stop(child,signal='SIGTERM'){
    if(!child)return;signalOwned(child,signal);const deadline=Date.now()+8000;let escalated=false;
    while(groupAlive(child)&&Date.now()<deadline){if(Date.now()>deadline-3000){escalated=true;signalOwned(child,'SIGKILL');}await delay(40);}
    if(groupAlive(child))throw Error('CLEANUP_INCOMPLETE');children.delete(child);return{escalated};
  }
  function assertListener(child,port,includeDescendants=false){
    const pids=execFileSync('lsof',['-nP',`-iTCP:${port}`,'-sTCP:LISTEN','-t'],{encoding:'utf8',timeout:2000}).trim().split(/\s+/).map(Number);
    const rows=processRows();const leader=rows.find(row=>row.pid===child.pid);
    const allowed=includeDescendants&&leader?descendants(rows,[leader]).map(row=>row.pid):[child.pid];
    if(!pids.length||pids.some(pid=>!allowed.includes(pid))||child.exitCode!==null||child.signalCode!==null)throw Error('PORT_OWNER_CHANGED');
  }
  async function ready(url,child){
    const deadline=Date.now()+30_000;const port=new URL(url).port;
    while(Date.now()<deadline){
      check();if(child.exitCode!==null||child.signalCode!==null)throw Error('STARTUP_FAILED');
      try{
        const response=await fetch(url,{signal:AbortSignal.timeout(500)});
        if(response.ok){
          const body=await response.json();
          if(body.status!=='ok'||body.service!=='atoms-backend')throw Error('HEALTH_BODY');
          assertListener(child,port);
          if(child.exitCode!==null||child.signalCode!==null)throw Error('STARTUP_FAILED');
          return;
        }
      }catch(error){if(['HEALTH_BODY','PORT_OWNER_CHANGED','STARTUP_FAILED'].includes(error.message))throw error;}
      await delay(100);
    }throw Error('READINESS_TIMEOUT');
  }
  return {children,launch,stop,ready,assertListener,get launches(){return counter;},async close(){const results=await Promise.allSettled([...children].reverse().map(child=>stop(child)));if(results.some(item=>item.status==='rejected'))throw Error('CLEANUP_INCOMPLETE');}};
}
module.exports={runtime};
