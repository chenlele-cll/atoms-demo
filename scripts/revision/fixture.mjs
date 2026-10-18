// Explicit test implementation for the loopback SDK transport only. Never use as live input.
const generatedPath = '/src/generated/RevisionStudio.tsx';
const wiringImport = "import RevisionStudio from './generated/RevisionStudio';\n";

export function files(stage, readFiles) {
  if (!['v1', 'v2', 'v3'].includes(stage)) throw Error('INVALID_STAGE');
  if (!Array.isArray(readFiles)) throw Error('READ_FILES_REQUIRED');
  const apps = readFiles.filter(file => file.path === '/src/App.tsx');
  if (apps.length !== 1 || typeof apps[0].content !== 'string' || !apps[0].content.trim()) throw Error('APP_READ_REQUIRED');
  const original = apps[0].content;
  let app = original;
  if (!app.includes(wiringImport)) {
    if ((app.match(/<Navbar\s*\/>/g) ?? []).length !== 1 || app.includes('RevisionStudio')) throw Error('UNSUPPORTED_APP');
    app = wiringImport + app.replace(/<Navbar\s*\/>/, '$&\n      <RevisionStudio />');
  } else if ((app.match(/<RevisionStudio\s*\/>/g) ?? []).length !== 1) throw Error('UNSUPPORTED_APP');

  // Select explicit stage code so restored V1 -> V3 cannot inherit V2's service.
  const service = {
    v1: { state: '', calculation: 'const supplement = 0;', control: '', result: '' },
    v2: {
      state: 'const [rush, setRush] = useState(false);',
      calculation: 'const supplement = rush ? base * 0.2 : 0;',
      control: '<label><input type="checkbox" checked={rush} onChange={event => setRush(event.target.checked)} />加急服务</label>',
      result: '<p role="status" aria-label="附加费用">{valid ? `${supplement} 元` : "请输入有效整数页数"}</p>',
    },
    v3: {
      state: 'const [maintenance, setMaintenance] = useState(false);',
      calculation: 'const supplement = maintenance ? 500 : 0;',
      control: '<label><input type="checkbox" checked={maintenance} onChange={event => setMaintenance(event.target.checked)} />维护服务</label>',
      result: '<p role="status" aria-label="附加费用">{valid ? `${supplement} 元` : "请输入有效整数页数"}</p>',
    },
  }[stage];
  const content = `// Explicit REV-005 loopback fixture: ${stage}.
import { useState } from 'react';
export default function RevisionStudio() {
  const [type, setType] = useState('企业官网');
  const [pages, setPages] = useState('1');
  const [industry, setIndustry] = useState('全部');
  ${service.state}
  const count = Number(pages);
  const valid = pages.trim() !== '' && Number.isInteger(count) && count >= 1 && count <= 20;
  const base = (type === '企业官网' ? 2000 : 5000) + count * 300;
  ${service.calculation}
  const items = [
    { title: '山海商店', industry: '零售' },
    { title: '星桥零售', industry: '零售' },
    { title: '云帆科技', industry: '科技' },
  ];
  return <section className="container py-12" style={{ maxWidth: '100%', boxSizing: 'border-box' }}>
    <h1 className="text-3xl font-bold">山海设计工作室</h1>
    <section aria-label="项目报价" className="grid gap-4 py-8">
      <h2 className="text-2xl font-semibold">项目报价</h2>
      <label>项目类型<select aria-label="项目类型" value={type} onChange={event => setType(event.target.value)} className="block border rounded p-2" style={{ maxWidth: '100%' }}>
        <option>企业官网</option><option>品牌电商</option>
      </select></label>
      <label>页面数量<input type="number" min="1" max="20" step="1" required value={pages} onChange={event => setPages(event.target.value)} aria-invalid={!valid} className="block border rounded p-2" style={{ width: '100%', maxWidth: '20rem' }} /></label>
      ${service.control}
      ${service.result}
      <p role="status" aria-label="预估报价">{valid ? String(base + supplement) + ' 元' : '请输入 1–20 的整数页数'}</p>
    </section>
    <section aria-label="精选案例" className="grid gap-4">
      <h2 className="text-2xl font-semibold">精选案例</h2>
      <label>案例行业<select aria-label="案例行业" value={industry} onChange={event => setIndustry(event.target.value)} className="block border rounded p-2" style={{ maxWidth: '100%' }}>
        <option>全部</option><option>零售</option><option>科技</option>
      </select></label>
      <div className="grid gap-4 md:grid-cols-3">{items.filter(item => industry === '全部' || item.industry === industry).map(item => <article key={item.title} className="border rounded p-4"><h3>{item.title}</h3><p>{item.industry}</p></article>)}</div>
    </section>
  </section>;
}
`;
  return [...(app === original ? [] : [{ path: '/src/App.tsx', content: app }]), { path: generatedPath, content }];
}
