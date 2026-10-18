# Design

## Context

动机见 [proposal.md](./proposal.md)，行为契约见 [generation-execution](./specs/generation-execution/spec.md)。当前应用只有健康请求；`app.ts` 构造 Fastify，`server.ts` 负责监听/关闭，前端 dev/preview 已代理 `/api`，尚无生成路由、运行管理或 SSE。GEN-001～004 都是待实施依赖，以下消费其模板、会话、快照、生成记录、取消信号和活动约定，不代表这些能力已经运行。

GEN-004 明确生成在请求生命周期内执行、最多 6 次模型请求，保存的是 unverified 候选且不改变当前版本。GEN-005 增加公开执行与进程管理，不扩大模型权限或把候选变成可用版本。现有 Node 测试器、Fastify injection、playwright-core 和系统 Chrome 继续使用。

## Goals / Non-Goals

**Goals:**

- 用一条有归属的流连接承载一次生成，使受理、活动、取消和持久化终态一致。
- 在重复请求、断线和进程重启时通过稳定请求标识确认结果，避免重新计费或误报完成。
- 以单机小型 Demo 的明确容量与单进程所有权支持可复现的故障和生命周期验证。

**Non-Goals:**

- 不实现后台队列、浏览器离线续跑、多副本调度、历史事件重放或 token/源码逐字输出。
- 不增加工作台 UI、预览与版本采用；GEN-007 消费接口，GEN-006 处理候选，GEN-009/010 完成目标部署与真实业务验收。
- 不为本次测试增加生产假模型变量、公开诊断接口或新的测试框架。

## Decisions

### 1 三个接口以客户端 requestId 贯穿不确定结果

新增生成路由与明确的公开 Zod schema，复用 GEN-003 的 cookie、Origin、JSON 错误和归属查询。请求、JSON 响应和每个 SSE 数据对象都运行时校验；使用 GEN-004 的输入规则，不再复制一套需求/基线校验。前端没有实际产品调用方，公开 schema 仍由后端维护，GEN-007 接入时按既有契约提取原则共享，不让浏览器导入后端实现。

| 接口 | 请求与响应 |
| --- | --- |
| `POST /api/projects/:projectId/generations` | JSON `{requestId,baseVersionId,prompt}`，Accept 必须包含 text/event-stream；新受理为 200 SSE，匹配的重复请求为 202 running JSON 或 200 terminal JSON |
| `GET /api/projects/:projectId/generations/by-request/:requestId` | 查询 JSON 状态，不启动生成；客户端在发起 POST 前就持有 requestId，不依赖已收到 runId |
| `POST /api/projects/:projectId/generations/by-request/:requestId/cancel` | 严格空对象；活动任务为 202 JSON、cancellationRequested=true，已结束为 200 原状态 |

projectId/requestId 为 UUID，生成体上限 32 KiB，需求沿用 GEN-004 的 4000 字符/16 KiB。POST 均校验精确 Origin，路径/字段非法为 400，缺会话 401，来源拒绝 403，不可访问资源 404，Accept 不符 406，体积/类型错误 413/415。新请求基线或载荷冲突为 409；模型配置缺失或服务关闭为安全的 503，均在开流和受理记录之前失败。

状态 DTO 仅包含项目/请求/运行/基线 ID、持久状态、起止时间、安全错误码、cancellationRequested，以及成功时的候选 ID、实际 changedFiles 和 previewStatus=unverified；不返回需求、对话或文件正文。未知用量为 null，查询不伪造历史计数。每次查询/取消重新校验归属，B 会话和不存在资源保持同形 404。所有私有响应 no-store。

### 2 将受理与执行分开，保持 GEN-004 原入口语义

在现有生成模块增加具体的运行管理器，持有本进程活动 Map、每个运行的 AbortController、所属连接、执行 Promise 与最终化标记。仅同步维护本地准入，不引入通用调度框架。

将 GEN-004 内部步骤提取为“预检/受理”和“执行已受理运行”，原有内核/CLI 入口仍组合这两个步骤并保持行为。路由先校验、检查重复、取得准入槽，再原子受理 running+user 消息并注册运行；中间没有可导致两个请求越过准入的异步窗口。构造或受理失败释放本次槽位，模型未调用。

新连接提交 accepted 并交给流传输后才启动执行，传入该连接的取消信号和活动观察者；连接在执行前已经关闭则不发模型请求。Promise 始终有收尾处理，异常不逃逸成未处理拒绝。模型过程继续在 SQL 事务外，成功/失败存储沿用 GEN-004 的条件与短事务。

