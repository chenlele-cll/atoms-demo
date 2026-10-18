# Design

## Context

动机见 [proposal.md](./proposal.md)，行为契约见 [candidate-review](./specs/candidate-review/spec.md)。当前 frontend 只有连接检查，backend 只有健康接口；模板、数据库、生成与事件流均是 GEN-001～005 的待实施依赖。本变更接入它们的实际代码后才开始验证，不以工件存在代替功能通过。

GEN-001 已规划完整文件集合和 Sandpack 基线；GEN-004/005 的 succeeded 仅代表候选保存，project.currentVersionId 仍指向旧版本。GEN-006 增加第一个实际消费项目快照的前端页面，因此原预计在 GEN-007 执行的公开 schema 提取提前到此处，能力边界不变。

## Goals / Non-Goals

**Goals:**

- 用同一个快照预览组件承载模板、当前版本和候选，避免维护三套编译/错误状态逻辑。
- 把不可变代码、本轮浏览器编译和服务端当前版本分别建模，明确采用的用户动作与持久化确认。
- 以实际编译、业务控件、CAS 冲突和重启恢复验证链路，给 GEN-007 提供可直接复用的预览能力。

**Non-Goals:**

- 不实现完整项目列表、聊天工作台、源码编辑器、历史版本列表/恢复、分享或独立站发布。
- 不增加服务端编译/代码执行、自动修复、可信编译签名或外部 bundler 自托管。
- 不把 iframe 消息或用户点击当作服务端业务验证证明；真实模型的两个需求与最终访问环境仍在 GEN-010/009 验收。

## Decisions

### 1 公开契约在真实共用时提取，不共享后端实现

新增中立 workspace `packages/contracts`，包名 `@atoms/contracts`，仅导出公开项目/版本 DTO、快照/路径/体积规则、采用输入/输出和安全错误 schema 及推导类型。移动 GEN-003 中本次实际共用的权威定义，不复制 schema；模型工具、数据库行、会话 token 和私有运行管理留后端。使用可在浏览器运行的 UTF-8/规范化函数，不导入 Node、文件系统或后端模块。

该包使用与现有后端相同精确版本的 Zod，构建输出 ESM JavaScript 与声明到自己的 dist；前后端显式声明 workspace 依赖。根递归 build 按依赖顺序构建；直接运行应用的 dev/build/typecheck/test 也先准备该包，避免只能通过某个偶然执行顺序启动。

新增最小 `scripts/prepare-contracts.mjs`：复用已有 proper-lockfile 串行化同一仓库的准备，按源码/配置/依赖输入和必要输出判断是否需构建，缺失或过期才执行包构建；失败不继续启动。根 check 在 lint/typecheck 前准备，应用独立命令复用这一入口，不维护第二套编译规则或常驻 watcher。源码改变后重新准备/重启，首轮不承诺跨 workspace 自动热更新。

同步 workspace、TypeScript/lint 范围及 manager 的隔离 fixture/依赖诊断：副本复制契约源和准备脚本，构建自己的产物，不复制工作目录 dist/node_modules/环境/数据库。生产后端发布内容需包含中立包的 package.json、dist 和运行依赖，仍不需要前端源代码。该接入需要 frozen install 与 manager 回归，不能只验证现有开发副本。

### 2 版本读取与采用只有两个新增 HTTP 接口

| 接口 | 结果与约束 |
| --- | --- |
| `GET /api/projects/:projectId/versions/:versionId` | 有归属的完整不可变版本、parentVersionId、模板来源、成功运行关联或 null、实际 changedFiles、currentVersionId 与 adoptionAvailability；不修改项目 |
| `POST /api/projects/:projectId/versions/:versionId/adopt` | 严格 JSON `{expectedCurrentVersionId}`；确认当前选择，返回 projectId、currentVersionId、updatedAt、alreadyCurrent |

复用 GEN-003 会话、Origin、显式 DTO 和 no-store；ID 为 UUID。POST 上限 1 KiB，拒绝 files、verified、模型或其他字段；GET/POST 参考默认限流分别 60/10 次每分钟/IP，不计模型配额。无会话 401，跨项目/不存在同形 404，非法输入/来源/体积/类型沿用 400/403/413/415；冲突为 409，存储不可用为 503，损坏快照为安全 500。

