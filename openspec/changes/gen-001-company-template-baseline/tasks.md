# Tasks

任务：`GEN-001`。本清单只覆盖一个企业官网模板的引入、隔离预览与基线验收；复选框与下方实测记录反映实际完成情况。需求见 [template-baseline](./specs/template-baseline/spec.md)，接入方案及测试矩阵见 [design.md](./design.md)。

## 1. Template assets and preparation

- [x] 1.1 GEN-001 从固定提交引入 `templates/company-landing/` 所需组件和资源，保留 MIT、清单与适配说明；逐文件核对上游提交、版权、来源校验值和选取范围，并将模板资产职责补入 Monorepo 文档。
- [x] 1.2 GEN-001 添加模板准备需要的精确开发依赖及 `prepare-company-template.mjs`，编译样式、处理资源和路径、输出固定依赖的完整文件集合；验证入口和资源引用可解析、输出无秘密与外部头像依赖，并确认重复准备的文件内容及标识一致。
- [x] 1.3 GEN-001 添加准备脚本的 Node 行为测试，覆盖缺少来源/许可/入口、非法路径、超限、稳定输出及失败时不发布半成品；接入前端 dev/build、忽略生成资产，并记录准备入口，执行新增 `pnpm test:template` 和资产缺失后的实际构建验证。

## 2. Baseline preview and browser checks

- [x] 2.1 GEN-001 引入固定 Sandpack 客户端并实现公开模板资产加载器及运行时解析，在 `/templates/company-landing` 提供最小基线页和首页链接；验证直接访问、刷新、来源/版本显示、非法 JSON/结构反馈，保持首页原有连接检查行为。
- [x] 2.2 GEN-001 通过隔离 iframe 运行模板文件，按实际编译事件实现加载、可运行、错误、截止时间和主动重试，清理旧请求及实例回调；用真实预览验证成功就绪、语法错误、预览服务不可达及故障移除后的恢复，并确认模板主题不会改变宿主。
- [x] 2.3 GEN-001 最小适配上游页面：保留导航、FAQ、主题和手机菜单，修正占位动作与缺失名称，移除 Newsletter 表单，主题改为实例内状态；在 1280px、320/375px 及键盘操作下验证主要交互、焦点、宿主/iframe 溢出和无虚假服务成功反馈，更新模板适配说明。
- [x] 2.4 GEN-001 使用已有 `playwright-core` 增加 `template-smoke.cjs` 和 `pnpm smoke:template`，自动执行设计中的正常与故障矩阵，包含开发和构建产物；验证失败返回非零、端口冲突不结束其他进程、所属进程及浏览器被清理，并同步 README 与 Verification 中的命令、前提和覆盖说明。

## 3. Integration verification and handoff

- [x] 3.1 GEN-001 更新唯一 lockfile 后执行 frozen install、`pnpm check` 和 `pnpm test:template`；核对宿主仍为 CSS Modules、上游依赖留在预览清单、模板源文件与生成资产分开维护，记录实际结果。
- [x] 3.2 GEN-001 运行 `pnpm smoke`（含构建）及随后运行的 `pnpm smoke:template`，在实际 dev 和本地 preview 中检查模板；对照规格记录交互、窄屏、资源/编译/网络故障与恢复证据，确认现有健康接口回归仍通过，产物仅写入忽略目录。
- [x] 3.3 GEN-001 核对 README、产品模板来源、Monorepo、Verification 与实际实现一致，执行本 change 严格校验、文档链接和差异检查；在本清单记录模板版本、已验证/未验证范围及供后续 GEN 子任务复用的文件集合，确认其他任务改动未被覆盖，不提交或推送。

## Implementation evidence

实施日期：2026-10-18。实际平台为 Darwin arm64，Node 22.22.2、pnpm 12.11.2、Google Chrome 155.0.8059.84；没有执行提交、推送、归档或服务器发布。

