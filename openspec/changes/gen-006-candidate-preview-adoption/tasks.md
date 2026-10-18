# Tasks

范围见 [proposal.md](./proposal.md)，实现方案见 [design.md](./design.md)，行为验收见 [candidate-review](./specs/candidate-review/spec.md)。以下均待实施；规划结构通过不代表预览或采用已运行。依赖 GEN-001、003～005 的实际能力，保留其他 change 的修改；此项用明确测试候选完成真实编译/交互，真实模型与最终部署由 GEN-010/009 验收。

## 1. 共用契约与构建前提

- [ ] 1.1 GEN-006 新增最小 `@atoms/contracts` workspace，提取实际共用的项目/版本/快照/采用/安全错误 schema，前后端显式依赖同一权威定义；保留私有模型与存储实现。验证：包输出 ESM/声明、两应用类型检查通过，同一输入的边界校验一致，浏览器构建无 Node/后端实现依赖；更新 Monorepo 与 Development 的包和契约归属。
- [ ] 1.2 GEN-006 接入有界且串行的契约准备入口，根 check、两应用独立 dev/build/typecheck/test 自动准备缺失或过期产物；更新必要 workspace、lint、隔离副本和依赖诊断。验证：frozen install 后删除隔离副本生成产物，两应用独立/并发启动、重复准备、源码变化、准备失败阻止启动和必要部署副本均正确；副本不复制真实环境/数据库/node_modules，更新 README、Lifecycle、Verification 的实际前提。

## 2. 版本读取与采用事务

- [ ] 2.1 GEN-006 实现有归属的版本 GET、完整快照/摘要校验、实际修改列表与采用可用性，覆盖模板及生成版本。验证：后端 injection 与真实文件测试覆盖 A/B 会话、跨项目/不存在同形 404、非法 ID、损坏记录、不重建模板、no-store 与正文不进入错误/日志；更新 README 的读取契约。
- [ ] 2.2 GEN-006 实现严格采用 POST、成功运行关联、parent/expected 检查、活动/孤立 running 拒绝及当前引用 CAS，合法重复目标不再写入。验证：临时 SQLite 覆盖同父候选竞争仅一个成功、不同会话/Origin 拒绝、verified 等额外字段 400、故障回滚、重开保留、无模型调用与快照不变；同步 Development 的采用语义和 README 的冲突/幂等结果。

## 3. 预览状态与隔离组件

- [ ] 3.1 GEN-006 实现项目/版本/摘要/attempt 绑定的预览状态机与采用状态分离，明确 done、错误锁定、超时、旧事件和文档重载规则；为前端显式加入固定 tsx/Node 测试入口并纳入根 test/check。验证：纯逻辑测试覆盖 connected/load 不成功、旧实例/超时后 done 无效、运行错误禁用、重试新实例与清理；更新 Development 和 Verification 的状态及测试覆盖。
- [ ] 3.2 GEN-006 从 GEN-001 抽取 SnapshotPreview 并由模板页复用，使用固定依赖、当前 client 监听和受限跨源 iframe，不补默认样例或传递平台秘密。验证：实际 Sandpack 编译/交互、真实语法/运行错误、外部 bundler 阻断、重试与清理；GEN-001 浏览器回归保持通过，检查实际解析 SDK/iframe 属性及宿主样式隔离；README 说明外部预览前提和临时输入重置。

## 4. HTTP 客户端与候选检查页

- [ ] 4.1 GEN-006 实现版本/项目读取及采用客户端，使用共用 schema、相对 API、10 秒截止、响应体/快照上限、摘要校验和取消。验证：前端 Node 测试覆盖 HTTP/JSON/schema/摘要失败、响应超限、取消及错误纯文本处理，不断言未知数据类型或读取 cookie 凭据；同步 Development 的边界处理规则。
- [ ] 4.2 GEN-006 新增候选检查页与直接 URL、版本/来源/修改路径、当前/候选切换、重试与明确采用，首页/模板页继续工作。建立 `scripts/candidate-smoke.cjs`、计划命令 `pnpm smoke:candidate` 及明确测试候选，首先覆盖真实报价控件、采用前无写入、编译错误禁用和采用成功。验证：运行浏览器操作控件及主按钮，状态只来自本实例与服务端确认；使用设计 token、语义控件、基本键盘和 live region，更新 README 与 Verification 的实际入口。
- [ ] 4.3 GEN-006 完成采用 submitting/confirmed/conflict/unknown/error、丢响应后查询确认、同载荷手动重试和当前信息刷新，不能自动改 expected 或回写旧版本。验证：前端逻辑和浏览器回归覆盖服务端已提交但响应丢失、确认查询失败、当前仍旧/已被其他版本替换、重复点击、预览随后出错及刷新重新编译；保持候选和当前事实一致，README 记录待确认处理。

## 5. 跨模块浏览器与持久化回归

- [ ] 5.1 GEN-006 扩展候选 smoke，在真实 API/SQLite 上验证 A/B 会话、同所有者双标签竞争、活动/未确认生成拒绝、采用写入故障、原当前快照可读及构建后端重启恢复。验证：比较采用引用和完整文件/摘要，不只检查状态码；dev/preview 均使用相对 API，仅清理所属服务和临时数据，报告 fixture、不请求真实模型；同步 Verification 的覆盖和证据路径。
- [ ] 5.2 GEN-006 完成桌面与 320/375px、长路径/错误、键盘/焦点、预览临时输入重置及跨源隔离组合检查；加入无关窗口消息不能采用、错误候选真实失败等断言。验证：宿主与 frame 实际宽度、真实控件计算结果、实际 iframe 权限和无平台凭据传递；不以截图或伪 ready 代替编译，外部 bundler 不可达时正向项保持未完成；必要设计规则只更新 owning skill，并记录脱敏证据。

## 6. 集成验收

- [ ] 6.1 GEN-006 串行运行 frozen install、`pnpm check`（含前后端测试）、`pnpm test:manager`、`pnpm smoke`（含 build）、GEN-001 模板回归、新增 `pnpm smoke:candidate` 及受影响项目/事件流回归；相同源码已有有效结果时复用。验证：记录命令、退出码、实际差异与真实编译/交互/采用/重开观察，执行 `pnpm openspec validate gen-006-candidate-preview-adoption --strict --no-interactive`、链接检查和 `git diff --check`；明确测试候选、真实模型、业务验收和最终部署的不同状态。