版本查询包括模板 v0 与已存生成版本，不提供历史列表或恢复。adoptionAvailability 表示 eligible/already-current/stale/busy/unconfirmed/not-candidate，仅反映当时服务端采用条件，不包括浏览器编译；POST 仍须再次检查。服务端复用快照 schema 并重算摘要，changedFiles 与父版本比较计算；不能从当前模板补齐丢失文件。没有私有会话/SQL 字段，代码正文只在归属验证后的成功读取响应中返回，不进入日志或错误。

新增 `frontend/src/api/versions.ts` 及实际需要的项目详情读取客户端，使用相对 /api、same-origin cookie、10 秒网络/读取时限。响应以 unknown 进入共用 schema；完整响应最多 16 MiB，再按解码后的快照 2 MiB/64 文件规则和摘要校验，容纳 JSON 转义开销。错误正文有界，作为纯文本显示安全说明；请求取消、JSON 失败和结构失败分别处理，不直接断言类型。

### 3 采用是受保护的当前引用切换

候选必须为本项目 generated 版本，关联本项目 succeeded 运行的 resultVersionId，且 parentVersionId 等于请求 expectedCurrentVersionId。无此关联返回 CANDIDATE_NOT_ADOPTABLE；不允许通过本接口把任意历史版本恢复为当前。

在短事务中按以下顺序处理，整个过程中没有模型调用或 await：

1. 再次校验会话、项目/候选归属、完整结构和成功运行关联，以及 expected 与候选 parent 一致。
2. 若目标已是当前，返回 alreadyCurrent=true，不重复更新时间；这条无写入重试不受新活动运行影响。
3. 若 currentVersionId 不再等于 expected，返回 CURRENT_VERSION_CONFLICT，不重试为其他基线。
4. 若 GEN-005 仍持有该项目活动运行，返回 PROJECT_BUSY；若存储有 running 但无执行者，返回 RUN_STATE_UNCONFIRMED，不跨过未知状态采用。
5. 以 owner/current 条件更新 currentVersionId 与 updatedAt，确认恰好一行成功后提交；不修改版本正文、生成状态或历史记录。

单服务模型下，活动 Map 检查与同步事务之间不留异步窗口，数据库内仍检查 running，防止两种入口绕过彼此。多个标签页采用不同同父候选时仅一个成功，其余 409；同一目标重复则幂等。事务失败回滚，数据文件重开后引用仍一致。现有表即可满足需求，不增加采用日志/预览证明表或破坏性迁移。

### 4 复用 Sandpack 并明确浏览器反馈边界

将 GEN-001 的预览适配抽取为 `frontend/src/preview/SnapshotPreview.tsx`，只接收已验证的 entry/dependencies/files 和项目/版本/摘要键；模板基线页与新检查页共同使用。候选完整映射按固定配置传入，不套默认 Hello World 补齐损坏项目；不更新或升级模板自己的 React/依赖，不在后端 import/运行生成代码。

