# Design

## Context

动机与边界见 [proposal.md](./proposal.md)，可观察保障见 [revision-acceptance](./specs/revision-acceptance/spec.md)。本轮只规划，REV-005 的任务均未实施。

已只读核对 [Verification](../../../docs/engineering/verification.md)、[核心路径](../../../docs/product/core-paths.md)、根 package scripts、project-smoke.cjs/control 测试及模板 smoke 模式：`pnpm smoke` 自带 build；`smoke:template`、`smoke:projects` 消费已有构建。现有 Chrome/playwright-core、真实临时 SQLite、显式测试传输、端口 bind 预检、所属进程与 130/143 信号处理可复用，不需要新测试框架。当前内部 generateProject 校验 current 基线并保存未采用候选，真实 quote 已保存但仍 preview-unverified；公开生成、采用、工作台和历史恢复尚不能据此视为可用。

[GEN-008](../gen-008-integrated-regression/design.md) 提供未来隔离/串行/报告方案，[GEN-009](../gen-009-local-release-validation/design.md) 负责独立产物、Nginx、部署及持久目录，[GEN-010](../gen-010-live-generation-acceptance/design.md) 负责 Top 1 双需求 live。其工件包含早期现状描述，实施时按真实源码、命令和最新证据确认依赖，不改写其历史记录。本轮 REV-001～004 的输入契约以用户明确范围为准；其他代理正在规划的目录不构成已实现依赖，不写入这些目录。

## Goals / Non-Goals

**Goals:**

- 同一项目、同一作者会话下核对版本图、当前引用、业务结果与请求次数，证明恢复和续改实际相连。
- 用无凭据可控故障覆盖竞争与未知状态，再以明确触发的真实模型需求验证业务质量；两类结果独立成立。
- 复用已存在的测试基础与未来 GEN 辅助，保持产物、凭据、数据库和证据归属明确。

**Non-Goals:**

- 不新增生产历史/恢复/诊断接口、假模型配置、迁移或分支管理器；REV-001～004 拥有产品行为，REV-005 只落实验收。
- 不重复 GEN-010 两个独立项目的 Top 1 验收，不替代 GEN-009 本地部署和最终服务器检查。
- 不实现 Top 3、逐行 Diff、模型评判、自动修复/重试、任意模型/上游切换或额外探针。

## Decisions

### 1. Dependency Contracts

| 拥有者 | 对接与观察依据 | 本次检查 |
| --- | --- | --- |
| REV-001 | `GET /api/projects/:projectId/versions?limit=…&beforeSequence=…` | sequence 倒序、排他游标、不重不漏；current/parent、需求摘录、摘要、changedFiles 与持久版本一致；列表不含代码，正文走 GEN-006 单版本读取 |
| REV-002 | `POST /api/projects/:projectId/versions/:versionId/restore`，JSON `{expectedCurrentVersionId}` | template 或有效 succeeded 生成快照；原子 current CAS、busy/unknown、故障回滚；所有历史不变且零模型请求 |
| REV-003 | GEN-006 隔离预览与 GEN-007 工作台内的历史入口 | 所选预览与持久 current 分开；先预览后确认，取消不写；错误/焦点/临时输入重置说明 |
| REV-004 | 服务端 current、快照 parent 链与全项目序号 | 新 run 基线和 parent 指向 current，相关上下文排除其他分支；新 sequence 为 max(sequence)+1，旧历史保留 |

这些是验收输入，不在此重复设计 API 状态码或添加公开观测字段。实施时将断言绑定所属工件的实际 DTO/error code；若依赖缺失则 blocked，发现契约冲突交回对应 REV 修订，不用空入口或宽松断言通过。选择消费既有边界，避免由验收 runner 承担产品实现。

### 2. Fixed Business Cases

公开测试输入只描述功能、数据和可访问名称，fixture 可包含明确标记的测试代码，live 不提供代码实现。V0 为模板，V1/V2/V3 为演示标签；以实际 ID/sequence 关联，不依赖数据库行号。主路径之外的负向场景使用独立项目，防止额外候选污染主路径序号。

