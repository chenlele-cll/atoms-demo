export const smokeCases = {
  quote: '保留企业官网的现有内容、布局和交互，在页面新增一个可见的中文报价估算器。服务类型可选网站设计（单价5000元）或品牌设计（单价3000元），数量1–10，加急勾选后加价20%，总价随输入即时更新。用紧凑的 /src/generated/QuoteEstimator.tsx 和普通 .css 实现，并修改已读的 /src/App.tsx 引入并展示它。新样式用独立普通CSS，不新增依赖、不改入口和预编译样式；只做这一小项，不声称真实付款或预览已验证。',
  filter: '保留企业官网原有内容和交互，新增一个可见的案例筛选区：全部、网站、品牌三个按钮，切换显示对应案例，并有当前分类和空列表提示。使用紧凑的 /src/generated/CaseFilter.tsx 及普通CSS，并修改已读的 /src/App.tsx 引入展示。保持入口、依赖、资源和预编译样式不变；只做这一小项，不声称已通过预览。',
} as const;
export type SmokeCase = keyof typeof smokeCases;
