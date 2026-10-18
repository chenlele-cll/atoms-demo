/* global document */
// Concrete, shared browser assertions. Lifecycle remains with each calling runner.
const assert = require('node:assert/strict');
async function api(page, method, url, body) {
  return page.evaluate(async input => {
    const response = await fetch(input.url, { method: input.method, credentials: 'same-origin',
      ...(input.body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(input.body) }), signal: AbortSignal.timeout(10_000) });
    return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
  }, { method, url, body });
}
async function waitCompiled(page) {
  await page.waitForFunction(() => ['compiled','compileError','runtimeError','timeout'].includes(document.querySelector('[data-preview-state]')?.getAttribute('data-preview-state')), undefined, { timeout: 70_000 });
  assert.equal(await page.locator('[data-preview-state]').getAttribute('data-preview-state'),'compiled',await page.locator('[data-preview-state]').textContent());
  return page.frameLocator('iframe');
}
async function taskFinished(page, status) {
  await page.locator('[data-task-phase="terminal"]').waitFor({timeout:15_000});
  if(status)assert.match(await page.locator('[data-task-phase]').textContent(),status);
}
async function createViaForm(page,title,prompt) {
  await page.getByLabel('项目名称',{exact:false}).fill(title);
  await page.getByRole('textbox',{name:'你想创建什么？',exact:true}).fill(prompt);
  await page.locator('button[type="submit"]:not(:disabled)').waitFor();
  await page.getByRole('button',{name:'创建并生成',exact:true}).click();
  await page.waitForURL(/\/projects\/[a-f0-9-]+$/,{timeout:10_000});return page.url().split('/').at(-1);
}
async function assertQuote(page,base=5000) {
  const frame=page.frameLocator('iframe');assert.equal(await frame.getByTestId('quote-total').textContent(),String(base));
  await frame.getByLabel('页面数量',{exact:true}).fill('3');assert.equal(await frame.getByTestId('quote-total').textContent(),String(base+2000));
  await frame.getByLabel('服务类型',{exact:true}).selectOption('commerce');assert.equal(await frame.getByTestId('quote-total').textContent(),String(base+5000));
}
module.exports={api,waitCompiled,taskFinished,createViaForm,assertQuote};