复用 GEN-001 锁定的 sandpack-react，而非引入第二种执行环境。此次已核对 2.20.0 发布包：实际编译完成使用 `done` 与拼写为 `compilatonError` 的字段，`connected` 还可能清空库内 error，因此不能只读取库的 idle/error 状态判断成功。使用当前 client 作用域的 SDK 监听，严格要求 `done` 且 compilatonError===false，并结合本轮已知错误。文档中的 [client hook](https://sandpack.codesandbox.io/docs/advanced-usage/hooks#usesandpackclient) 提供实例级监听与卸载方式。

构造受控 iframe，预先设置 sandbox="allow-scripts allow-same-origin"、空的额外权限 allow、no-referrer 和说明性 title，保留运行所需能力，不开放弹窗、顶层导航、下载和硬件访问。已核对关联 client 发布包：仅在未提供 sandbox 属性时才添加其宽权限默认值，实施仍以实际 lockfile 解析版本及浏览器属性验收为准。bundler 来源为平台固定的外部来源，拒绝与平台同源或来自候选配置的任意地址。

跨源 iframe、平台 SameSite/HttpOnly cookie、Origin 与私有 API 校验共同保护平台。只向预览传代码/依赖，不传会话、对话或后端配置；预览 postMessage 永远不能触发采用。SDK 消息限当前 client，其他窗口及旧 client 的反馈不消费；同一预览中的消息仍属浏览器观察，不能成为后端信任根。

采用 API 不接收 compiled/verified/token 之类浏览器“证明”，只验证归属、结构、成功运行与基线。UI 的编译门槛是帮助所有者检查的交互规则，不声称拥有可信服务端编译。外部 bundler 会接收用于预览的代码，网络前提及这一运行方式记入使用说明，不承诺离线可用；参考 [Sandpack bundler 托管说明](https://sandpack.codesandbox.io/docs/guides/hosting-the-bundler)。

### 5 实例状态机避免旧结果变成新成功

加载与预览分开：loadingSnapshot → compiling → compiled，任一阶段可进入 loadError/compileError/runtimeError/timeout。采用独立为 idle/submitting/confirmed/conflict/unknown/error，不与 compiled 合并成一个“成功”。实例键包含 projectId/versionId/digest/attempt；更换键创建新 client，旧网络、timer 与监听全部清理。

60 秒预览截止从本轮编译开始计，iframe load 和 connected 不算通过。成功必须严格匹配本轮 client 的有效 done；收到错误即锁定该轮错误，不因后续 connected 或旧 done 自动清除。runtimeError 可把已 compiled 实例转为错误并禁用采用；iframe 文档重新加载/导航也使原编译门槛失效，不保留旧成功。超时后晚到成功忽略，主动重试才新建 attempt。诊断作为有界纯文本显示，不展示原始 HTML、不收集整个 console 或把源码/异常上传到普通日志。

候选与当前版本切换时最多保留一个活动 iframe，避免状态、资源和回调混用；预览应用的临时输入在重试/切换后重置，页面简短说明。平台当前引用独立保留，候选失败时“查看当前版本”只重新加载已有快照，不写回或自动回退数据库。

### 6 聚焦检查页供后续工作台复用

新增 `frontend/src/candidate-review/CandidateReview.tsx` 及 CSS Module，通过 `/projects/:projectId/candidates/:versionId` 直接访问；沿用 App 的轻量路径分支，懒加载预览依赖，保留首页和 GEN-001 基线入口，不新增路由框架。无权限时显示实际 401/404，不自动初始化会话或认领项目。

页面显示项目标题、查看中的版本、当前持久版本、来源与服务端计算的修改文件。提供“候选版本/当前版本”切换、预览状态、重试及一个“使用这个版本”主操作；不添加聊天、历史恢复、分享或编辑占位按钮。readonly 路径列表不是源码编辑器，GEN-007 可直接复用预览和采用控制。

采用仅在候选本轮 compiled、无已知错误、版本未过期且非 submitting/unknown 时启用。按钮点击是所有者的明确选择，旁边提示先检查关键交互；不要求一个没有技术含义的 verified 勾选框。提交期间禁重复点击，重试/切换清除旧本地编译门槛，但不能覆盖服务端当前选择。

遵循已读取的 atoms-frontend-design：奶油色宿主面板、炭色主操作、细边框与语义状态；模板样式留在 iframe。状态使用礼貌 live region，错误可发现，控件 44px、焦点清楚，长路径换行。桌面预览占主区域；320/375px 工具栏换行、单列真实可滚动预览，不把整页缩放到窄屏。必要样式规则只更新 owning design skill，不复制到 DESIGN.md。

### 7 采用确认不依赖单次响应或页面缓存

采用请求只发送 URL 中候选与已加载的 parent/expected ID，不发送文件或编译字段。收到有效成功响应后再更新“当前版本”，随后用项目查询确认；纯预览完成或本地点击不显示已采用。冲突重新读取项目当前信息并保留候选，不能自动换 expected 重发。

POST 超时、响应中断或解析失败进入 unknown，保留候选并执行一次 GET 项目确认。目标已是当前则确认成功；其他版本不被覆盖，查询失败保持待确认并提供“查询采用结果”。查询仅返回当下事实，不能因为当前仍为旧版本就断言原请求从未或不会提交；允许所有者明确查询或使用同一合法载荷手动重试，幂等与 CAS 阻止重复覆盖。

刷新、直接访问和后端重启都从项目/版本 API 重建当前选择；浏览器编译状态不持久化为可信标记，每个新实例重新验证。被采用后出现新的预览运行错误也不静默回写旧版本；当前指针是已确认选择，用户可查看错误，历史恢复由后续功能处理。

### 8 分层验收使用真实预览和明确测试代码

后端 Node 测试覆盖版本/采用鉴权、Origin、schema、成功运行关联、活动/孤立 running、同父候选竞争、幂等、故障回滚及 SQLite 文件重开。只增加当前需要的事务与客户端边界测试，不以数据库行数量替代实际内容比较。

前端对状态机、HTTP 取消/解析/未知结果增加纯逻辑 Node 测试，显式声明与后端相同固定 tsx 开发工具，复用 Node 测试器；根 test/check 纳入两应用测试，不增加 DOM 测试框架。测试旧 key、旧 done、connected、错误锁定、超时、采用未知与冲突；这些测试不能替代浏览器实际编译。

新增计划 `pnpm smoke:candidate` 和 `scripts/candidate-smoke.cjs`，要求先 build，使用已有 Chrome/playwright-core、临时真实数据库与本次所属服务。测试通过内部存储预置明确的 fixture 候选和 succeeded 测试运行，不向生产添加假模型入口，也不把它们记为模型成果。

| 场景 | 操作与断言 |
| --- | --- |
| 正常候选 | 在真实模板中加入最小测试报价控件，经真实 Sandpack 编译；选择类型/改变页面数量，断言报价实际变化，原导航/FAQ 仍可用；明确采用后重开比较版本/文件 |
| 编译/运行错误 | 使用结构合法且摘要匹配、但有真实语法错误或抛异常的候选，观察错误，采用不可用；原当前快照仍能独立查看 |
| 网络与坏响应 | 模板服务/版本 API 离线、非法 JSON/快照、bundler 阻断及超时，保持诚实错误与可重试；新上下文避免缓存绕过故障 |
| 过期与伪消息 | 状态单测注入旧实例结果；浏览器从无关窗口发消息不能启用采用或修改项目，检查实际 iframe 限制和父页面隔离 |
| 采用失败/竞争 | A/B 会话、同所有者两标签、活动运行、503 回滚、提交后丢响应；不覆盖新选择，GET 可确认已存目标 |
| 重启与产物 | 前端 dev/preview 分别走相对 API；重启所属构建后端保留 DB/cookie，采用引用恢复、快照一致，新 iframe 重新编译 |
| 可访问性 | 1280px、320/375px、键盘/焦点、长文件名/错误、宿主与预览实际宽度，以及宿主主题不受生成样式影响 |

成功必须来自真实编译和交互，不拦截一个 ready 消息代替。外部 bundler 不可达时正向验收保持失败/未完成，不能换成静态截图通过。证据在忽略的 `test-results/candidate-review/`，标记 fixture，保留脱敏摘要与截图；不上传数据库/cookie/完整代码。

## Risks / Trade-offs

- 浏览器反馈可被同一候选影响，不能证明代码或业务正确 → 仅当本地观察使用，服务端不记录 verified；关键交互实测，用户明确采用。
- 外部 bundler/依赖下载失败或缓存误导 → 明确截止、干净上下文与真实错误回归；保留旧版本，最终环境另验。
- 共享 schema 首次增加构建顺序与副本前提 → 中立包、单一准备入口、frozen install、两应用独立启动及 manager 回归，不把编译产物当源复制。
- 多标签或生成期间切换当前版本 → 事务 CAS、成功运行关联与活动检查，无自动重设基线或合并。
- 采用响应丢失但实际已提交 → unknown 与查询确认，合法重复幂等，不把网络错误误报为回滚。
- 预览临时业务输入被误解为已保存 → 只承诺平台代码/当前选择持久化，切换/重试明确重置内存状态。

## Migration Plan

1. GEN-001、003～005 实际能力可用后，提取共用公开契约并接好构建/测试/隔离副本；先验证独立命令，不开始制作完整工作台。
2. 实现版本读取、采用条件事务及故障/竞争测试，保留旧 API 与生成状态语义，不需要真实模型配置。
3. 抽取模板快照预览，接入严格状态机、受限 iframe、客户端与候选检查页；先完成真实编译和错误场景。
4. 完成前端逻辑测试、浏览器/DB/HTTP 回归，更新 README、Monorepo、Development、Lifecycle、Verification 及实际新增设计规则。
5. 串行运行 frozen install、pnpm check、pnpm test:manager、pnpm smoke（含 build）、GEN-001 模板回归、新增 smoke:candidate 及受影响项目/事件流回归；记录源码差异和真实结果，严格校验本 change。
6. 回退先停用采用入口并保留全部快照、当前引用与数据，撤回本次应用产物；不删库、不静默恢复旧版本。后续 GEN-007 复用组件/契约，GEN-009/010 完成最终环境与真实生成验收。
