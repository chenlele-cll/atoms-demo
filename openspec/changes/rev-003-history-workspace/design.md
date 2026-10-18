# Design

## Context

动机见 [proposal.md](./proposal.md)，行为见 [version-history-workspace](./specs/version-history-workspace/spec.md)。本轮只规划，授权限于 REV001～005，不执行 apply，不写应用代码，不修改其他任务工件。

已只读检查 `frontend/src/App.tsx`、`template-baseline/TemplateBaseline.tsx`、`api/health.ts`，以及后端 projects 契约、routes 和 store：前端目前只有连接检查和企业官网模板 Sandpack 基线，已有真实 SDK 编译/错误监听及重试；没有项目客户端、历史、工作台、源码视图、前端单测入口或 `SnapshotPreview`。后端已有匿名项目/消息 API、模板 v0、递增 sequence 的不可变版本及内部有界候选生成，候选保存不改变 currentVersionId；没有公开历史列表/恢复接口。

依赖规划见 [GEN006 design](../gen-006-candidate-preview-adoption/design.md)、[candidate-review spec](../gen-006-candidate-preview-adoption/specs/candidate-review/spec.md)、[GEN007 design](../gen-007-project-workspace/design.md)、[project-workspace spec](../gen-007-project-workspace/specs/project-workspace/spec.md)。两份 design 的 Context 保留早期“只有健康接口/模板数据库待实现”的描述，与当前源码不同；此处以当前源码为现状证据，引用它们的未来契约，不改其工件。GEN006 的中立契约包、单版本读取、SnapshotPreview 和 GEN007 工作台均须实际实现后才能对接。`pnpm openspec list --specs` 当前没有长期能力规格。

## Goals / Non-Goals

**Goals:**

- 在单一工作台状态容器中增加 history 查看模式，保持当前/查看/候选身份和恢复操作生命周期独立。
- 以边界清楚的客户端、纯 reducer/状态和展示组件支持先行 fixture 开发，明确真实接入闸门。
- 使用恢复专用 CAS 和 GET 确认消化竞争及未知结果；真实本轮预览只作为本地操作门槛。

**Non-Goals:**

- 不实现 REV001 列表查询/元数据生成或 REV002 恢复存储事务，不创建第二套公开 schema、单版本接口或预览组件。
- 不增加临时历史工作台、路由框架、全局状态库、Diff、源码编辑、分支管理、曾采用日志、可信验证标记、分享或部署。
- 不在 REV-003 完成恢复后的生成上下文筛选/续写（REV004），不承接跨 REV 真实模型及完整验收（REV005）。

## Decisions

### Ownership And Integration Gates

| 归属 | 消费边界 | 实际对接闸门 |
| --- | --- | --- |
| REV001 | 列表 GET、稳定倒序游标、request/summary/changedFiles 元数据 | 路由、权威 schema、归属/分页测试实际可运行 |
| REV002 | restore POST、模板/成功生成目标校验、CAS、busy/unconfirmed、幂等 | 恢复路由、短事务与 GEN005 活动运行检查实际可运行 |
| GEN006 | 单版本 GET 的完整 snapshot/来源/修改文件/adoptionAvailability、SnapshotPreview、中立公开契约与前端 Node 测试入口 | 真实快照读取、受限 iframe、本轮编译反馈、重试清理已验证 |
| GEN007 | `/projects/:projectId` 壳、项目激活/导航、只读源码、候选/当前查看与任务控制器 | 工作台与源码实际可用，内部视图切换不重启任务 |
| REV003 | 历史视图、查看选择、恢复确认与客户端状态、局部 UI 验证 | 以上四项真实接入后完成局部浏览器路径 |
| REV004 / REV005 | 恢复后续改 / 跨 REV 完整验收 | 消费已确认 currentVersionId 和本模块真实证据 |

选择复用原壳与组件：它们已规划项目激活、唯一 iframe 和代码查看，重复实现会产生两套状态及验证责任。替代的独立临时工作台、直接复制模板预览、借用 candidate-review 页面当历史工作台均不采用。独立逻辑/展示 fixture 可以先开发，但不注册产品临时入口，不发送生产写入，不把模拟编译标记记成实际编译。

