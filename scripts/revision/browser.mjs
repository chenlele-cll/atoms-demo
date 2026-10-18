import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { business as studioBusiness, baselineInteractions } from '../live/browser.mjs';
import { quote } from './cases.mjs';

export { baselineInteractions, geometry } from '../live/browser.mjs';

const numbers = text => (text.replaceAll(',', '').match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
async function settles(work) {
  let last;
  const deadline = Date.now() + 4000;
  do {
    try { return await work(); } catch (error) { last = error; await delay(50); }
  } while (Date.now() < deadline);
  throw last;
}

export async function business(page, stage) {
  assert.ok(['v1', 'v2', 'v3'].includes(stage), 'Known revision stage required');
  const frame = page.frameLocator('iframe');
  for (const [label, present] of [['加急服务', stage === 'v2'], ['维护服务', stage === 'v3']]) {
    assert.equal(await frame.getByLabel(label, { exact: true }).count(), present ? 1 : 0, `${stage}: ${label}`);
    if (present) {
      const control = frame.getByRole('checkbox', { name: label, exact: true });
      assert.equal(await control.isChecked(), false, 'New preview starts with service disabled');
    }
  }
  const supplement = frame.getByRole('status', { name: '附加费用', exact: true });
  if (stage === 'v1') assert.equal(await supplement.count(), 0, 'V1 has no additional fee');
  // Reuse the live studio checks for original prices, invalid pages and exact industry sets.
  await studioBusiness(page, 'studio');
  await baselineInteractions(page);
  if (stage === 'v1') return;

  const service = frame.getByRole('checkbox', { name: stage === 'v2' ? '加急服务' : '维护服务', exact: true });
  const pages = frame.getByLabel('页面数量', { exact: true });
  const total = frame.getByRole('status', { name: '预估报价', exact: true });
  for (const type of ['企业官网', '品牌电商']) {
    await frame.getByLabel('项目类型', { exact: true }).selectOption({ label: type });
    await pages.fill('4');
    await pages.press('Tab');
    for (const enabled of [false, true, false]) {
      await service.setChecked(enabled);
      const expected = quote(type, 4, stage, enabled);
      await settles(async () => {
        assert.deepEqual(numbers(await supplement.innerText()), [expected.supplement]);
        assert.deepEqual(numbers(await total.innerText()), [expected.total]);
      });
    }
  }
  await service.check();
  const lastValid = quote('品牌电商', 4, stage, true);
  for (const invalid of ['', '0', '-1', '21', '1.5']) {
    await pages.fill(invalid);
    await pages.press('Tab');
    await settles(async () => {
      const state = await pages.evaluate(element => ({ value: element.value, valid: element.validity.valid }));
      const corrected = quote('品牌电商', state.value, stage, true);
      for (const [result, key] of [[total, 'total'], [supplement, 'supplement']]) {
        const text = await result.innerText();
        assert.ok(!/NaN|Infinity|[-−]\s*\d/.test(text), 'No invalid numeric output');
        const values = numbers(text);
        const feedback = /请输入|无效|有效|整数|范围|错误|1\s*[–—-]\s*20/.test(text);
        assert.ok(feedback || values.length === 0 ||
          corrected !== null && values.length === 1 && values[0] === corrected[key] ||
          !state.valid && values.length === 1 && values[0] === lastValid[key],
        'Invalid pages must have feedback, correction or an unchanged result with native invalidity');
      }
    });
  }
  await pages.fill('1');
  await frame.getByLabel('项目类型', { exact: true }).selectOption({ label: '企业官网' });
  await service.uncheck();
  await settles(async () => {
    assert.deepEqual(numbers(await total.innerText()), [2300]);
    assert.deepEqual(numbers(await supplement.innerText()), [0]);
  });
}