重复请求在容量与日配额扣减之前查询：载荷相同只返回原状态，不再占槽或绑定新连接；载荷不同返回 REQUEST_CONFLICT。原任务的断线处理只绑定最初受理的流，不能被重复 POST、状态查询或取消响应的连接关闭误触发。

若数据库仍为 running 但活动 Map 中没有执行者，返回 503 RUN_STATE_UNCONFIRMED，而不是 202 假运行；该项目的新生成也拒绝进入。原输入和记录保留，由下一次成功启动恢复收口，不通过重新请求模型覆盖不确定状态。

### 3 事件协议只传可验证的任务活动

采用 POST fetch 读取 SSE，避免先启动任务、再连接 GET 的空窗，也避免 EventSource 自动重连被误用为重新生成。每个业务帧为 UTF-8 的 `event: <name>` 与单行 JSON `data:`，以空行结束；换行由 JSON 编码处理，不直接拼接模型文本。格式参考 [WHATWG SSE 标准](https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream)。

| event | 含义 |
| --- | --- |
| `accepted` | 第一帧、seq=1，受理事务已提交；含项目/request/run/base ID 及时间 |
| `activity` | 映射 GEN-004 的真实模型请求、工具、校验和候选保存；含递增 seq 与严格允许的元数据 |
| `terminal` | 最多一个，返回持久化 succeeded/failed/cancelled/interrupted 的状态摘要；无法确认落盘时 status=unknown、terminalStatePersisted=false、无成功候选声明 |

仅暴露工具名、步骤、字节数、实际修改路径及安全分类。GEN-004 的运行结束回调不再映射为另一种终态事件，统一由管理器最终化发出 terminal；saved 只来自成功提交。正常完成不是依靠百分比、定时描述或推理文本判断。

心跳为 `: keep-alive` 注释，每 10 秒最多一条，不计 seq 和产品进度。没有 `id:`、`retry:` 或事件日志，不支持 Last-Event-ID 重放；断流后只查询状态，不能重放 POST 来恢复活动。终态已存但流末帧丢失，查询仍返回成功；EOF 无末帧本身不构成成功。

### 4 显式帧校验和有界背压