GEN006 的 adopt 只允许父版本等于 expected 的候选，历史 restore 则允许合法祖先/分支/模板。两个命令可以共用已实现的 HTTP 边界工具和预览，但不能共用 adopt eligibility 作为恢复授权。当前 `adoptionAvailability=stale/not-candidate` 不足以禁止历史恢复；只有 REV002 事务能最终判断恢复可用性。

### API Contracts

REV-003 只消费以下协调契约，权威 schema 由 owning change 维护；GEN006 提取的 `@atoms/contracts` 实际存在后才导入。先行逻辑 fixture 使用明确的测试数据/接口适配，不复制生产校验规则到前端或导入 backend 源码。

| 操作 | 契约 |
| --- | --- |
| 历史列表 | `GET /api/projects/:projectId/versions?limit=20&beforeSequence=N`；limit 为 1..50，beforeSequence 为可选非负安全整数，`sequence < N`、sequence DESC，模板为 sequence=0；beforeSequence=0 返回空页 |
| 列表响应 | `{projectId,currentVersionId,items,nextBeforeSequence}`；更多时游标为本页最末 item.sequence，否则 null；非空后续游标须比本次游标更小，不使用时间或 offset |
| 历史 item | `{id,sequence,parentVersionId,kind,createdAt,isCurrent,runId,request,summary,changedFiles}`；runId 为 UUID 或 null，request 为 `{messageId,excerpt,truncated}` 或 null，summary 为 `{source:'stored'|'fallback',text}`，changedFiles 为路径数组，模板为 [] |
| 单版本详情 | `GET /api/projects/:projectId/versions/:versionId`，GEN006 已规划的完整不可变快照、来源、实际修改文件、当前引用和 adoptionAvailability；不再扩展一个历史详情接口 |
| 恢复 | `POST /api/projects/:projectId/versions/:versionId/restore`，strict JSON `{expectedCurrentVersionId}`；200 `{projectId,currentVersionId,updatedAt,alreadyCurrent}` |
| 结果确认 | `GET /api/projects/:projectId`，已有 `{project,currentVersion,latestRun}`；使用实际 currentVersionId 和完整快照，不能仅凭本地列表高亮确认 |

列表不包含完整源码、曾采用状态或持久化验证状态。request 仅是 owning API 给出的有界摘录；truncated 必须可见，展开也不能假称恢复完整需求。stored 摘要来自真实关联记录，fallback 是服务端事实回退，界面不自行生成模型摘要或推测需求。完整对话仍由 GEN007 消息读取负责，不为历史另加消息全文端点。

HTTP 复用 GEN006/007 客户端边界：相对 `/api`、same-origin、no-store、AbortController、10 秒头/正文读取总期限，unknown 经权威 schema 解析，错误按安全 code 展示。列表与 REV001 一致采用 1 MiB UTF-8 JSON 响应上限，完整详情/项目沿用 GEN006 的 16 MiB JSON 上限和解码后 64 文件/2 MiB 快照限制；超限明确失败，不能静默截断 items。restore 响应/安全错误限 16 KiB，POST 不发送 compiled/verified/files 或模型参数。取消、超时、JSON/schema/关联不匹配各自归为可理解错误。

缺会话 401，跨项目/不存在同形 404；来源 403、非法输入 400、413/415、429 Retry-After、安全 500/503 沿用项目契约。401 清除该归属的私有缓存，404 清除失效目标，不自动 POST session。页面不记录完整代码、提示词、cookie 或原始异常；预览只拿 GEN006 规定的文件/依赖/身份，不接收列表请求摘录或对话。

### History Pagination And Metadata

列表状态按 `projectId + activation + listEpoch` 保存首屏/加载更多状态、已展示 items 和游标。初次打开 history 才读默认 20 条；“加载更早版本”单次请求并锁住重复点击，以 id/sequence 合并和倒序展示。成功后才推进游标，失败保留条目/阅读位置和原游标，null 时停止。列表加载不会触发详情批量预取或运行全部预览。

