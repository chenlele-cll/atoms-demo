/* global document, window */
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {quote,studioFilter,scheduleFilter,studioItems,scheduleItems} from '../live-cases.mjs';
async function settles(work){let last;const deadline=Date.now()+4000;do{try{return await work();}catch(error){last=error;await delay(50);}}while(Date.now()<deadline);throw last;}
const numbers=text=>(text.replaceAll(',','').match(/\d+(?:\.\d+)?/g)??[]).map(Number);
export async function prepareCreation(page,prompt,readProjects){
 await page.getByRole('textbox',{name:'你想创建什么？',exact:true}).fill(prompt);
 // An enabled submit proves both the author session and template have loaded.
 await page.locator('button[type="submit"]:not(:disabled)').waitFor();
 if(readProjects){const response=await readProjects();assert.equal(response.status,200,'Author session must be ready');assert.ok(Array.isArray(response.body.items),'Project list must match the HTTP contract');assert.equal(response.body.items.length,0);}
}
async function select(frame,label,value){await frame.getByLabel(label,{exact:true}).selectOption({label:value});}
async function titles(region,all){const articles=region.locator('article:visible');const values=await articles.allTextContents();return values.map(text=>{const found=all.filter(item=>text.includes(item.title));assert.equal(found.length,1,'Each visible card identifies one public item');return found[0].title;}).sort();}
export async function business(page,id){
 const frame=page.frameLocator('iframe');
 if(id==='studio'){
  const total=frame.getByRole('status',{name:'预估报价',exact:true});const pages=frame.getByLabel('页面数量',{exact:true});
  for(const[type,n]of[['企业官网',1],['企业官网',4],['品牌电商',4]]){await select(frame,'项目类型',type);await pages.fill(String(n));await pages.press('Tab');await settles(async()=>assert.deepEqual(numbers(await total.innerText()),[quote(type,n)]));}
  for(const invalid of['','0','21','1.5']){await pages.fill(invalid);await pages.press('Tab');await settles(async()=>{const state=await pages.evaluate(element=>({value:element.value,valid:element.validity.valid}));const text=await total.innerText();assert.ok(!/NaN|Infinity|[-−]\s*\d/.test(text));const values=numbers(text);const corrected=quote('品牌电商',state.value);const raw=5000+Number(invalid)*300;const clear=/请输入|无效|有效|整数|范围|错误|1\s*[–—-]\s*20/.test(text);assert.ok(clear||!values.length||corrected!==null&&values.length===1&&values[0]===corrected||!state.valid&&values.length===1&&values[0]===6200&&raw!==6200,'Invalid pages must not produce a valid-looking invalid quote');});}
  await pages.fill('1');await select(frame,'项目类型','企业官网');await settles(async()=>assert.deepEqual(numbers(await total.innerText()),[2300]));
  const region=frame.getByRole('region',{name:'精选案例',exact:true});for(const industry of['全部','零售','科技','全部']){await select(frame,'案例行业',industry);await settles(async()=>assert.deepEqual(await titles(region,studioItems),studioFilter(industry).sort()));}
 }else{
  const region=frame.getByRole('region',{name:'活动日程',exact:true});const count=frame.getByRole('status',{name:'活动数量',exact:true});for(const[field,format]of[['全部','全部'],['设计','全部'],['设计','线上'],['产品','线上'],['全部','全部']]){await select(frame,'活动领域',field);await select(frame,'活动形式',format);const expected=scheduleFilter(field,format);await settles(async()=>{assert.deepEqual(await titles(region,scheduleItems),expected.sort());assert.deepEqual(numbers(await count.innerText()),[expected.length]);if(!expected.length)assert.equal(await region.getByText('暂无活动',{exact:true}).isVisible(),true);});}
 }
}
export async function baselineInteractions(page){const frame=page.frameLocator('iframe');const faq=frame.locator('#faq');await faq.waitFor();const trigger=faq.getByRole('button').first();const expanded=await trigger.getAttribute('aria-expanded');assert.ok(['true','false'].includes(expanded));await trigger.click();assert.notEqual(await trigger.getAttribute('aria-expanded'),expanded);await trigger.click();assert.equal(await trigger.getAttribute('aria-expanded'),expanded);assert.ok(await frame.locator('nav').count()>0);}
export async function geometry(page,width){
 await page.setViewportSize({width,height:900});
 const host=await page.evaluate(()=>({width:window.innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(host.scroll<=host.width+1);
 const iframe=page.locator('iframe');const bounds=await iframe.boundingBox();assert.ok(bounds&&bounds.width>250&&bounds.width<=width+1);
 const inside=await iframe.contentFrame().locator('body').evaluate(element=>({scroll:Math.max(element.scrollWidth,element.ownerDocument.documentElement.scrollWidth),width:element.ownerDocument.defaultView.innerWidth}));assert.ok(inside.scroll<=inside.width+1,JSON.stringify(inside));
 return{viewportWidth:width,hostWidth:host.width,hostScroll:host.scroll,iframeWidth:bounds.width,frameWidth:inside.width,frameScroll:inside.scroll};
}