| 阶段 | 明确动作与业务 oracle | 持久化与模型事实 |
| --- | --- | --- |
| V1 | 正常工作台提交设计工作室报价/案例筛选需求；官网基础 2000、电商 5000、每页 300，官网 1/4 页=2300/3200、电商 4 页=6200；零售案例两项、科技一项，全部/行业筛选可往返 | 从 V0 生成，真实编译与交互后明确采用 V1；候选保存时 current 仍 V0 |
| V2 | 明确追加“加急”选项，附加费为基础报价的 20%，单列费用和总额；官网 4 页=3200，启用后附加 640、总额 3840，关闭恢复 | 基线/parent=V1；生成成功不自动采用，交互确认后采用 V2；保存 V1/V2 内容哈希 |
| 历史预览 | 查询历史、翻页、选择 V1并实际操作报价/筛选/导航，取消一次恢复确认 | V1 无加急，current 仍 V2；查询/读取/预览/取消模型增量为 0 |
| 恢复 | 再次预览 V1并明确确认恢复，刷新页面、停止并重启本次后端，再打开同一项目 | current=原 V1 ID，V1/V2 哈希不变、没有恢复副本或新版本；V2 仍可历史读取，重开增量为 0 |
| V3 | 明确提交“增加维护服务，勾选后固定加 500 元并单列，不引入加急”，官网 4 页关闭=3200、开启=3700，电商 4 页开启=6700 | 服务端基线/parent=V1，sequence=max+1；候选编译与业务成功后明确采用 V3；V2 留存，V3 不含误复活的加急控件/附加费 |

每个版本检查原导航、案例筛选、报价合法输入与非法页数反馈；以可见控件、结果和案例集合断言，不以源码关键词或固定文件名判断业务。历史 V2 仍应可预览加急，V3 无加急与 V2 保留并不矛盾。保存内容按规范化文件集合计算哈希，同时核对 snapshot digest、入口、依赖、模板来源；选择切换不应改变任何旧文件字节。业务临时输入在预览重建后可重置，不误报平台数据丢失。

### 3. Credential-Free Automation

未来新增 `scripts/revision-smoke.cjs`、必要的具体场景辅助与 `revision-smoke-control.test.mjs`，根计划命令为 `pnpm smoke:revision`；不在本次创建。该专项不自行 build，沿用现有项目专项的语义：先 `pnpm check` → `pnpm smoke`（已含 build），再串行执行 `pnpm smoke:projects`、`pnpm smoke:revision`；无需再插入一次 `pnpm build`。仅单独运行专项时先 `pnpm build`。

浏览器主路径通过可见工作台提交三条需求，经过真实平台 HTTP、SDK 工具往返、临时 SQLite 和真实 Sandpack 编译；测试专用启动器仅在应用构造参数注入 loopback 受控传输和假配置。它不得进入生产包、环境开关或新产品测试页。不能预种成功候选代替主路径，单元负向 fixture 的内部写入与主路径来源分别标记。子进程白名单环境不继承真实模型凭据、开发 `.env` 或 DATABASE_PATH，仅使用本次绝对 DB 路径；外部 Sandpack/依赖网络仍是前置，不代表完全离线。

从 fixture 实际 SDK 请求捕获中检查 V3 的首轮及后续上下文：包含 V1 parent 链的需求与文件，排除 V2 分支独有加急需求和摘要，也排除其他分支/失败取消记录。只看最终页面没有加急不足以证明上下文隔离；此断言放在测试传输边界，不开放产品上下文接口。请求正文只在本次测试内比对，不导出。采用真实 SDK 往返可同时验证预算和上下文；纯内核调用或替换 iframe 会漏掉 UI/HTTP/编译边界，不作为主路径替代。

### 4. Failure And Race Matrix

