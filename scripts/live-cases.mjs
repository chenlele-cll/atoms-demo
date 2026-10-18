// Public requirements and independent business oracles; no generated component implementation.
export const cases = Object.freeze([
  {id:'studio',version:1,title:'山海设计工作室',prompt:`将现有企业官网改为“山海设计工作室”官网，保留并协调原有导航、服务、套餐和 FAQ，沿用模板的视觉层次与响应式样式，不新增依赖，不实现咨询发送、支付或预约。
新增明显且完整美观的“项目报价”区：有可访问 label“项目类型”的原生 select，选项“企业官网”“品牌电商”；label“页面数量”的 number 输入，整数 1–20，默认 1；用名为“预估报价”的结果区（role=status，aria-label=预估报价）显示报价。官网基础 2000 元、电商基础 5000 元，每页加 300 元。默认官网 1 页 2300 元，官网 4 页 3200 元，电商 4 页 6200 元。空值、0、21、非整数不能显示 NaN、负数或伪装有效的错误报价；用明确校验或原生约束反馈。
新增名为“精选案例”的 region（aria-label=精选案例），包含 label“案例行业”的 select：全部、零售、科技。每个案例用 article，标题分别为“山海商店”“星桥零售”（零售）和“云帆科技”（科技）。默认全部 3 项，零售 2 项，科技 1 项；筛选会真实改变可见卡片，切回全部恢复。新增区块在手机上可发现、控件标签和结果清晰。业务数据仅为浏览器内演示，不发送网络请求。
请先查看模板文件，使用允许的工具读取实际文件并完整提交修改；不要删去原网站主要内容，不要只生成说明。`},
  {id:'schedule',version:1,title:'山海公开课',prompt:`在现有企业官网模板上制作“山海公开课”介绍页，保留原有导航、服务、套餐和 FAQ，沿用模板视觉与响应式样式，不新增依赖，不实现真实预约或支付。
新增名为“活动日程”的 region（aria-label=活动日程），有两个带可访问 label 的原生 select：“活动领域”（全部、设计、产品）和“活动形式”（全部、线上、线下），默认均为全部。每条活动用 article，标题与数据：设计入门＝设计/线上，视觉实践＝设计/线上，品牌分享＝设计/线下，产品工作坊＝产品/线下。
筛选必须按 AND 组合真实改变可见条目；用 role=status、aria-label=活动数量 的结果区显示当前数量。默认 4，选择设计 3，设计+线上 2，产品+线上 0，此时显示“暂无活动”；切回全部+全部恢复 4。新增区块样式完整，桌面和手机无横向溢出，标签、数量和空状态清楚。数据仅为浏览器内演示，不发送网络请求。
先查看模板文件，用允许工具读取实际文件，再完整提交修改；不删原主要内容，不只返回说明。`},
]);
export const studioItems=Object.freeze([{title:'山海商店',industry:'零售'},{title:'星桥零售',industry:'零售'},{title:'云帆科技',industry:'科技'}]);
export const scheduleItems=Object.freeze([{title:'设计入门',field:'设计',format:'线上'},{title:'视觉实践',field:'设计',format:'线上'},{title:'品牌分享',field:'设计',format:'线下'},{title:'产品工作坊',field:'产品',format:'线下'}]);
export function quote(type,pages){const n=Number(pages);if(!['企业官网','品牌电商'].includes(type)||String(pages).trim()===''||!Number.isInteger(n)||n<1||n>20)return null;return(type==='企业官网'?2000:5000)+300*n;}
export function studioFilter(industry='全部'){if(!['全部','零售','科技'].includes(industry))throw Error('INVALID_FILTER');return studioItems.filter(item=>industry==='全部'||item.industry===industry).map(item=>item.title);}
export function scheduleFilter(field='全部',format='全部'){if(!['全部','设计','产品'].includes(field)||!['全部','线上','线下'].includes(format))throw Error('INVALID_FILTER');return scheduleItems.filter(item=>(field==='全部'||item.field===field)&&(format==='全部'||item.format===format)).map(item=>item.title);}
