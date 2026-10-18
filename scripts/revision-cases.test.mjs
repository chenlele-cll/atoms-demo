import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { caseVersion, cases, quote, filter } from './revision/cases.mjs';
import { files } from './revision/fixture.mjs';
import { business, baselineInteractions, geometry } from './revision/browser.mjs';
import * as liveBrowser from './live/browser.mjs';

const appPath = '/src/App.tsx';
const componentPath = '/src/generated/RevisionStudio.tsx';
const template = await readFile(new URL('../templates/company-landing/src/App.tsx', import.meta.url), 'utf8');

test('versioned public cases describe three requirements without providing implementation', () => {
  assert.equal(caseVersion, 'rev005-v1');
  assert.deepEqual(cases.map(item => item.id), ['v1', 'v2', 'v3']);
  for (const item of cases) {
    assert.deepEqual(Object.keys(item).sort(), ['id', 'prompt', 'title']);
    assert.ok(item.title && item.prompt);
    assert.doesNotMatch(item.prompt, /export default|useState|RevisionStudio|```|<input|<select|function\s*\(/);
  }
  assert.match(cases[1].prompt, /20%/);
  assert.match(cases[2].prompt, /已恢复/);
  assert.match(cases[2].prompt, /不引入加急/);
});

test('independent fixed price oracle covers original, rush and restored maintenance stages', () => {
  for (const [type, pages, base] of [['企业官网', 1, 2300], ['企业官网', 4, 3200], ['品牌电商', 4, 6200]]) {
    assert.deepEqual(quote(type, pages), { base, supplement: 0, total: base });
    for (const stage of ['v1', 'v2', 'v3']) assert.deepEqual(quote(type, pages, stage), { base, supplement: 0, total: base });
  }
  assert.deepEqual(quote('企业官网', 4, 'v2', true), { base: 3200, supplement: 640, total: 3840 });
  assert.deepEqual(quote('品牌电商', 4, 'v2', true), { base: 6200, supplement: 1240, total: 7440 });
  assert.deepEqual(quote('企业官网', '4', 'v3', true), { base: 3200, supplement: 500, total: 3700 });
  assert.deepEqual(quote('品牌电商', 4, 'v3', true), { base: 6200, supplement: 500, total: 6700 });
  assert.deepEqual(quote('企业官网', 4, 'v1', true), { base: 3200, supplement: 0, total: 3200 });
  assert.deepEqual(quote('企业官网', 20), { base: 8000, supplement: 0, total: 8000 });
});

test('oracle rejects invalid pages and types in all stages, including when services are enabled', () => {
  for (const stage of ['v1', 'v2', 'v3']) {
    for (const extra of [false, true]) {
      for (const pages of ['', ' ', 'bad', 0, -1, 21, 1.5, NaN, Infinity, null, undefined, true, [], {}]) {
        assert.equal(quote('企业官网', pages, stage, extra), null);
      }
      assert.equal(quote('unknown', 4, stage, extra), null);
    }
  }
  assert.throws(() => quote('企业官网', 4, 'v4'), /INVALID_STAGE/);
});

test('industry oracle returns exact case sets and fresh arrays for round trips', () => {
  assert.deepEqual(filter(), ['山海商店', '星桥零售', '云帆科技']);
  assert.deepEqual(filter('零售'), ['山海商店', '星桥零售']);
  assert.deepEqual(filter('科技'), ['云帆科技']);
  filter().pop();
  assert.deepEqual(filter('全部'), ['山海商店', '星桥零售', '云帆科技']);
  assert.throws(() => filter('unknown'), /INVALID_FILTER/);
});

test('template has no business controls; fixture preserves every original App byte around its insertion', () => {
  for (const label of ['项目类型', '页面数量', '案例行业', '加急服务', '维护服务']) assert.ok(!template.includes(label));
  const readFiles = [{ path: appPath, content: template }, { path: '/package.json', content: 'dependency sentinel' }];
  const before = structuredClone(readFiles);
  const result = files('v1', readFiles);
  assert.deepEqual(readFiles, before);
  assert.deepEqual(result.map(file => file.path), [appPath, componentPath]);
  const app = result[0].content;
  assert.equal(app.replace("import RevisionStudio from './generated/RevisionStudio';\n", '').replace('\n      <RevisionStudio />', ''), template);
  assert.ok(app.includes('<Navbar />') && app.includes('<FAQ />'));
  for (const stage of ['v2', 'v3']) {
    const updated = files(stage, [{ path: appPath, content: app }]);
    assert.deepEqual(updated.map(file => file.path), [componentPath]);
    assert.deepEqual(files(stage, readFiles).map(file => file.path), [appPath, componentPath]);
  }
});

test('fixture refuses missing reads, ambiguous App or unsupported wiring before submitting files', () => {
  assert.throws(() => files('v0', []), /INVALID_STAGE/);
  assert.throws(() => files('v1', {}), /READ_FILES_REQUIRED/);
  for (const readFiles of [[], [{ path: appPath, content: '' }], [{ path: appPath, content: template }, { path: appPath, content: template }]]) {
    assert.throws(() => files('v1', readFiles), /APP_READ_REQUIRED/);
  }
  assert.throws(() => files('v1', [{ path: appPath, content: '<FAQ />' }]), /UNSUPPORTED_APP/);
});

// Execute only our explicit fixture with a small hook/JSX adapter, without a browser or network.
function fixtureRender(stage) {
  const content = files(stage, [{ path: appPath, content: template }]).find(file => file.path === componentPath).content;
  const compiled = ts.transpileModule(content, {
    fileName: 'RevisionStudio.tsx', reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  assert.deepEqual(compiled.diagnostics, [], 'Fixture TSX syntax must transpile');
  const states = [];
  let cursor = 0;
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  runInNewContext(compiled.outputText, { exports, require(name) {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    assert.equal(name, 'react');
    return { useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], value => { states[index] = value; }];
    } };
  } });
  function nodes(node) {
    if (Array.isArray(node)) return node.flatMap(nodes);
    return node && typeof node === 'object' ? [node, ...nodes(node.props.children)] : [];
  }
  function text(node) {
    if (Array.isArray(node)) return node.map(text).join('');
    return node && typeof node === 'object' ? text(node.props.children) : String(node ?? '');
  }
  let tree;
  const render = () => { cursor = 0; tree = exports.default(); };
  render();
  return {
    content,
    labels: () => nodes(tree).filter(node => node.type === 'label').map(text),
    change(label, value) {
      const parent = nodes(tree).find(node => node.type === 'label' && text(node).startsWith(label));
      assert.ok(parent, `Label exists: ${label}`);
      const control = nodes(parent).find(node => ['input', 'select'].includes(node.type));
      control.props.onChange({ target: { value: String(value), checked: value } });
      render();
    },
    result: label => text(nodes(tree).find(node => node.props.role === 'status' && node.props['aria-label'] === label)),
    titles: () => nodes(tree).filter(node => node.type === 'h3').map(text),
  };
}

for (const stage of ['v1', 'v2', 'v3']) test(`${stage} fixture interacts against independent price/filter oracles without a model`, () => {
  const fixture = fixtureRender(stage);
  const service = stage === 'v2' ? '加急服务' : '维护服务';
  assert.equal(fixture.labels().includes('加急服务'), stage === 'v2');
  assert.equal(fixture.labels().includes('维护服务'), stage === 'v3');
  assert.equal(fixture.result('预估报价'), '2300 元');
  if (stage === 'v3') assert.doesNotMatch(fixture.content, /加急|rush/);
  for (const type of ['企业官网', '品牌电商']) {
    fixture.change('项目类型', type);
    for (const pages of [1, 4, 20]) {
      fixture.change('页面数量', pages);
      for (const extra of stage === 'v1' ? [false] : [false, true, false]) {
        if (stage !== 'v1') fixture.change(service, extra);
        const expected = quote(type, pages, stage, extra);
        assert.equal(fixture.result('预估报价'), `${expected.total} 元`);
        assert.equal(fixture.result('附加费用'), stage === 'v1' ? '' : `${expected.supplement} 元`);
      }
    }
  }
  if (stage !== 'v1') fixture.change(service, true);
  for (const invalid of ['', '0', '-1', '21', '1.5', 'bad']) {
    fixture.change('页面数量', invalid);
    assert.match(fixture.result('预估报价'), /请输入/);
    assert.doesNotMatch(fixture.result('预估报价'), /NaN|Infinity/);
    if (stage !== 'v1') assert.equal(fixture.result('附加费用'), '请输入有效整数页数');
  }
  fixture.change('页面数量', 4);
  for (const industry of ['全部', '零售', '科技', '全部']) {
    fixture.change('案例行业', industry);
    assert.deepEqual(fixture.titles(), filter(industry));
  }
});

test('browser helper shares live baseline and geometry, rejects unknown stage before touching page', async () => {
  assert.equal(baselineInteractions, liveBrowser.baselineInteractions);
  assert.equal(geometry, liveBrowser.geometry);
  await assert.rejects(business({}, 'v4'), /Known revision stage/);
});
