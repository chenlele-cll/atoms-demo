# Tasks

范围见 [proposal.md](./proposal.md)，实现方案见 [design.md](./design.md)，行为验收见 [candidate-review](./specs/candidate-review/spec.md)。以下任务已按隔离树的实际验证结果完成，具体命令、结果与报告见 [Isolated review evidence](#isolated-review-evidence)。下方混合工作区的原始实施证据单独保留，不替代隔离验证。依赖 GEN-001、003～005 的实际能力；此项用明确测试候选完成真实编译/交互，真实模型与最终部署由 GEN-010/009 验收。

上述完成状态对应下方历史隔离树；合入 `origin/main` 的 GEN-007 后，当前集成树的实际验证另记在 [Integration evidence](#integration-evidence)。

## 1. 共用契约与构建前提

- [x] 1.1 GEN-006 新增最小 `@atoms/contracts` workspace，提取实际共用的项目/版本/快照/采用/安全错误 schema，前后端显式依赖同一权威定义；保留私有模型与存储实现。验证：包输出 ESM/声明、两应用类型检查通过，同一输入的边界校验一致，浏览器构建无 Node/后端实现依赖；更新 Monorepo 与 Development 的包和契约归属。
- [x] 1.2 GEN-006 接入有界且串行的契约准备入口，根 check、两应用独立 dev/build/typecheck/test 自动准备缺失或过期产物；更新必要 workspace、lint、隔离副本和依赖诊断。验证：frozen install 后删除隔离副本生成产物，两应用独立/并发启动、重复准备、源码变化、准备失败阻止启动和必要部署副本均正确；副本不复制真实环境/数据库/node_modules，更新 README、Lifecycle、Verification 的实际前提。

## 2. 版本读取与采用事务

- [x] 2.1 GEN-006 实现有归属的版本 GET、完整快照/摘要校验、实际修改列表与采用可用性，覆盖模板及生成版本。验证：后端 injection 与真实文件测试覆盖 A/B 会话、跨项目/不存在同形 404、非法 ID、损坏记录、不重建模板、no-store 与正文不进入错误/日志；更新 README 的读取契约。
- [x] 2.2 GEN-006 实现严格采用 POST、成功运行关联、parent/expected 检查、活动/孤立 running 拒绝及当前引用 CAS，合法重复目标不再写入。验证：临时 SQLite 覆盖同父候选竞争仅一个成功、不同会话/Origin 拒绝、verified 等额外字段 400、故障回滚、重开保留、无模型调用与快照不变；同步 Development 的采用语义和 README 的冲突/幂等结果。

## 3. 预览状态与隔离组件

- [x] 3.1 GEN-006 实现项目/版本/摘要/attempt 绑定的预览状态机与采用状态分离，明确 done、错误锁定、超时、旧事件和文档重载规则；为前端显式加入固定 tsx/Node 测试入口并纳入根 test/check。验证：纯逻辑测试覆盖 connected/load 不成功、旧实例/超时后 done 无效、运行错误禁用、重试新实例与清理；更新 Development 和 Verification 的状态及测试覆盖。
- [x] 3.2 GEN-006 从 GEN-001 抽取 SnapshotPreview 并由模板页复用，使用固定依赖、当前 client 监听和受限跨源 iframe，不补默认样例或传递平台秘密。验证：实际 Sandpack 编译/交互、真实语法/运行错误、外部 bundler 阻断、重试与清理；GEN-001 浏览器回归保持通过，检查实际解析 SDK/iframe 属性及宿主样式隔离；README 说明外部预览前提和临时输入重置。

## 4. HTTP 客户端与候选检查页

- [x] 4.1 GEN-006 实现版本/项目读取及采用客户端，使用共用 schema、相对 API、10 秒截止、响应体/快照上限、摘要校验和取消。验证：前端 Node 测试覆盖 HTTP/JSON/schema/摘要失败、响应超限、取消及错误纯文本处理，不断言未知数据类型或读取 cookie 凭据；同步 Development 的边界处理规则。
- [x] 4.2 GEN-006 新增候选检查页与直接 URL、版本/来源/修改路径、当前/候选切换、重试与明确采用，首页/模板页继续工作。建立 `scripts/candidate-smoke.cjs`、命令 `pnpm smoke:candidate` 及明确测试候选，首先覆盖真实报价控件、采用前无写入、编译错误禁用和采用成功。验证：运行浏览器操作控件及主按钮，状态只来自本实例与服务端确认；使用设计 token、语义控件、基本键盘和 live region，更新 README 与 Verification 的实际入口。
- [x] 4.3 GEN-006 完成采用 submitting/confirmed/conflict/unknown/error、丢响应后查询确认、同载荷手动重试和当前信息刷新，不能自动改 expected 或回写旧版本。验证：前端逻辑和浏览器回归覆盖服务端已提交但响应丢失、确认查询失败、当前仍旧/已被其他版本替换、重复点击、刷新与采用互斥、预览随后出错及刷新重新编译；保持候选和当前事实一致，README 记录待确认处理。

## 5. 跨模块浏览器与持久化回归

- [x] 5.1 GEN-006 扩展候选 smoke，在真实 API/SQLite 上验证 A/B 会话、同所有者双标签竞争、活动/未确认生成拒绝、采用写入故障、原当前快照可读及构建后端重启恢复。验证：比较采用引用和完整文件/摘要，不只检查状态码；dev/preview 均使用相对 API，仅清理所属服务和临时数据，报告 fixture、不请求真实模型；同步 Verification 的覆盖和证据路径。
- [x] 5.2 GEN-006 完成桌面与 320/375px、长路径/错误、键盘/焦点、预览临时输入重置及跨源隔离组合检查；加入无关窗口消息不能采用、错误候选真实失败等断言。验证：宿主与 frame 实际宽度、真实控件计算结果、实际 iframe 权限和无平台凭据传递；不以截图或伪 ready 代替编译，外部 bundler 不可达时正向项保持未完成；必要设计规则只更新 owning skill，并记录脱敏证据。

## 6. 集成验收

- [x] 6.1 GEN-006 串行运行 frozen install、`pnpm check`（含前后端测试）、`pnpm test:manager`、`pnpm smoke`（含 build）、GEN-001 模板回归、新增 `pnpm smoke:candidate` 及受影响项目/事件流回归；相同源码已有有效结果时复用。验证：记录命令、退出码、实际差异与真实编译/交互/采用/重开观察，执行 `pnpm openspec validate gen-006-candidate-preview-adoption --strict --no-interactive`、链接检查和 `git diff --check`；明确测试候选、真实模型、业务验收和最终部署的不同状态。

## Implementation evidence

以下原始记录来自 `/Users/cll/Documents/atoms` 的混合工作区，保留其当时陈述和结果；隔离适用性见末尾说明。

2026-10-18，本轮实际实现共用契约、版本读取/条件采用、共用快照预览与候选检查页。`packages/contracts` 是公开项目/版本/快照/采用/错误 schema 的单一来源，输出 ESM/声明并使用浏览器可用 SHA-256；私有会话分页、模型、SQL 与运行管理仍在后端。准备入口检查输入与必要输出摘要、串行构建、失败阻止应用启动；manager 与构建副本包含共用包，未复制真实环境/数据库/node_modules。

版本 API 位于 backend/src/routes/versions.ts，短事务/CAS 位于 storage/store.ts；前端入口为 `/projects/:projectId/candidates/:versionId`，读取/采用客户端在 api/versions.ts，SnapshotPreview 被模板和检查页共同使用。GEN-006 没有新增数据库表；同工作区 REV-001 的迁移与共用 schema 调整被保留，没有重置或回退。

| 实际入口 | 结果 |
| --- | --- |
| pnpm install --frozen-lockfile | 0；4 个 workspace，唯一 lockfile 与固定依赖一致 |
| pnpm check | 0；lint/typecheck、契约准备 1 项、后端 195 项、前端 10 项通过，0 失败/跳过；后端计数包含同工作区其他 change 的已有测试 |
| pnpm test:contracts | 0；最新准备器专项通过，隔离 frozen install、独立缺失产物构建、并发、失效/源码修改及失败阻止 dev 均验证 |
| 后端 candidate-review + project-store 专项 | 0；16 项通过；共用版本 schema 收紧后的额外回归 |
| pnpm --filter @atoms/frontend test | 0；最新 10 项通过，含 UTF-8/摘要/响应体/取消/截止与未知采用确认 |
| pnpm test:manager | 0；13 项通过（含父项），约 153.5 秒；新 workspace/准备脚本下真实启动、恢复、诊断、日志和归属保护 |
| pnpm lint + pnpm smoke | 均 0；最终独立构建包含共用包，健康代理、既有页面、窄屏与错误恢复正常 |
| pnpm smoke:template | 0；13 个真实浏览器场景及 4 项控制测试通过，含真实编译错误、60 秒服务不可达、重试、晚到 client 清理与信号保护 |
| pnpm smoke:candidate | 0；最终 21 个 dev/preview 场景通过；测试候选真实编译，fixture 上游请求 2 次、真实模型调用 0 |
| pnpm smoke:projects | 0；6 个浏览器场景及 4 项控制测试通过，含完整快照/消息/run/候选重开和所属信号清理 |
| pnpm smoke:generation-stream | 0；8 个浏览器场景通过，含首帧、取消、断线查询及后端重启 |

实际报价从 5000 元随页数改为 7000 元、切换服务改为 10000 元，原主题/导航/FAQ 继续可操作。未点击主操作前没有采用请求；采用后比对完整文件/摘要/当前引用，重启与刷新仍为同一版本。失败候选出现真实语法/运行错误，按钮禁用，原当前快照可独立查看；采用后再触发真实运行错误或重新加载 iframe 文档不会回写旧版本，主动重试重新编译。

实际浏览器还验证：A/B 会话的 401/404、同所有者两个标签的不同同父候选至多一个采用成功、重复点击仅发一次、服务端已提交但 POST 响应丢失由 GET 确认、查询不可用保持 unknown、旧版本仍当前不冒称原请求失败、手动同载荷重试及后续其他合法选择导致 conflict。活动/孤立 running 和 SQLite 触发器写入故障均拒绝采用并保留完整原快照。

桌面、320/375px 的宿主与 frame 实际宽度、长路径/长纯文本错误、44px 平台按钮及键盘焦点通过；等待实际布局帧后测量，没有缩小桌面画布。切换/重试的报价临时输入重置。实际 iframe 为跨源、sandbox 仅 scripts/same-origin、allow 为空且 no-referrer；父页面读取被拒绝，无关窗口消息不能启用错误候选或触发采用，平台凭据未传至外部预览请求。截图复查发现并修正测试报价输入在暗色下的对比度后，重新执行全部 21 项，最终截图已复查。

最终候选报告及截图：`test-results/candidate-review/4732a081-3b74-4c43-859d-84e7c9f80f5f/`。模板报告：`test-results/template-baseline/07434b5b-2cee-4a79-bbbc-39a1c4b79398/report.json`。manager 报告：`test-results/manager/5eb0dc28-6098-4586-8505-4522c0e01f77/report.json`。项目报告：`test-results/project-persistence/5725c965-a7b7-4a5a-958b-d30c2f5a645a/report.json`。事件流报告：`test-results/generation-stream/ea07ca70-673c-4764-a7a9-34faf790fe78/report.json`。

综合报告：`test-results/gen-006/9f1871b2-62af-428e-bb0a-598ccc857100/report.json`，含实际命令、日志路径、复用说明与 67 个实现/测试文件 SHA-256；最终构建/验证后源码一致。日志为 `/tmp/atoms-gen006-*.log`，所有报告和截图均仅本地保留，不上传数据库、cookie 或完整代码。准备器收尾引用清理、最后的权限说明文本和测试候选对比度修正分别有专项/构建/浏览器覆盖，未无条件重复其他同源验证。

README、Monorepo、Development、Lifecycle、Verification 和两应用指南已更新。本 change 严格校验、168 个本地文档目标/3 个新增锚点检查及 git diff --check 均通过；最终进程和 3001/5173/4173 端口已释放，仅清理本次所属数据。其他 change 的并行修改保持，本轮没有提交、推送、归档或发布。

边界：source=fixture，以上真实编译/交互针对明确测试候选，预览是本轮本地观察。GEN-004 的既有真实模型记录独立保留；本轮没有重发真实模型请求，也没有宣布服务端可信编译、其他业务需求或最终部署通过。完整聊天工作台仍由 GEN-007 接入，真实业务/模型端到端与最终环境分别继续在 GEN-010/009 验收。

## Isolated review evidence

2026-10-18，隔离验证在 `/var/folders/qz/w0j_pldx16b5frjywnmbqlq00000gn/T/opencode/gen006-review` 实际运行，分支 `feat/gen-006-candidate-preview-adoption`，基线 `257321f`。提交按共享契约与构建准备、版本读取/条件采用 API、共享预览、候选检查页面四组组织。以下结果覆盖独立 GEN-006 代码树，包括候选 UI 与刷新竞争修复，不依赖原工作区其他任务的未提交实现。

共用包限于 project/version/snapshot/run/adopt/errors，session/message/SSE 保持后端归属；首页仍为连接检查。没有引入 GEN-007 工作台/诊断路由、REV-001 历史、GEN-008 验证调度或模型配置变更，没有新增迁移。隔离 HEAD 已有部署文档保留，原 main 工作区与隔离 worktree 的其他工作均保持。

| 隔离树实际命令 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 退出 0；Node 22.22.2、pnpm 12.11.2 |
| `pnpm check` | 退出 0；契约准备测试 1 项、后端 168 项、前端 11 项通过，lint/typecheck 通过 |
| `pnpm smoke` | 退出 0；包含完整构建，连接检查首页在 dev/preview 的响应式与错误恢复通过 |
| `pnpm --filter @atoms/frontend build`、`pnpm --filter @atoms/frontend test`、`pnpm lint` | 刷新/采用竞争修复后重新执行，均退出 0；前端 11 项通过 |
| `pnpm smoke:candidate` | 最终 21 个 dev/preview 场景通过；报告 status=passed、cleanup=passed，真实模型调用 0、fixtureModelRequests=2 |
| `pnpm test:manager` | 13 项通过、0 失败，约 150 秒 |
| `pnpm smoke:template` | 13 个浏览器场景及 4 项控制测试通过、0 失败 |
| `pnpm smoke:projects` | 6 个浏览器场景及 4 项控制测试通过 |
| `pnpm smoke:generation-stream` | 8 个浏览器场景通过 |
| `pnpm openspec validate gen-006-candidate-preview-adoption --strict --no-interactive` | 退出 0；文档与任务记录收尾后严格校验通过 |
| `git diff --check` | 通过；文档收尾后另核对本次差异与本地链接 |

所有占端口套件串行执行。最终候选 smoke 包含刷新/采用竞争回归：刷新与 submit 入口同步取得 `operation.current` 锁，`canSubmit` 要求 `!refreshing`，手动重试按钮在 refreshing 时禁用。延迟返回旧状态的刷新 GET 期间没有采用 POST；刷新完成后重复点击仅发送一次 POST。修复后重新构建前端、运行全部 11 项前端测试与 lint，再运行最终 21 项候选场景。dev 的 320px/1280px 截图已由执行代理复查。

下列报告路径均相对于本节隔离 worktree 根目录，是本次实际结果；测试源码也以同一根目录为准：

| 套件与测试源码 | 本次隔离报告 |
| --- | --- |
| [candidate-smoke.cjs](../../../scripts/candidate-smoke.cjs) | `test-results/candidate-review/e5ffe832-fd04-49ed-bb90-3d2971e5f836/report.json` |
| [manager.test.mjs](../../../scripts/manager.test.mjs) | `test-results/manager/f1575599-530d-4b97-bec9-9183ca0b9f5a/report.json` |
| [template-smoke.cjs](../../../scripts/template-smoke.cjs)、[控制测试](../../../scripts/template-smoke-control.test.mjs) | `test-results/template-baseline/b948ef5f-943a-46f0-9359-deb5a9be9902/report.json` |
| [project-smoke.cjs](../../../scripts/project-smoke.cjs)、[控制测试](../../../scripts/project-smoke-control.test.mjs) | `test-results/project-persistence/e3714570-13e1-41a0-9a96-4aa587f656d2/report.json` |
| [generation-stream-smoke.cjs](../../../scripts/generation-stream-smoke.cjs) | `test-results/generation-stream/9bcae38b-a1ef-4335-a92d-37931d657c3b/report.json` |

契约准备测试为 [prepare-contracts.test.mjs](../../../scripts/prepare-contracts.test.mjs)，后端候选边界为 [candidate-review.test.ts](../../../backend/test/candidate-review.test.ts)，前端测试位于 `frontend/test/`；根 `pnpm check` 串联对应入口。

以上 Implementation evidence 的命令、195/10 等旧测试计数、报告路径、67 文件哈希及 `/tmp/atoms-gen006-*.log` 日志均属于 `/Users/cll/Documents/atoms` 的历史混合工作区。它们与本节 168/11 计数及新报告分开保留，不能用于证明隔离源码相同；原始报告没有复制或改写成隔离结果。上方 REV-001 陈述仅是历史上下文，不表示本次隔离实现包含历史功能。

本次验收 source=fixture，仅证明明确测试候选的实际编译、交互、隔离、采用与持久恢复。真实模型业务端到端与最终部署未运行；历史 GEN-004 真实模型记录仍独立，不据此宣布 GEN-010/009 通过。报告、截图、日志、数据库和凭据保持本地，不纳入任务提交；本次没有归档或发布。

## Integration evidence

2026-10-18，本节记录隔离 worktree 合并 `origin/main`（GEN-007 PR1，`d3cfb7a`）后的集成检查，更新原待执行状态。当前树保留 main 的 GEN-007 应用、工作台、诊断路由与共享会话/消息/分页/SSE 契约，并保留 GEN-006 的候选 API、契约准备及两处候选刷新/采用保护；最后补充 `frontend/src/workspace/VersionPane.tsx` 手动重试按钮的 refreshing 禁用条件。原源码工作区的所有修改保持。下方结果与上方历史混合工作区、独立 GEN-006 证据分开记录。

| 集成检查 | 实际结果与适用范围 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 退出 0 |
| `pnpm check` | 退出 0；契约准备 1 项、后端 169 项、前端 32 项通过，lint/typecheck 通过；在最后按钮条件前执行 |
| `pnpm smoke` | 退出 0，包含构建；在最后按钮条件前执行 |
| 前端 build、lint | 最后补充 VersionPane 手动重试 refreshing 条件后重新执行，均退出 0 |
| `pnpm smoke:candidate` | 21 个场景通过；`test-results/candidate-review/abaea391-0e77-4536-bfa0-1545e1b75d79/report.json` |
| `pnpm smoke:workspace` 首轮 | 26 个既有场景通过；`test-results/workspace/f3b33e10-9ade-4fc4-9095-0716a5edbcf8/report.json`；在最后按钮条件前执行 |
| `pnpm smoke:workspace` 最终轮 | 最后按钮条件后，既有 26 个场景全部通过（dev 13、preview 13），报告 `status=passed`；`test-results/workspace/dbf4ac7d-5e20-47a2-9401-12831a009486/report.json`；实际日志 `/var/folders/qz/w0j_pldx16b5frjywnmbqlq00000gn/T/opencode/gen006-workspace-validated.log` |

工作台最终脚本与 `origin/main` 相同。曾临时加入额外故障注入测试，但该测试自身的无界等待挂起，相关尝试取消后已移除；它不在最终代码中，也不计入通过数。另有两次尝试因其他部署进程占用 3001 端口而受阻，未停止外部进程；这些受阻/取消记录不作为产品失败或通过证据。

模板、项目、事件流与 manager 专项未在本次 UI 集成中重跑：相关源码与 main 相同，先前证据单独保留，不新增通过声明。集成后执行 `pnpm openspec validate --all --strict --no-interactive`，23 项通过、0 失败；本地文档链接和差异检查通过。候选与工作台结果使用明确 fixture，不代表真实模型业务或最终部署验收；历史报告、测试计数和旧首页/共享包范围不能替代本节集成结果。
