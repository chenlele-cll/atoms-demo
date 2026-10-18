# Tasks

任务：`GEN-001`。本清单只覆盖一个企业官网模板的引入、隔离预览与基线验收；所有项目功能均待实施，复选框保持未完成。需求见 [template-baseline](./specs/template-baseline/spec.md)，接入方案及测试矩阵见 [design.md](./design.md)。

## 1. Template assets and preparation

- [ ] 1.1 GEN-001 从固定提交引入 `templates/company-landing/` 所需组件和资源，保留 MIT、清单与适配说明；逐文件核对上游提交、版权、来源校验值和选取范围，并将模板资产职责补入 Monorepo 文档。
- [ ] 1.2 GEN-001 添加模板准备需要的精确开发依赖及 `prepare-company-template.mjs`，编译样式、处理资源和路径、输出固定依赖的完整文件集合；验证入口和资源引用可解析、输出无秘密与外部头像依赖，并确认重复准备的文件内容及标识一致。
- [ ] 1.3 GEN-001 添加准备脚本的 Node 行为测试，覆盖缺少来源/许可/入口、非法路径、超限、稳定输出及失败时不发布半成品；接入前端 dev/build、忽略生成资产，并记录准备入口，执行新增 `pnpm test:template` 和资产缺失后的实际构建验证。

## 2. Baseline preview and browser checks

- [ ] 2.1 GEN-001 引入固定 Sandpack 客户端并实现公开模板资产加载器及运行时解析，在 `/templates/company-landing` 提供最小基线页和首页链接；验证直接访问、刷新、来源/版本显示、非法 JSON/结构反馈，保持首页原有连接检查行为。
- [ ] 2.2 GEN-001 通过隔离 iframe 运行模板文件，按实际编译事件实现加载、可运行、错误、截止时间和主动重试，清理旧请求及实例回调；用真实预览验证成功就绪、语法错误、预览服务不可达及故障移除后的恢复，并确认模板主题不会改变宿主。
- [ ] 2.3 GEN-001 最小适配上游页面：保留导航、FAQ、主题和手机菜单，修正占位动作与缺失名称，移除 Newsletter 表单，主题改为实例内状态；在 1280px、320/375px 及键盘操作下验证主要交互、焦点、宿主/iframe 溢出和无虚假服务成功反馈，更新模板适配说明。
- [ ] 2.4 GEN-001 使用已有 `playwright-core` 增加 `template-smoke.cjs` 和 `pnpm smoke:template`，自动执行设计中的正常与故障矩阵，包含开发和构建产物；验证失败返回非零、端口冲突不结束其他进程、所属进程及浏览器被清理，并同步 README 与 Verification 中的命令、前提和覆盖说明。

## 3. Integration verification and handoff

- [ ] 3.1 GEN-001 更新唯一 lockfile 后执行 frozen install、`pnpm check` 和 `pnpm test:template`；核对宿主仍为 CSS Modules、上游依赖留在预览清单、模板源文件与生成资产分开维护，记录实际结果。
- [ ] 3.2 GEN-001 运行 `pnpm smoke`（含构建）及随后运行的 `pnpm smoke:template`，在实际 dev 和本地 preview 中检查模板；对照规格记录交互、窄屏、资源/编译/网络故障与恢复证据，确认现有健康接口回归仍通过，产物仅写入忽略目录。
- [ ] 3.3 GEN-001 核对 README、产品模板来源、Monorepo、Verification 与实际实现一致，执行本 change 严格校验、文档链接和差异检查；在本清单记录模板版本、已验证/未验证范围及供后续 GEN 子任务复用的文件集合，确认其他任务改动未被覆盖，不提交或推送。

## Workflow follow-up

- 本轮只交付提案、规格、设计和未完成的实施任务；进入实施时单独使用仓库 `openspec-apply-change` 工作流处理本 change。
- 完成本子任务的运行验收后，再按父级拆解单独规划 `GEN-002` 或其他已满足依赖的子任务；不在本 change 扩展其范围。
- 验证、规格同步和归档按后续请求分别执行；模板基线通过不能作为真实模型生成、持久化或完整 Top 1 已通过的证据。
