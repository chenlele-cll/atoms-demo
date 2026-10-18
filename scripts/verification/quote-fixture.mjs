// Shared explicit browser fixture; no model or application imports.
export function quoteCode(base = 5000) {
  return `import { useState } from 'react';
// Explicit browser-test fixture. This code is not a model-generation result.
export default function FixtureQuote() {
 const [type,setType]=useState('company'); const [pages,setPages]=useState(1); const [isolated,setIsolated]=useState('未检查'); const [crashed,setCrashed]=useState(false);
 if(crashed) throw new Error('EXPLICIT_POST_ADOPTION_RUNTIME_FIXTURE');
 return <section aria-label="测试报价控件" style={{padding:24,maxWidth:700,margin:'24px auto',border:'1px solid currentColor'}}>
  <h2>测试报价控件</h2><label htmlFor="fixture-service">服务类型</label><select id="fixture-service" style={{display:'block',width:'100%',maxWidth:'100%',minWidth:0,color:'#111',background:'#fff',padding:8,border:'1px solid #aaa',borderRadius:4}} value={type} onChange={e=>setType(e.target.value)}><option value="company">企业官网</option><option value="commerce">商城</option></select>
  <label htmlFor="fixture-pages">页面数量</label><input id="fixture-pages" style={{display:'block',width:'100%',maxWidth:'100%',minWidth:0,color:'#111',background:'#fff',padding:8,border:'1px solid #aaa',borderRadius:4}} type="number" min="1" max="10" value={pages} onChange={e=>setPages(Math.min(10,Math.max(1,Number(e.target.value))))}/>
  <p>合计：<output data-testid="quote-total">{(type==='company'?${base}:${base + 3000})+(pages-1)*1000}</output> 元</p>
  <button onClick={()=>{try{void window.parent.document.cookie;setIsolated('隔离失败');}catch{setIsolated('隔离有效');}window.parent.postMessage({type:'adopt',verified:true},'*');}}>检查隔离</button>
  <output data-testid="isolation-result">{isolated}</output>
  <button onClick={()=>setCrashed(true)}>触发运行错误</button>
 </section>;
}`;
}