同一读响应中的 currentVersionId 与 isCurrent 应一致；不同页可能观察到不同 current，这是时间变化而非版本身份变化。合并时以最近已确认项目事实统一计算当前徽标，不能保留两页各自的旧 isCurrent 导致多个当前。并发旧读取不能回退恢复成功后的当前引用：恢复成功/确认查询后增加当前事实 epoch，废弃此前列表/详情的 current 字段，仅保留安全不可变元数据；显式刷新使用新 epoch。跨标签的未知变化仍由 GET 项目校准，不用 sequence 大小猜 current，也不按请求发送顺序推断服务端完成顺序。

追加新版本不打乱已有向下翻页；提供显式“刷新历史”回到首屏并重置分页 epoch，保留选中详情直到真实校验失败。恢复不会产生新版本，刷新历史只更新当前标记。selected 版本不在当前加载页时，标题和详情仍清楚标识，不自动请求所有页寻找它。

条目显示版本序号/时间/类型与短 ID（完整 ID 可访问）、请求摘录、摘要来源和修改文件数量；展开提供有界文本及换行路径。长摘要按展示折叠，不修改服务器数据；不将路径当 HTML。request=null 与空修改文件有实际说明。既有版本保留，失败/取消生成没有结果版本时不能伪造历史项。

### Selection And Preview Identity

在 GEN007 同一个项目状态容器中保留：`currentVersionId`（已确认服务端事实）、`viewedVersionId`（用户查看对象）、`candidateVersionId/runId`（本次任务结果）及查看意图 current/candidate/history。三者可指向相同 ID，但标签表达身份而非排他枚举。选择历史只更新 viewed 和有效文件选择，永不触发 POST；生成终态更新候选入口，用户主动查看历史时不强制切回候选。

历史详情 key 为 `projectId/activation/viewedVersionId/detailAttempt`；预览沿用 GEN006 `projectId/versionId/digest/attempt` 并关联当前 activation。新选择立即停止显示旧正文为新对象，加载完整快照后再送进已有 SnapshotPreview 和 GEN007 只读源码。源码文件优先保留相同合法路径，否则回到快照 entry；所有源码以 React 转义文本展示。

项目切换、快速 A→B→A、刷新、重试均使旧请求失效，abort 之外还检查 key，防止已完成 promise 污染。唯一活动 iframe 绑定 selected snapshot；只切换同项目 history/code/preview 视图可沿 GEN007 保持该实例，但换版本必须新建 attempt 并清除编译门槛。使用 GEN006 的实际 done/错误监听、60 秒编译截止、错误锁定、运行错误和导航失效规则；load/connected/旧 done/无关窗口消息均不能启用恢复。不在历史组件里再实现 SDK 监听或 fake-ready。

### Restore Confirmation And Reconciliation

恢复控制独立于读取/预览，状态为 idle → confirming → submitting → confirmed/conflict/busy/unconfirmed/unknown/error。恢复按钮只在非当前目标完整快照可用、当前实例实际 compiled 无已知错误、当前项目无已知活动/未知运行、没有在途写入时允许打开确认；这些本地条件不替代服务端检查。adoptionAvailability 不作恢复判断。已是当前显示事实标签，不发恢复请求。

确认对话框固定项目、目标 id/sequence、预期 current、digest 和 preview attempt，说明“将当前代码切换到此快照，其他历史继续保留；预览内临时业务输入可能重置”。用户必须先检查真实预览中的关键交互；不设置没有技术含义的 verified 勾选框，不宣称已业务验收。取消无写入；目标/项目/当前引用变化、运行状态变忙或预览错误使确认失效并解释原因。提交时仅发 strict expected，不自动触发生成或取消生成。

REV002 服务端允许同项目模板或有有效 succeeded/resultVersionId 关联的完整生成快照，校验结构和摘要，不要求 target.parentVersionId===expected。合法目标已当前可返回 alreadyCurrent=true 且更新时间不变；否则 current 必须等于 expected，活动运行返回 PROJECT_BUSY，孤立 running 返回 RUN_STATE_UNCONFIRMED，冲突返回 CURRENT_VERSION_CONFLICT，短事务 CAS 只切换引用与 updatedAt，不修改快照/消息/运行、删除未来分支或调用模型。REV-003 不重写该事务。

