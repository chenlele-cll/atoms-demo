const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const MODEL=/^[a-z0-9][a-z0-9._:/-]{0,127}$/;
const allowed=new Set(['event','requestAttemptId','step','configuredModel','responseModel','providerRequestId','httpStatus','durationMs','usage','errorCode','runId','projectId','requestId']);
export function observation(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.has(key))||Object.keys(value).length!==allowed.size)throw Error('OBSERVATION_SHAPE');
 for(const field of['requestAttemptId','runId','projectId','requestId'])if(!UUID.test(value[field]))throw Error('OBSERVATION_ID');
 if(!['dispatch','response','step-finished'].includes(value.event)||!Number.isInteger(value.step)||value.step<1||value.step>6||!MODEL.test(value.configuredModel)||value.configuredModel.startsWith('sk-')||value.responseModel!==null&&(!MODEL.test(value.responseModel)||value.responseModel.startsWith('sk-'))||value.providerRequestId!==null&&!/^req_[a-zA-Z0-9_-]{4,120}$/.test(value.providerRequestId)||value.httpStatus!==null&&(!Number.isInteger(value.httpStatus)||value.httpStatus<100||value.httpStatus>599)||!Number.isSafeInteger(value.durationMs)||value.durationMs<0||value.errorCode!==null&&!['configuration','authentication','model_access','quota_rate_limit','upstream','network','refusal','invalid_output','truncated','timeout','cancelled'].includes(value.errorCode))throw Error('OBSERVATION_SHAPE');
 if(value.usage!==null&&(typeof value.usage!=='object'||Object.keys(value.usage).sort().join(',')!=='inputTokens,outputTokens,totalTokens'||Object.values(value.usage).some(n=>n!==null&&(!Number.isSafeInteger(n)||n<0))))throw Error('OBSERVATION_USAGE');
 return value;
}
export function readObservations(log){if(Buffer.byteLength(log)>8*1024*1024)throw Error('OBSERVATION_SIZE');const events=[];for(const line of log.split('\n').filter(Boolean)){let entry;try{entry=JSON.parse(line);}catch{throw Error('OBSERVATION_LOG');}if(entry.modelObservation)events.push(observation(entry.modelObservation));}return events;}
export function metrics(events,context,complete=true){
 if(!['live','fixture'].includes(context.source))throw Error('OBSERVATION_ASSOCIATION');
 const matching=events.filter(event=>event.runId===context.runId);const attempts=new Map();
 for(const raw of matching){const e=observation(raw);if(e.projectId!==context.projectId||e.requestId!==context.requestId||e.configuredModel!==context.modelId)throw Error('OBSERVATION_ASSOCIATION');let a=attempts.get(e.requestAttemptId);if(!a){a={};attempts.set(e.requestAttemptId,a);}if(a[e.event])throw Error('OBSERVATION_DUPLICATE');a[e.event]=e;}
 const rows=[...attempts.values()].sort((a,b)=>(a.dispatch?.step??99)-(b.dispatch?.step??99));
 if(complete&&rows.length===0||rows.length>6)throw Error('OBSERVATION_COUNT');
 for(let i=0;i<rows.length;i++){const row=rows[i];if(!row.dispatch||row.dispatch.step!==i+1||Object.values(row).some(e=>e.step!==i+1)||complete&&(!row.response||row.response.httpStatus!==200||!row['step-finished']||row['step-finished'].errorCode!==null))throw Error('OBSERVATION_SEQUENCE');if(row.dispatch.httpStatus!==null||row.dispatch.providerRequestId!==null||row.dispatch.usage!==null)throw Error('OBSERVATION_CONTRADICTION');if(row.response&&row['step-finished']&&(row.response.httpStatus!==row['step-finished'].httpStatus||row.response.providerRequestId!==row['step-finished'].providerRequestId))throw Error('OBSERVATION_CONTRADICTION');}
 const knownPartial={inputTokens:0,outputTokens:0,totalTokens:0};const usage={inputTokens:0,outputTokens:0,totalTokens:0};const knownCounts={inputTokens:0,outputTokens:0,totalTokens:0};
 for(const row of rows)for(const key of Object.keys(usage)){const n=row['step-finished']?.usage?.[key];if(Number.isSafeInteger(n)&&n>=0){knownPartial[key]+=n;knownCounts[key]++;}else usage[key]=null;}
 for(const key of Object.keys(usage))usage[key]=knownCounts[key]===rows.length&&rows.length?knownPartial[key]:null;
 return{source:rows.length?context.source:'not-run',dispatched:rows.length,responses:rows.filter(row=>row.response).length,sdkFinished:rows.filter(row=>row['step-finished']&&!row['step-finished'].errorCode).length,usage,knownPartial,knownCounts,attempts:rows.map(row=>({attemptId:row.dispatch.requestAttemptId,step:row.dispatch.step,providerRequestId:row.response?.providerRequestId??null,responseModel:row['step-finished']?.responseModel??null}))};
}