| 场景 | 操作与必需结果 |
| --- | --- |
| 失败/取消/未确认生成 | 受控上游拒绝、非法输出、延迟取消及终态保存故障；保留输入/current/历史，不能把失败候选视为已采用；活动/unknown 时恢复按契约阻止；晚到结果不污染选择 |
| 预览故障/取消确认 | 真实语法/运行错误、bundler 不可达、切换旧实例晚到信号；错误不能标业务通过或误启确认；取消对话框不发恢复，键盘焦点回原入口 |
| CAS/busy | 两标签页用同一 expectedCurrentVersionId 恢复不同有效目标，至多一次切换；恢复与生成受理竞争以服务端事务结果判定，不能覆盖胜者或自动换基线重发 |
| 恢复存储失败 | 只在自有数据库/应用构造中注入事务故障；原 current 与所有版本哈希一致，错误可见，不能出现部分更新 |
| 响应丢失/查询不可用 | 实际服务提交后丢弃确认响应；先显示待确认，只查询 current；查询也失败继续未知，恢复后读到实际结果，不自动重发恢复/生成 |
| 跨会话/跨项目 | 新浏览器上下文无法列表、读取、恢复作者资源；与不存在资源语义一致，无会话按既有 401；伪造目标不改数据库 |
| 缓存/跨页/重开 | 翻历史页、另一标签改变 current、旧请求晚到、刷新/同库停启；列表与当前标记正确，旧页不成为新生成基线，无模型副作用 |
| 窄屏/键盘 | 桌面与 320/375px 观察宿主及 iframe 实测尺寸、长摘要/路径、历史分页、预览、确认/取消、错误重试和焦点；无横向溢出，输入法/Enter 不误提交 |

每个故障先证明真实触发，再检查预期保护。负向用例 passed 表示保护断言成立，不表示生成/恢复业务成功；错误形状和未知规则复用 owning REV/GEN。付费 live 不重复这一矩阵。

### 5. Explicit Live Acceptance

未来新增独立 `pnpm smoke:revision:live --live`，复用 GEN-010 的安全调用事实/工作台辅助和现有 GEN-002 模型配置加载规则，运行正常生产客户端和构建后端；不注入 fixture、不调用内部 generation smoke 绕过 UI。无参数/帮助/非法参数不读取秘密、不请求模型，缺 `--live` 拒绝执行。现有 `backend/.env` 或进程环境按正常规则只交给后端，runner 不复制环境文件、不输出值、不改模型/端点/预算、不接触开发数据库。

先确认依赖与 fixture 自动化通过、构建身份相同、Chrome/端口/Sandpack 和配置前置齐备；预检不额外运行探针。随后通过正常工作台分别明确提交 V1、V2、V3，每个新需求仅一次；预览/采用/恢复都按正常可见操作。计划最多三轮生成，沿用每轮最多六次供应商请求，共至多十八次，maxRetries=0；沿用既有期限、输出/上下文/文件上限，不因验收扩大。记录实际 dispatch、响应和用量，未知为 null，不将零作为缺失计数，不承诺金额封顶。

为每次查询、历史预览、恢复、采用、刷新、重启分别记录累计 dispatch 前后差；这些阶段增量必须为 0。首个失败、阻塞、未知或超预算就停止后续新需求，不重新生成、不“修一下”、不自动换模型或补跑。不确定生成只查询原 requestId；不确定恢复只查询 current。真实专项不被默认 check/smoke/verify/CI 调用；默认仅可运行无凭据控制测试。

fixture 已证明上下文结构，live 复核真实 run.base/parent、内容哈希、V2 留存与 V3 无加急的业务表现；不为 live 记录完整敏感上下文或新增生产接口。若现有安全调用事实不足，只按 GEN-010 的内部白名单观测补齐并重新构建/回归，不得把无计数记录视为零请求。真实模型质量失败保持失败证据，不能手改候选迁就 oracle。

### 6. Runner Ownership And Evidence

复用现有专项的 bind 预检、登记所属子进程/浏览器、截止时间和 finally 清理，按实际可用情况复用 GEN-008 具体辅助；不引入通用编排框架。3001/5173/4173 场景严格串行，live 与 fixture/原 smoke 不并跑；启动后的端口竞争仍需失败，不按端口杀进程或停止用户服务。没有可用辅助时实现本专项必要的最小逻辑，不假设未来 `verify:product` 已存在，也不修改 GEN-008 计划范围。