同工作台恢复/采用/生成互斥防重复，提交中保留查看和可读状态。其他标签页仍靠服务端 CAS；冲突刷新实际项目并保留检查目标，不能自动替换 expected 重发。busy/unconfirmed 只显示原因和现有查询入口，不擅自取消运行。确定存储失败显示安全错误；网络类不确定不能误报回滚。

有效 POST 响应需匹配 projectId/target，更新已确认当前引用、更新时间并 GET 项目校准，同时失效旧列表 current 标识；校准失败仍保留已收到的恢复确认，并单独标记项目刷新失败。若校准发现其他 current，显示最新事实，不能为了维持成功文案覆盖它。恢复确认后同步 GEN007 当前元数据/输入基线展示，保留未提交草稿但不自动提交；历史候选不删除，续写逻辑及血缘上下文交 REV004。

POST 超时、断线、解析/身份失败进入 unknown，执行一次 GET 项目。目标已是当前时确认“当前已为该版本”；不同当前只报告观察到的事实和本次未确认结果，不能证明原请求从未/不会提交。GET 也失败则保持 unknown 与“查询恢复结果”；不持续自动轮询、不自动重发恢复。明确后续恢复必须先重新取实际项目事实，重新建立有效预览/确认，不复用过期 expected。迟到 POST/GET 仍校验 activation/operation/事实 epoch，不得覆盖新选择。离开页面只停止本地等待，不能承诺服务端写入已取消；重开以 GET 项目恢复事实，不自动写入。

### Workspace Layout And Accessibility

沿用 [DESIGN.md](../../../DESIGN.md) 导航的 [atoms-frontend-design](../../../.agents/skills/atoms-frontend-design/SKILL.md) 奶油面板、炭色操作、细边框、语义状态；不增加设计依赖或全新 token。桌面在 GEN007 原壳内增加“历史”可选择面板，项目切换导航与版本选择分区，主预览仍占最大空间；中屏先折叠导航。320/375px 将聊天/历史/预览/代码作为明确可选视图，不堆叠两套工作台；切换内部视图不停止任务控制器。

原生列表/按钮和带标签区域用于版本操作；如复用 tabs，遵循既有键盘规则。选中与当前除颜色外有文字或形状提示，交互至少 44px，可见 2px 焦点与 2px offset。长标题、摘录、路径、错误换行，grid/flex min-width 允许收缩，源码长行只在自身容器滚动。状态使用 polite live region，错误可发现，预览 iframe 的 title 包含项目/版本含义。

确认对话框复用已存在可访问模式或原生 dialog，不引入弹窗库；打开后聚焦可理解内容/安全取消动作，Tab 不逃逸、Escape 取消，关闭返回原触发器；若该条目离开列表则回历史标题/合理导航焦点。加载更多保持阅读位置和触发器焦点，切换视图有当前视图/版本标签。切换/重试前和恢复确认中用简短可见文本说明代码/布局持久化范围及预览临时业务输入可能重置，不承诺业务数据库恢复。

### Verification Layers

选择 [Verification](../../../docs/engineering/verification.md) 的 UI/HTTP 变更矩阵。先行测试复用 Node test runner/固定 tsx：客户端测试覆盖运行时解析、分页游标/关联、取消、错误/未知；纯状态测试覆盖 epoch、三类身份、单次确认与并发。GEN006 的前端测试入口尚未新增，等待其真实落地；可先写纯模块和测试夹具，不为抢先运行另装 DOM 框架或第二套测试入口。展示组件可做内部 fixture 的渲染/可访问性验证，但不是公开产品测试页，不记为真实预览。

规划新增 `pnpm smoke:history` 与 `scripts/history-smoke.cjs`（目前尚未新增），作为本模块局部浏览器验证，使用现有 playwright-core/Chrome、本次所属服务及临时真实 SQLite；先 build。它在 GEN007 的真实工作台通过可见操作加载历史、预览、源码、确认恢复，不创建测试工作台。内部预置明确 fixture 模板/成功生成快照及多页记录，不向生产增加假模型开关，不用拦截 ready 代替真实编译。

