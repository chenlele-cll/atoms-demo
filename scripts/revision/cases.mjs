// Public live requirements and independent oracles. Implementation belongs only in the loopback fixture.
export const caseVersion = 'rev005-v1';
export const cases = Object.freeze([
  Object.freeze({ id: 'v1', title: '山海设计工作室报价', prompt: `将现有企业官网改为“山海设计工作室”官网，保留原有导航、服务、套餐和 FAQ，沿用模板视觉和响应式样式，不新增依赖，不实现咨询发送、支付或预约。
新增“项目报价”：原生 select 的可访问 label 为“项目类型”，选项为“企业官网”“品牌电商”；number 输入 label 为“页面数量”，只接受 1–20 的整数，默认 1。官网基础 2000 元、电商基础 5000 元，每页加 300 元；官网 1/4 页分别为 2300/3200 元，电商 4 页为 6200 元。结果用 role=status、aria-label=预估报价 显示。空值、0、21、负数、非整数需要明确校验或原生约束反馈，不能出现 NaN、负报价或看似有效的非法报价。此版本没有加急或维护服务。
新增 aria-label=精选案例 的 region，包含 label“案例行业”的原生 select，选项为“全部”“零售”“科技”。每个案例用 article，标题“山海商店”“星桥零售”属于零售，“云帆科技”属于科技。默认全部 3 项，零售 2 项，科技 1 项，切回全部恢复。桌面和手机上标签、报价、筛选清楚且无横向溢出。数据仅供浏览器内演示，不发送网络请求。
先用允许的工具读取实际模板文件，再完整提交修改；保留原网站主要内容，不只返回说明。` }),
  Object.freeze({ id: 'v2', title: '增加加急服务', prompt: `在当前已采用的设计工作室报价版本上，增加 label 为“加急服务”的复选框，默认关闭。勾选后附加费为原基础报价的 20%，用 role=status、aria-label=附加费用 单列；role=status、aria-label=预估报价 显示包含附加费的总额。企业官网 4 页原报价为 3200 元，开启后附加 640 元、总额 3840 元，关闭后附加 0 元、总额恢复 3200 元。基础报价仍为官网 2000、电商 5000，每页 300；不增加维护服务。
保留项目类型、页面数量及其非法输入反馈、精选案例与行业筛选、原导航、服务、套餐和 FAQ，沿用现有样式与手机布局，不新增依赖或网络请求。先读取实际当前文件，完整提交修改。` }),
  Object.freeze({ id: 'v3', title: '恢复后增加维护服务', prompt: `在当前已恢复的设计工作室报价版本上增加维护服务：label 为“维护服务”的复选框，默认关闭，勾选后固定加 500 元，用 role=status、aria-label=附加费用 单列费用，role=status、aria-label=预估报价 显示总额。不引入加急服务或按比例加急附加费。
保留官网基础 2000、电商基础 5000、每页 300 的规则；企业官网 4 页关闭维护为 3200 元，开启为 3700 元，品牌电商 4 页开启为 6700 元。保留 label“项目类型”“页面数量”“案例行业”，原非法页数反馈、精选案例与全部/零售/科技筛选、原导航、服务、套餐和 FAQ，不新增依赖或网络请求，桌面和手机均可操作。先读取当前实际文件，完整提交修改。` }),
]);

export function quote(type, pages, stage = 'v1', extra = false) {
  if (!['v1', 'v2', 'v3'].includes(stage)) throw Error('INVALID_STAGE');
  if (!['企业官网', '品牌电商'].includes(type) || !['number', 'string'].includes(typeof pages) ||
      String(pages).trim() === '') return null;
  const count = Number(pages);
  if (!Number.isInteger(count) || count < 1 || count > 20) return null;
  const base = (type === '企业官网' ? 2000 : 5000) + count * 300;
  const supplement = extra && stage === 'v2' ? base * 0.2 : extra && stage === 'v3' ? 500 : 0;
  return { base, supplement, total: base + supplement };
}

export function filter(industry = '全部') {
  if (!['全部', '零售', '科技'].includes(industry)) throw Error('INVALID_FILTER');
  return industry === '零售' ? ['山海商店', '星桥零售'] : industry === '科技' ? ['云帆科技'] : ['山海商店', '星桥零售', '云帆科技'];
}