每次唯一 runId，未来证据置于忽略的 `test-results/revision-acceptance/<runId>/{private,export,runtime}/`，fixture/live 分开运行目录；记录 source/build/harness 摘要、caseVersion、环境、项目/run/request/版本 ID、sequence/parent/current、哈希、阶段计数、结果、时间与清理。状态为 passed/failed/blocked/cancelled/not-run；缺脚本/工具/依赖 blocked，普通超时或断言失败 failed，后续 not-run，空/旧/不匹配报告不能通过。源码/构建变化需新证据，不能拼接旧截图证明新代码。

报告原子落盘，开始为 running，只有所有必需断言与清理完成才标自动化 passed；最终验收另要求实际桌面/窄屏页面复核，保存观察与对应截图，不仅检查截图命令成功。private 保存需要本机复核的数据库、会话和日志，不上传；export 仅含白名单摘要及已遮罩截图，不含凭据、cookie、提示词/代码正文、HAR/trace 或供应商原始错误。运行临时副本与浏览器可清理，需保留的关闭后数据库只留 private；不能删除用户数据、历史证据或不明资源。

SIGINT/SIGTERM 停止新场景与请求，取消在途操作，仅清理本次所属资源，十秒内完成并写最终报告，退出 130/143；清理失败另标失败，整体不可通过。普通失败/缺前置非零，清理未完成不启动下一占端口专项。控制测试用真实外部占用者和已启动 Chrome/后端验证端口保护、两种信号、无残留进程/监听与临时目录清理；硬杀残留不自动接管，下一轮明确阻塞。

### 7. Local And Online Boundaries

本地 fixture 证明工程与保护链，本地 live 证明本次三个明确需求；两者不代表线上通过。线上验收需单独选定目标、匹配构建/产物及 GEN-009 部署证据，在最终域名验证会话、反代、预览可达与同库重启；若线上需要生成，仍必须逐项明确触发，不能本地通过后自动付费重跑或发布。

GEN-009 的发布完整性、Nginx/SSE、冷备份、数据目录、最终环境要求不被本任务取代。后续 README/Verification 只记录真正可运行命令和实际证据，Lifecycle 继续拥有所属起停和持久目录，core-paths 仅在实际验收后更新 Top 2 状态；本轮不编辑这些文档。Top 3 始终独立且不在范围。

## Risks / Trade-offs

- 上游工件与实现不同步 → 当前观察与未来入口分开，依赖不齐明确 blocked，不据状态工件推断运行成功。
- 模型能生成但业务错误 → 固定可操作 oracle，分别记录编译/业务/采用；失败不自动修复或计费重试。
- 页面没加急却上下文仍混入旧分支 → fixture 捕获实际 SDK 上下文，live 核对基线/parent 和业务，两类证据相互补充。
- 外部 bundler 网络与模型不稳定 → 有界等待，明确失败/阻塞，不伪造 ready 或接受旧成果。
- 未知响应与并发易误报失败/成功 → 查真实 current/run；CAS 和事务结果决定结论，未知仍保留未知。
- 停服测试污染其他任务 → 独立 DB/cookie、端口串行、资源归属与真实信号控制测试；只清理本次资源。

## Migration Plan

1. 先固化场景、oracle、契约映射和无凭据 fixture，等待 GEN-005～007 与 REV-001～004 对接能力实际就绪。
2. 实现本专项 runner、故障/控制测试与隔离报告，接入未来命令及文档；不得新增生产假模型配置。
3. 执行 check、含构建 smoke 与专项串行回归，绑定实际源码/构建；全部通过后再准备 live。
4. 单独显式执行一次 live 主线与实际页面复核，按观察记录通过/阻塞/失败和未运行的线上范围，完成才勾选任务。
5. 如撤回工具，仅撤回新增 runner/命令/文档接入；保留项目历史和已有证据，不回退数据、不改写其他 GEN/REV 完成状态。