| 局部场景 | 断言 |
| --- | --- |
| 多页/元数据 | 超过 20/50 条，模板 v0、null 请求、fallback、长摘要/路径、并发新增；游标排他、无重复、阅读位置稳定 |
| 只查看 | 历史/当前/候选切换，同步预览与源码，仅 GET，持久 current 不变，模型请求数为零 |
| 正常恢复 | 测试生成快照含真实可操作报价控件；真实编译并调整输入观察结果，明确确认后 current 更新，其他快照/消息保留 |
| 分支/模板 | 恢复 parent 不等 expected 的合法历史与模板，不能受 adopt stale/not-candidate 条件误挡 |
| 竞争/未知 | 两标签 CAS、busy/孤立 running、503 回滚、提交后丢响应和 GET 失败；无自动重发或覆盖，查询收口 |
| 旧反馈/故障 | 延迟 A 详情切 B、旧预览反馈、真实语法/运行错误、bundler 阻断/超时；错误不能开启恢复 |
| 布局/权限 | 桌面 1280、320/375px、键盘焦点、弹窗、长文本、401/404/会话过期、无宿主溢出 |
| 重开 | dev/preview 相对 API、刷新及所属构建后端重启，保留 cookie/DB，比较当前 ID/完整摘要/文件，新轮预览重新编译，零生成 POST |

证据写忽略的 `test-results/history-workspace/`，注明 fixture、源码差异、命令/退出码和未验证范围，不上传 DB/cookie/完整源码或需求。仅清理本次服务、浏览器和临时 DB，端口场景串行；不能停用用户服务。外部 bundler/下载网络缺失则正向预览未通过，保留失败证据。现有 `pnpm check`、`pnpm build`、`pnpm smoke`、`pnpm smoke:template`、`pnpm smoke:projects` 为已存在命令；`pnpm --filter @atoms/frontend test`、`pnpm smoke:candidate`、`pnpm smoke:workspace` 是 GEN006/007 尚未新增的计划命令。不能报告这些计划命令已运行。

## Risks / Trade-offs

- 上游工件存在但组件不可用 → 独立逻辑与 fixture 先行，真实接口/预览/工作台闸门满足后再集成，不把临时产品页当交付。
- 历史列表多个时间点的 current 标识或迟到查询覆盖新事实 → 当前事实 epoch、统一徽标、写入确认后失效旧读取并 GET 校准。
- 浏览器编译反馈不是可信验证 → 仅作本地交互门槛，实际业务操作单独检查，后端不存 verified，也不信任预览消息。
- 恢复响应未知及多个标签页竞争 → 固定载荷、服务端 CAS、无自动写重试，GET 只确认当下事实，重新操作需新鲜确认。
- 版本切换使业务临时输入丢失 → 操作前可见说明，平台草稿与预览业务状态分开；不声称恢复业务数据。
- 海量历史和长文本压缩布局 → 有界分页/响应、局部折叠/滚动；不自动加载全部快照，不增加虚拟列表依赖。

## Migration Plan

1. 后续获得实施授权后，先按协调契约做客户端/纯状态/展示组件及 fixture；GEN006 测试入口不可用时只报告实际可执行的检查，不另建产品入口。
2. REV001/002 和 GEN006/007 实际可用后，消费权威 schema、共享预览/源码和原工作台导航，加入历史视图与确认控制，守住生成/采用/恢复互斥及身份隔离。
3. 执行聚焦逻辑与局部真实浏览器回归，更新实现时确有变化的 README、Verification、Development 和 owning design skill；当前规划不编辑这些文件。
4. 串行运行对应命令并记录证据，交 REV004 确认后的当前基线和 REV005 完整验收输入。结构 validate 只证明规划结构。
5. 如需回退，停用历史 UI/恢复入口并撤回本模块应用产物；保留数据库、历史快照与当前引用，不清库或静默切回旧版本。服务端恢复事务的回退由 REV002 维护。