模板为 company-landing v1，固定来源 ae3716dbce5c8a26815222bb743994b5717938f1。39 个上游文件的原始 Git blob/SHA-256 均已逐项核对，MIT 正文原样保留；适配说明记录源码修改及新增本地头像。最终文件集合为 40 个虚拟文件、正文 339622 字节，SHA-256 为 `44e5ae3cc6ad1faf92e9000108279abe533b903dc7ea9b04124466690c2133e6`。

| 实际检查 | 观察结果 |
| --- | --- |
| pnpm install --frozen-lockfile | 通过；没有批准额外 Agent skills；es5-ext 无产物的提示脚本显式禁用 |
| pnpm check | lint、两应用类型检查及后端六项行为测试通过 |
| pnpm test:template | 28 项通过，含宿主路径拒绝、UTF-8 总量/数量、来源/许可/入口、导入、symlink、内容标识及原子输出保护 |
| 删除生成资产后 pnpm build | 正常重新准备模板并构建；没有人工恢复缓存文件 |
| pnpm smoke | 原有开发/构建连通、异常响应、后端离线恢复与 320/375/768/1280px 检查通过 |
| pnpm smoke:template | 13 个真实浏览器场景及端口占用/SIGINT/SIGTERM 三个控制场景通过；控制场景的预期非零与正常运行报告分别记录 |
| pnpm test:manager | 13 项（包含父测试）通过，约 131 秒；隔离副本携带模板源/准备脚本，不复制旧生成资产，正常起停和原有保护仍可用 |
| 交互复核 | 构建 preview 上检查价格导航、FAQ 展开/Space 收起、手机菜单/Escape 焦点恢复和主题；1280/375/320px 可读、无意外横向溢出；375px iframe 实宽 341，320px 实宽 286 |

预览状态严格使用对应客户端的真实编译结果；StrictMode 重放不重复创建活动客户端，初始化期间重试后的迟到实例会销毁。回归延迟实际 runtime 模块，核对旧 message 监听器不遗留；语法错误用内容标识正确的坏入口触发实际 bundler 错误，网络不可达等待真实 60 秒错误后主动重试，均不以假 ready 通过。

最终模板浏览器报告为 `test-results/template-baseline/d2d7da78-1df5-4422-97a6-aaa4ae0fb52c/report.json`，13 个场景 passed、cleanup passed，digest 与公开资源/dist 一致；语法错误还断言真实 bundler 的 show-error/compilatonError 事件，资源故障断言对应反馈且不创建 iframe，不以普通超时代替编译错误。进程控制测试另检查预期非零退出及最终报告。

实际截图在 `output/playwright/gen-001-desktop.png`、`output/playwright/gen-001-375.png`、`output/playwright/gen-001-320.png`；来源核对和手工观察在忽略的 `.runtime/gen-001/`。原始日志、截图、控制场景的失败/取消报告均保留在忽略目录，不随源码提交。

供后续任务复用：templates/company-landing/ 为固定源，templates/bundle.mjs（含类型声明）是纯文件集合校验/摘要，prepare-company-template.mjs 输出 frontend/public/template-assets/company-landing.bundle.json，构建复制到 frontend/dist/template-assets/。React 18 与精确直接依赖留在文件集合，宿主继续 React 19/CSS Modules；不从模板源导入 UI，也不需要后端运行。

范围与限制：只验证模板基线和当前 macOS 本地 dev/preview，未验证 Linux/Windows、外部网络长期可用性、Nginx/公网部署。Sandpack 及依赖下载仍需要网络；有非关键统计请求超时，未观察到应用未捕获异常。Vite 的 Sandpack 相关入口约 858kB，存在分包大小提示，本任务没有做性能优化。模型、数据库、生成、候选采用及完整 Top 1 均未实现或验收；其他 GEN 的任务状态未改动。

## Workflow follow-up

- 本 change 已按用户单独授权进入仓库 openspec-apply-change 实施；其余 GEN-002～010 保留各自提案及未完成实施项，不在本 change 扩展范围。
- 验证、规格同步和归档按后续请求分别执行；模板基线通过不能作为真实模型生成、持久化或完整 Top 1 已通过的证据。