使用 Node Readable 向 Fastify reply.send 提供事件流，保持框架连接管理。已核对仓库固定 Fastify 文档：stream 属于预序列化数据，不经过普通响应 schema；因此每帧必须在编码前显式通过 Zod，不依赖 JSON serializer 自动过滤字段。参见 [Fastify streams](https://fastify.dev/docs/latest/Reference/Reply/#streams)。

响应设置 `Content-Type: text/event-stream; charset=utf-8`、`Cache-Control: no-store, no-transform`、`X-Accel-Buffering: no`；不设置 Content-Length、不为 SSE 添加压缩缓冲。accepted 立即进入传输，而不是等模型结束后一次性返回。

每帧最多 8 KiB，业务帧累计最多 128 条/256 KiB；待发送队列最多 32 帧/64 KiB，传输使用固定 16 KiB highWaterMark，不以它代替队列上限。暂时背压时停止泵送，心跳不继续堆积；超过积压限制或等待可写超过 5 秒即中止未完成运行、销毁所属流，按 SLOW_CONSUMER 或 STREAM_WRITE_FAILED 分类。终态完成后的发送也最多等 5 秒，失败后保留数据库终态供查询。

每帧的 schema/字节失败由传输层显式触发 AbortController，不能仅向 GEN-004 的观察回调抛错后被吞掉。若候选已经提交，只关闭流，不改成功。超限和断线最终清除计时器、队列、监听器与连接引用，槽位在执行收尾后释放。

### 5 取消、断线与提交竞争共用一个终止来源

显式取消通过所属活动 Controller 发送 USER_CANCELLED；未完成时返回 202 和“已请求取消”，不提前写一个虚假的 cancelled。底层请求及后续步骤沿用 GEN-004 中止行为，最终记录 cancelled 后查询才返回该终态。重复取消无副作用，终态取消返回 200 原状态。

只监听原 SSE 的响应关闭/错误并结合正常完成标记，判断 CLIENT_DISCONNECTED；不能使用 POST 请求体正常读完的 close 事件判断浏览器离开。Node 的 ServerResponse close/finish 可区分提前关闭与正常发送，实施使用项目 Node 22 的已有 API，并用真实 socket 验证，不依赖较新运行时功能。

控制器在事务提交前取消则禁止成功；成功事务已提交则结果固定，即使末帧丢失或取消随后到达。取消接口、连接关闭、超时与进程关闭均不能再次覆盖已有终态。管理器最终化与存储更新采用仅 running 可转换的条件，并防止重复发出 terminal 或重复释放槽位。

当前 Vite 包内的代理已包含响应提前关闭时销毁上游请求的代码；这只是源码发现，本地 dev/preview 必须实际验证传播。未来最终反代也要验证断线和缓冲；后端只能在观察到连接关闭时中止，不保证所有网络故障瞬时可见，GEN-004 总截止时间始终是兜底边界。

### 6 与 Demo 规模匹配的准入和配额

固定初始限制：每项目 1 个、每会话 1 个、全局 2 个活动运行。项目忙返回 409 PROJECT_BUSY，会话忙返回 429 SESSION_BUSY，全局满返回 503 GENERATION_CAPACITY；不排队。容量类 429/503 提供 Retry-After: 5，但不承诺等待后自动受理。状态和取消不消耗生成名额。

复用 @fastify/rate-limit，生成 POST 每 IP 6 次/分钟；状态与取消分别使用 120 次/分钟/IP，防止无法查询或取消被生成限流连带阻断。trustProxy 保持关闭，不把任意 X-Forwarded-For 当身份。公开部署经反代时可能共享 IP 配额；首轮不扩展可信代理策略，按最终环境明确调整并验证。

每会话滚动 24 小时最多 20 个新受理，从既有项目归属与 generation_runs.startedAt 查询，在受理事务内校验；已受理的失败/取消也计数，重复请求不重复扣减。到限返回 429 GENERATION_QUOTA，Retry-After 按最早计数运行离开窗口的时间计算。必要索引沿用实际迁移机制添加，不建配额服务或队列表。

运行 Map 的占用包含取消收尾阶段，不能发出 abort 就提前复用容量。无执行者的遗留 running 视为未确认并阻止该项目再次进入；数据库不可用时不使用内存配额替代持久规则。

### 7 同库单服务所有权使启动恢复可信

在后端显式声明仓库已固定的 proper-lockfile@4.1.2 运行依赖及必要类型，更新唯一 lockfile；不依赖根开发依赖偶然可见。此处解决“第二个后端不能把仍在运行的任务恢复为中断”的实际需要，不是分布式执行锁。

启动按已验证路径建立父目录，仅在文件不存在时创建空文件且不截断已有文件，再解析 realpath；取得该文件对应的 `<canonical-database-path>.generation.lock` 后才打开迁移/恢复。使用相同 stale=30000ms、update=5000ms、retries=0；竞争失败立即拒绝启动。只用库返回的 release 释放自己的所有权，不手工删除未知锁。

取得所有权后，在短事务中将所有遗留 running 条件更新为 interrupted、PROCESS_RESTARTED 和完成时间；不改变 succeeded、快照、消息或 currentVersionId，不重新调用供应商。该事务失败则不监听。硬杀后在库判断 stale 前启动可失败，30 秒窗口和重试方式写入 Lifecycle；不以强行删锁缩短验收。

onCompromised 关闭准入、使当前执行失去成功写入权限并触发有界退出，日志只给安全分类。所有权适用于同一台机器的本地文件系统及遵守相同协议的单服务部署；不承诺网络盘、多副本或外部程序写数据库的协调。

### 8 在 preClose 中结束活动流，再释放存储

已核对固定 Fastify 的关闭顺序：preClose 时仍有活动请求，onClose 在连接排空后才执行。SSE 若等到 onClose 才中止会阻塞关闭，因此根资源所有者在 preClose 先停止准入、发 SERVER_SHUTDOWN 并有界终止流；依据 [Fastify preClose](https://fastify.dev/docs/latest/Reference/Hooks/#preclose)。

总收尾预算 5 秒，包含等待与必要终态写入；数据库等待使用剩余预算，不在期限后追加无限清理。正常响应中止完成则持久化 cancelled；超出清理期的运行撤销写入许可，并在仍有预算且存储可写时条件标为 interrupted/SERVER_SHUTDOWN。无法落盘保持未确认，下一启动恢复。预算耗尽时关闭所属流，不等待其自然结束。

为当前运行保留不可逆的最终化/写入许可标记，GEN-004 在成功事务和失败收尾前核对；关闭或恢复已确定终态后，晚到结果不能访问已关闭存储，也不能覆盖终态。每个执行 Promise 始终有拒绝处理，迟到回调被清理，不新增模型步骤。

onClose 使用单个、幂等的资源协调顺序：确保执行已结束或被禁止写入，关闭 store，再释放本次持有的文件所有权。不得靠插件注册顺序猜测数据库是否已经关闭。监听失败、初始化失败和信号路径都复用同一清理职责；不修改 manager 的进程归属协议。

### 9 用真实网络和受控上游验证连接语义

普通输入/归属/JSON 响应继续使用 Fastify injection。新增真实 listen({port:0}) 网络测试，使用独立临时 SQLite 与 GEN-002 的受控 SDK 上游；不以 injection 的整段返回冒充流式测试。测试可显式注入较小容量、配额、心跳和等待阈值，不开放生产请求参数或假模型变量。测试完成清理自己启动的端口、请求和数据，不停止其他程序。

| 场景 | 关键断言 |
| --- | --- |
| 受理与分块 | 上游 gate 未释放时已读到 accepted，释放后才完成；业务帧序号/关联正确，UTF-8 和多帧跨网络块不丢失 |
| 归属与重试 | A/B cookie、Origin、体积、Accept、重复 POST JSON、载荷冲突和状态查询；关闭重复连接不影响原流 |
| 取消与断线 | 显式取消、read abort、socket 销毁、成功后丢末帧；同时观察上游请求中止、数据库终态和候选数量 |
| 准入与资源 | 同项目/同会话/不同会话并发、全局满载、滚动配额、慢读者、帧/队列超限，清理后容量可用 |
| 存储故障 | terminal 未确认与无执行者 running 返回安全未知；旧版本可读且新请求不掩盖故障 |
| 进程与所有权 | 第二服务不同端口同库失败、SIGTERM 有限关闭、SIGKILL 后按 stale 规则重启、遗留 running 恢复且成功记录不变 |
| 迟到与隐私 | 忽略中止的受控结果在收尾后不能写库/发第二终态；哨兵正文不进入 SSE、状态或日志 |

新增计划命令 `pnpm smoke:generation-stream` 和 `scripts/generation-stream-smoke.cjs`，要求先 build，使用现有 playwright-core/Chrome。测试专用启动器导入真实 dist 应用、存储、运行管理与模型客户端，只注入本地受控传输与假密钥；不向生产入口增加开关。浏览器从现有首页 fetch 相对 API，经 dev 和 preview 代理验证首帧、完成、显式取消、断流及状态确认。关闭并重启所属构建后端，检查状态恢复与原当前版本不变。

自动化结果统一标记 fixture，证据写入忽略的 `test-results/generation-stream/`，仅保留安全摘要与必要截图，不上传数据库、cookie、请求正文或测试认证状态。新命令当前不存在，实施时加入并更新 Verification。产品客户端与 UI 仍由 GEN-007 负责；本地代理通过不等于最终服务器反代通过。

## Risks / Trade-offs

- POST 流没有 EventSource 自动重连 → 客户端先保存 requestId，断线后查询状态；不通过自动重发计费请求恢复活动。
- 代理缓冲或延迟关闭使取消不及时 → 本地验证实际分块/中止，保留核心总时限；最终反代另验缓冲、读取超时和断线传播。
- 本地文件所有权在硬杀后有 stale 等待 → 文档说明 30 秒窗口并测试真实恢复，不绕过库手工删锁。
- 数据库故障导致终态未知 → 保留输入/当前版本并阻止该项目继续生成，明确未知状态，重启恢复成功后才继续。
- 活动流关闭和资源释放存在竞争 → 单一最终化、条件存储更新、写入许可及网络/进程测试覆盖；不让回调顺序决定用户状态。
- 并行变更已调整脚本与技能目录 → 实施只修改实际需要的依赖、路由与生命周期片段，重新读取既有代码并保留他人修改。

## Migration Plan

1. GEN-001～004 实际代码可用后接入公开 schema、受理/执行拆分与运行管理，保持旧内核和 CLI 行为。
2. 加入后端实际文件所有权依赖、必要索引和恢复；配置默认容量，不新增队列或外部基础设施。
3. 完成路由、显式帧校验、流传输和取消/关闭测试；先使用临时数据库及受控上游，不需要真实模型密钥。
4. 加入真实网络/子进程与浏览器 smoke，更新 README、Development、Lifecycle、Verification 及 Monorepo 的实际规则和前提。
5. 串行执行 frozen install、pnpm check、pnpm test:manager、pnpm smoke（含 build）、新增 smoke:generation-stream 及受影响项目回归；最后严格校验本 change，记录实际源码差异与结果。
6. 回退前先停止活动生成并保留全部数据，再停用新增公开入口；不删除运行、消息、候选或数据库。真实模型全流程及最终反代分别由 GEN-010、GEN-009 验收，不将本地 fixture 结果标为 live。
