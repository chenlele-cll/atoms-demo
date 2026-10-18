# Development conventions

本文件维护日常开发规则。修改代码、API、配置或数据访问时按相关章节阅读；目录与依赖边界见 [Monorepo contract](../architecture/monorepo.md)，检查范围见 [Verification](./verification.md)。

## TypeScript and source files

- 保持 TypeScript strict 及根配置的约束。禁止用 `any`、非空断言或类型检查抑制掩盖错误；不可信数据先使用 `unknown`，再解析或收窄。
- 类型导入使用 `import type`。前端沿用 Vite 的模块解析方式，后端 NodeNext 导入遵循现有 `.js` 路径写法。
- React 组件沿用 PascalCase 文件名，组件样式使用 CSS Modules；普通模块按职责命名，沿用所在目录模式，不为本次任务批量改名或格式化无关文件。
- 基础格式以 [.editorconfig](../../.editorconfig) 和 [ESLint 配置](../../eslint.config.mjs) 为准，优先使用平台 API，新增工具或依赖先说明当前用途。

## HTTP and runtime validation

- 输入、外部 HTTP 响应和模型输出在各自边界做运行时校验，TypeScript 类型不替代校验。
- Fastify 路由定义明确的请求和响应契约；HTTP 客户端显式处理非成功状态、解析失败和取消。
- 同一契约维护一个权威 schema，避免手写两份相同规则。模型结构化输出的 schema 接入方式在首次实现时核对版本兼容性。
- 外部网络调用设置明确的超时，并将失败转换为可理解的结果；不能将空响应、半成品或错误状态报告为成功。

## Configuration and logging

- 秘密保留在后端配置，前端环境变量与生成预览均视为公开内容。监听配置在开始服务前解析；可选模型配置仅在显式调用边界校验，健康接口与普通服务启动不依赖模型凭据。
- 后端使用 Fastify 的结构化日志；错误以 `{ err }` 传递。默认不记录提示词、生成文件正文、凭据或会话令牌。
- 修改实际命令或配置时，同步更新 README 与相关 `.env.example`；模板只放必要名称、说明和安全示例值。
- 环境文件、持久数据和本地工具产物遵循 `.gitignore`；原始题目材料保持本地参考用途。

模型客户端只读取已校验的 OPENAI_BASE_URL：默认官方 `https://api.openai.com/v1`，另允许用户明确指定的 `https://ai.elegantyc.com/v1`，没有任意地址或 SDK 隐式覆盖，不跟随重定向。报告标明实际 provider/baseURL，兼容服务结果不代表官方权限。先将供应商异常转为 `ModelError` 的允许字段（code、HTTP status 或 null、retryable），再交给日志或报告；不记录 SDK 异常 cause、原始 body、headers、提示词或文件正文。`retryable` 仅为提示，不触发重试。分类为 configuration、authentication、model_access、quota_rate_limit、upstream、network、refusal、invalid_output、truncated、timeout、cancelled；报告缺失用量使用 null。SDK 的原始 warning 文本也不进入日志。

## Generation when implemented

当前已有有界生成内核、独立验收入口及 GEN-005 公开生成/事件接口。`client.run` 建立操作截止时间，内部 `session.step` 每次只执行一个模型步骤；工具分派和下一步必须留在同一作用域内，并在分派前检查取消。GEN-002 探针仍独立于项目；实际生成契约见下节。所有生成继续遵守以下边界：

- 对文件路径、依赖范围、输出体积、步骤数和总时长设置限制；模型结果通过 schema 校验后仍需验证实际编译与交互。
- 生成代码在隔离的预览或执行环境中运行，不能在宿主后端进程中执行，也不能获得后端凭据。
- 任务阶段、工具活动和完成状态必须对应实际发生的工作，不能模拟模型执行或将未验证代码标记为可用。
- 明确定义失败、超时、取消和断线时的任务行为，失败时保留上一个可用快照。
- 初期请求内任务不承诺关闭浏览器后继续执行；需要可靠后台续跑时再实现相应机制。

## Bounded generation

GEN-004 的 backend/src/generation/contracts.ts 是内部请求、结果和工具的 Zod 来源。generateProject 只接受会话/项目/基线/请求 UUID 与修剪后的需求（1–4000 字符、UTF-8 最多 16 KiB），不接收代码、模型配置或工具列表。先检查持久会话到期及项目归属，再查询相同 requestId；仅新请求检查当前基线、支持布局和模型配置。匹配重放返回原 run/候选，不能再次调用或追加输入；需求或基线不同为 REQUEST_CONFLICT，失败重试需要新 requestId。项目级并发准入与公开取消由下节 GEN-005 管理器负责。

上下文只含固定规则、当前快照身份/依赖元数据、冻结基线血缘的相关历史及当前需求一次。受理短事务从基线自身沿同项目 parent 链到模板，校验合法模板终点和严格递减的父序号；缺失、循环或非法终点在写入及模型调用前以 DATA_CORRUPT 失败。历史仅包含链内 generated 版本关联的同项目 succeeded run 的 user/assistant 消息，且 result/base 与版本及其 parent 匹配；模板基线历史为空，直接恢复的未采用成功版本包含自身历史。其他分支、无关联及失败/取消/中断/运行中的消息只从模型历史排除，持久对话继续保留。

先按血缘筛选，再取最近 10 条，按从近到远保留总正文不超过 UTF-8 16 KiB 的整条消息，再恢复序号顺序；超预算跳过但不从第 11 条补位。省略数为受理前全项目消息总数减实际选入数，本轮 prompt 只在末尾加入一次。代码通过工具读取同一冻结数据库快照，不从 catalog 替换项目数据。每步将工具 schema 与完整消息序列 UTF-8 JSON 计量，累计最多 256 KiB，超限失败而不截断文件。

三个工具的 schema 派生自同一 Zod 定义，strict=true、所有参数必填、parallel_tool_calls=false，无 SDK execute 或自动多步：list_files 返回冻结基线的排序路径/字节/可写标记；read_files 读取 1–8 个不同文件，正文合计不超过 96 KiB；submit_files 只允许一次终端提交 1–8 个完整文件，正文合计不超过 256 KiB。未知/多调用、额外参数、重复调用 ID 或无有效调用立即失败，不自动修复。读取结果与 SDK 的完整 response.messages/对应工具结果续接，推理续接项只留本轮内存，不进入对话、活动或日志。

company-landing 策略只允许已有 App.tsx 与 components/data/lib/generated 内的 TS/TSX 业务文件，以及已有 src/generated CSS；新文件仅在 /src/generated 下为 ts/tsx/css。根路径与 src 路径的业务规则均明确判断，实际接入使用 GEN-001 的 src 布局。入口引导、配置、许可、资源及预编译 CSS 只读。至少成功读取一个文件，覆盖已有路径必须已读取；拒绝路径绕过、重复、空正文、删除及完全无变化。全量复制文件映射后一次合并，复用快照契约校验 64 文件/2 MiB、身份和依赖，服务端重算 digest/changedFiles。新增样式使用普通 CSS；不做字符串伪编译或宿主执行，结果始终 previewStatus=unverified。

整个操作使用外部 AbortSignal，MODEL_TIMEOUT_MS 默认 0（不设累计截止），显式正值才启用共享期限，最多 6 次实际模型请求，每次沿用输出预算且 maxRetries=0。请求、工具、验证和事务前均检查；成功事务退出前再次检查，取消/超时使写入整体回滚。模型与网络等待不在数据库事务内，外部连接可写。受理原子保存 running/user；完成原子保存候选、事实摘要及 succeeded，保持 currentVersionId 不变；摘要只声明“候选已保存，预览未验证”。运行中基线改变拒绝保存。受理后失败保留输入，取消写 cancelled，超时写 failed/GENERATION_TIMEOUT；终态也写不入时返回 STORAGE_UNAVAILABLE、terminalStatePersisted=false，不冒充已持久化终止。成功已提交后到达的取消不改写结果。

活动只包含 runId、单调序号、时间、步骤、批准工具名、字节/路径、安全分类和保存标识。完成活动在相应动作后发出，saved 在事务提交后；观察者异常只计入 observerErrors，不影响事实结果。请求次数来自实际传输，用量按已观测单次值累计，任一步未知则合计 null；保留分项，重放未知指标全为 null。原始供应商异常、提示词、代码、工具正文与思维链均不进入结果或日志。进程硬杀可能留下 running，启动恢复按 Lifecycle 的独占所有权规则执行，不自动重试模型。

## Generation execution

公开生成体/路径/状态/事件以 @atoms/contracts 的 Zod schema 为权威，backend/src/contracts/generations.ts 重导出同一来源，生成内核也复用共享输入规则。状态与每帧只含关联 ID、起止时间、持久状态、安全错误、取消请求标记、候选 ID、实际 changedFiles 和 unverified；usage=null，不推测历史计数。不返回需求/对话/代码/工具正文。输入 strict，状态显式构造并校验；Fastify stream 是预序列化对象，因此 SSE 在编码前独立运行时校验，不依赖 JSON serializer。

prepareGeneration 负责归属、重放、基线/布局/配置预检；acceptPreparedGeneration 在短事务内保存 running/user，generateProject 可执行已受理运行，原 CLI 仍组合相同步骤。GenerationManager 是每个应用的具体活动 Map，持有唯一 Controller、最初连接、执行 Promise、最终化和写入许可。同步准入/受理之间没有 await；失败不占槽，重复在容量/日配额前返回原状态。一次性最终化后释放槽位；取消收尾仍占用。无执行者的 running 返回 503 RUN_STATE_UNCONFIRMED 并阻止该项目新生成；存储不可用不能由内存状态冒充成功。

默认项目/会话/全局活动上限 1/1/2，分别返回 409 PROJECT_BUSY / 429 SESSION_BUSY / 503 GENERATION_CAPACITY，不排队；后两者 Retry-After=5。生成 POST 每 IP 6 次/分钟，状态和取消各 120 次；trustProxy 关闭，不信任任意转发头。日配额在受理事务内按项目所有者与 runs.startedAt 查询滚动 24 小时最多 20 个新受理，失败/取消计数、重放不重复计数；429 GENERATION_QUOTA 的 Retry-After 按最早记录离开窗口计算。索引通过 schema v2 迁移添加，重开不重置配额。

新 POST 为 200 SSE；匹配重复为 202 running / 200 terminal JSON。开流前均为安全 JSON，开流后不再混入 JSON 错误。第一业务帧 accepted、seq=1，随后 activity 映射实际请求、工具、校验与提交后 saved；忽略内核 ended 回调，由管理器核对存储后只发送一个 terminal。每帧关联项目/request/run/base，序号严格递增；terminal.state.status=unknown、terminalStatePersisted=false 表示终态未确认，不声明成功候选。EOF/200 不代表完成。无 id/retry/事件日志，断线后仅按 requestId 查询。

流采用 Node Readable、固定 16 KiB highWaterMark；单帧 8 KiB、业务总量 128 帧/256 KiB、显式队列 32 帧/64 KiB。push 返回 false 时暂停泵送，心跳不继续堆积；背压或终态发送最多等 5 秒，溢出/写失败显式 abort 并销毁流。编码使用 UTF-8 JSON 单行 data，响应 no-store,no-transform、X-Accel-Buffering=no，无 Content-Length；心跳每 10 秒为注释，不占序号或进度。清除队列、等待/心跳定时器和响应监听，内存上界同时计入独立的 Readable 缓冲。

只绑定原 ServerResponse 的提前 close/error；POST 请求体正常读完不能视为断线。用户取消为 USER_CANCELLED，连接断开为 CLIENT_DISCONNECTED，关闭为 SERVER_SHUTDOWN，慢消费/写失败为 SLOW_CONSUMER / STREAM_WRITE_FAILED。未完成运行通过同一信号中止上游并写 cancelled；取消接口先回 202 cancellationRequested=true，终态已提交则回 200 原状态。成功事务内再次检查取消和写入许可，提交后的事实不被取消/断流覆盖。关闭/所有权丢失撤销写入许可，迟到回调不能访问已关闭存储。应用持有存储与锁的清理职责，具体顺序见 [Lifecycle](./lifecycle.md#generation-service-lifecycle)。

## Persistence when implemented

当前使用 SQLite 参数绑定、同步短事务及有序迁移；模型调用保持在写事务之外。具体契约与实现边界见下节。

平台项目、对话与代码快照的数据，和生成应用自身的业务数据分别定义。使用预览侧 localStorage 时定义项目级命名空间，不能直接描述为云端持久化；项目隔离、刷新和版本切换行为需要实际验证。

数据库文件位于部署产物之外的持久目录，停止或更新服务不能默认删除数据。使用原生依赖时在目标平台安装，不能跨操作系统复制 node_modules。

公开调用入口同时定义项目归属、访问范围和与使用规模匹配的请求及费用限制；新增队列、外部数据库等组件需要实际需求支持。

## Project persistence

@atoms/contracts 是前后端共用会话/目录/项目/消息/版本/快照/采用/run/SSE/安全错误的 Zod 契约来源，类型由 schema 推导；backend/src/contracts/projects.ts 保留可信模板限制并重导出公开契约。项目路由局部设置 Fastify validatorCompiler / serializerCompiler；请求 strict 拒绝额外字段，输出经显式 DTO 和 schema 投影，不返回 ownerSessionId、token 摘要、SQL 行或原始异常。健康契约保持独立，禁止浏览器导入后端实现。

中立 templates/bundle.mjs 的纯文件规则随准备复制到后端部署资产；Zod 快照校验调用相同规则并重算 SHA-256，限制规范化虚拟路径、入口/样式/许可/运行配置、精确依赖版本、64 文件和总 UTF-8 2 MiB。新建项目核对当前可信目录；历史快照按自身身份验证，读取不依赖当前模板。保存候选须匹配基础版本的来源、入口和依赖，不改变 currentVersionId；结构合法不证明编译通过。

storage/store.ts 管理 sessions、projects、versions、messages、generation_runs 五张表；外键和组合引用限制关联在同一项目，快照更新由数据库触发器拒绝。创建项目、带消息创建/结束 run、保存候选均在短事务内全成或全退；配额在创建事务内部检查。追加消息分配递增序号，重复项目内 requestId 拒绝。只有内部编排调用这些写入方法；没有任意消息/文件写入接口，版本读取与条件采用见下节。run 的 succeeded 仅代表候选落盘，不代表预览验收。

持久会话使用随机 32 字节 token，数据库只存 SHA-256 摘要和 30 天到期时间。每个私有请求检查有效会话和 owner 条件；失效后初始化新会话不能认领旧项目。POST 只接受精确配置的 Origin 和 JSON；默认 trustProxy 关闭，不以伪造转发头绕过限流。请求体 8 KiB、项目 20 个/会话、消息 16 KiB、列表 50 条为初始边界，限流与配额可由显式构造参数在测试中缩小。

项目错误只使用固定 code/message/requestId：输入 400、会话 401、来源 403、资源 404、模板/配额 409、超大体 413、类型 415、频率 429（Retry-After）、存储不可用 503、损坏记录 500。底层 SQL、绑定值、绝对路径、cookie、提示词和代码不进入错误或日志；结构化 `{err}` 只记录安全分类。默认请求日志仅保留方法，响应日志仅状态，避免 URL 查询中夹带敏感内容；私有响应 no-store。

## Candidate review

公开版本与采用以 @atoms/contracts 为唯一 schema。快照结构复用同源纯文件规则，UTF-8 总正文最多 2 MiB/64 文件，规范 JSON 的 SHA-256 在两个运行时同步验证；历史读取不从当前模板补文件。版本 GET 先检查会话/归属/项目关联，返回不可变版本、成功运行或 null、实际相对父版本修改路径及当时采用可用性。两份快照路径并集最多 128 条，不能以单快照的 64 文件限制截断修改列表。源码仅在归属成功的读取响应中返回，不进入错误或普通日志。

采用 POST 严格只接受 expectedCurrentVersionId，1 KiB；成功候选必须为本项目 generated 版本并关联 succeeded.resultVersionId，parent 必须等于 expected。短事务再次检查会话到期、归属、完整候选和引用；目标已当前则幂等且不修改更新时间，否则比较当前 expected，检查 GEN-005 活动 Map 和数据库 running，再以 owner/current 条件 CAS 更新一行。无 await 或模型调用；失败回滚，不更改快照/运行/消息，不实现历史恢复。GET 每 IP 60/min、POST 10/min，Origin/JSON/no-store 沿用项目边界。冲突与拒绝的状态码见 [README API](../../README.md#候选预览与采用)。

前端 api/versions.ts 使用相对 /api、same-origin、10 秒请求与读取期限，unknown 进入共用 schema，并核对响应与请求的项目/版本关联。完整响应上限 16 MiB，容纳快照 JSON 转义；错误体 64 KiB、展示消息最多 500 字符，均为纯文本。UTF-8/JSON/schema/摘要、HTTP、网络、取消、超时和超限分别处理；不读取 cookie 值，不将原始网络异常展示或上传。

SnapshotPreview 供模板与候选页复用，仅接收已校验的快照和项目/版本/摘要/attempt 键，使用固定外部 bundler 与快照依赖，不补默认示例。useSandpackClient 作用域内的实际 done 且 compilatonError=false 才成为 compiled；load/connected 不成功。状态机拒绝旧键事件，编译/运行错误及 60 秒超时锁定该轮，文档重载使旧成功无效；主动重试才新实例。已 compiled 后 runtimeError 禁用采用。卸载清除 timer/监听，晚到的异步 client 被销毁；每次切换最多一个 iframe。

iframe 固定跨源、sandbox="allow-scripts allow-same-origin"、空 allow、no-referrer；不传平台凭据/对话，不由 postMessage 触发采用。编译结果不是服务端信任根，采用接口不接收 verified/compiled 字段。页面把 loadingSnapshot/loadError/compiling/compiled/compileError/runtimeError/timeout 与 idle/submitting/confirmed/conflict/unknown/error 分开。用户点击且收到有效确认才声明采用；丢响应后查询当前事实，旧版本仍当前保持 unknown，其他选择为 conflict，不自动改 expected 重发。刷新与采用共用同步互斥保护，刷新期间禁用首次采用及手动重试，避免迟到的旧读取覆盖确认结果。手动同载荷重试依赖服务端幂等和 CAS；运行错误不回写旧版本。

## Project workspace

GEN-007 的 `/` 明确创建，`/projects/:projectId` 读取私有工作台；未知路径明确报错，旧连接检查在 `/diagnostics/connection`。私有直达先 GET，不自动初始化会话。首页 session Promise single-flight；401 清空私有内存、草稿、已加载消息与待确认信封，停止旧请求；本次应用内返回首页后由用户明确重新开始。新会话 201 也清理旧身份数据。原生链接保留新标签/修饰键，SPA 导航使用 pushState/popstate 与 activation 隔离。

消息读取兼容原 `afterSequence` 响应 `{items,nextAfterSequence}`。新增 `direction=backward&limit=50&beforeSequence=N`，before 为可选正安全整数、排他 `<N`，与 after 互斥；同一读取事务取最新序号，items 始终升序，返回 `{items,nextBeforeSequence,latestSequence}`，无更早页为 null。客户端按持久 ID 去重、sequence 排序，最新页与已加载更早页合并；受理气泡只用于暂时校准，不伪造历史工具活动。`latestRun` 含恢复用 request/base/status/result 元数据，不含需求或工具正文。

JSON 客户端复用 GEN-006 的 10 秒期限、16 MiB 成功/64 KiB 错误正文上限、UTF-8/JSON/schema/摘要验证；任务 JSON 上限 256 KiB。平台错误仅使用固定分类说明，丢弃原始网络或未知服务消息。创建没有幂等协议，未知响应只保留原输入并刷新真实列表，不自动重发或按名称猜项目。创建响应在离页后到达也不得跳回或开始生成；模型配置失败时保留已创建项目和原需求。

POST SSE 使用 eventsource-parser 4.1.2：parser 缓冲 8192 字符，业务帧 UTF-8 8 KiB，业务最多 128 帧，总传输最多 320 KiB（含心跳），首响应 10 秒/空闲 25 秒，默认无累计总期限；测试可显式设置有限 totalMs。逐块 fatal UTF-8 解码，同步校验 accepted 首帧、项目/request/base/run 关联、严格连续 seq、唯一终态及终态内部关联；拒绝 id/retry/未知字段、截断与双终态。200 terminal JSON 与 202 running JSON 独立验证，200/EOF 不构成成功。不自动重连 POST；连接故障和离页清除 reader/计时器/监听，迟到事件不能修改其他 activation。

控制器由应用拥有，StrictMode 订阅重放和聊天/预览/源码切换不取消任务；真实离页关闭最初连接，服务端按 GEN-005 取消未完成运行。202 取消仅表示请求，提交后的成功优先。丢帧或未知状态只查询原 requestId，每 2 秒、最多 75 次/150 秒，隐藏暂停、离页结束，429 尊重 Retry-After；限额/404/503 保持待确认，只有明确手动重试复用原 payload，新尝试才分配新 ID。另一个标签页的 latestRun 不能替换本地原请求。

sessionStorage 仅存项目/request/base/prompt/时间信封，最多 20 项、24 小时，先限制原串再解析；不可用时仅内存并显示恢复限制。草稿、已加载消息和阅读位置按项目保存在当前应用内存，不承诺刷新恢复草稿，也不持久化整个对话或代码。恢复以服务端事实为准。候选与当前双重身份、编译与采用独立，工作台复用 GEN-006 的 useCandidateReview；所选未采用候选不能被误用为下一条基线。

源码来自所选版本完整快照，只读 select/pre/code 文本，不用 HTML 注入，不执行源码，不实现编辑/保存。切换版本同步文件映射；长源码仅在 pre 内横向滚动。iframe 只接收代码和依赖，平台会话、提示词与后端凭据不得传入。输入与响应式规则由 owning design skill 维护。

## Version restoration

REV-002 在 `@atoms/contracts` 导出 `restoreRequestSchema`、`restoreResponseSchema` 和 `Restoration`；请求/响应结构与采用相同，直接复用权威定义，两个操作的业务资格独立。`POST /api/projects/:projectId/versions/:versionId/restore` 使用 UUID 路径、strict `{expectedCurrentVersionId}`、严格空 query 和 1 KiB 上限，返回 `{projectId,currentVersionId,updatedAt,alreadyCurrent}`；复用 Origin/JSON/会话/归属/no-store/安全错误，每 IP 10/min、429 带 Retry-After。

`ProjectStore.restoreVersion` 在同步 immediate 短事务内重新验证会话有效性、owner、已存目标及父快照的完整结构、身份与 digest，并复用 candidate 的唯一 succeeded 结果关联检查；同时拒绝已有跨项目矛盾结果关联。generated 无成功结果关联为 409 VERSION_NOT_RESTORABLE，损坏/矛盾为安全 500 DATA_CORRUPT；模板可恢复，不依赖当前 catalog 或曾采用标记。目标已当前的合法重试先于 CAS/活动检查返回原 updatedAt；目标损坏或会话过期仍拒绝。

真正切换按 current=expected 检查，不能使用 adopt 的 parent=expected 约束。显式 activity 回调同步调用本应用真实 `GenerationManager.assertWritable/projectActivity`：stopping（含所有权撤销）拒绝写入，活动 Map 含取消收尾返回 PROJECT_BUSY，无执行者 running 返回 RUN_STATE_UNCONFIRMED，事务内仍检查全部 running；缺失/非法检查器不当作 idle，缺真实 manager 不注册版本路由。所有检查与条件更新之间没有 await，不调用模型或执行快照代码。

按 owner/current 条件更新恰好一行，只改 currentVersionId/updatedAt；更新时间取 max(当前时钟, 旧更新时间+1ms)，合法无写入重试不更新时间。失败整事务回滚，快照/序号/父关联/消息/run 不变，不新增恢复副本。不同目标共享 expected 至多一个成功，相同目标可幂等；目标随后被切走时旧请求重新受 CAS 约束。当前 ID CAS 不记录 ABA 历史，也不承诺操作日志。

响应未知时 GET 项目仅证明查询时 current；读到旧值不能证明在途 POST 不会提交，读到其他目标也不能重建历史。后续消费者保留 unknown、明确查询或同合法载荷手动重试，不自动换 expected。REV-003 负责 UI 门槛，REV-004 负责恢复后续改，REV-005 负责完整真实验收；服务端不接收 compiled/verified 证明。

## Version history

REV-001 的公开历史契约在 `packages/contracts/src/index.ts`（`@atoms/contracts`）维护，后端项目契约直接重导出同一来源。`GET /api/projects/:projectId/versions?limit=20&beforeSequence=N` 只读，limit 为 1..50，beforeSequence 为可选非负安全整数、排他 `<N`；0 返回空页，重复/额外/非规范整数字段拒绝。按项目内 sequence 倒序，返回 `{projectId,currentVersionId,items,nextBeforeSequence}`；有更多时游标为本页末项序号，否则 null。每页 current/isCurrent 来自同一读取事务，跨页可以改变，客户端应统一校准徽标，不以最大序号推断当前版本。

条目只含版本身份/父关联/时间、isCurrent、runId、request、summary 和 changedFiles，无快照正文。生成关联必须是唯一同项目 succeeded 结果且 base 等于 parent；无关联旧数据用 null/fallback，已有矛盾或损坏为安全 DATA_CORRUPT。request 取关联运行最早 user 的 `{messageId,excerpt,truncated}`，summary 取最后 assistant 并标 `stored`，缺少时使用标明 `fallback` 的事实说明；两者正文各最多 240 个 Unicode 码点，不调用模型。stored 仅表示文字来源，不代表编译或业务验收。

列表和 GEN-006 单版本读取复用 store 的同一快照比较：按历史自身结构/摘要验证，与自身父版本比较新增、删除和正文修改，路径去重排序；模板 []。单快照最多 64 文件，两份快照的路径并集上限为 128，不能把修改路径误限为单快照文件数。逐项处理当前页及其父快照，最终 JSON 上限 1 MiB，超限整页安全失败，不截断路径或伪造部分成功。迁移 v3 增加 result/run 消息关联索引，不回填或改写既有版本。

接口每 IP 每分钟 60 次，429 带 Retry-After；有效会话/项目归属/no-store/安全错误沿用项目边界。查询不更新 currentVersionId、updatedAt、消息或运行，不初始化会话、不执行代码或调用模型。历史 UI、恢复事务和恢复后续改分别由 REV-003、REV-002、REV-004 接入，列表可用不代表完整 Top 2 已验收。

## UI and handoff

UI 规范由 [DESIGN.md](../../DESIGN.md) 导航到现有设计 skill；在该契约维护 token 与交互约定，不在本文复制。

按 [Verification](./verification.md) 收集实际结果；版本控制操作遵循 [Git workflow](./git-workflow.md)。

## History workspace

REV-003 uses the existing workspace controller, version API client and SnapshotPreview. History loads 20 entries on demand and uses exclusive beforeSequence pages; failures retain the cursor and entries, refresh changes the list epoch, and project GET calibrates current badges. Current, inspected history and candidate identities remain separate. Complete validated snapshots supply both source and preview; immutable detail metadata never overrides newer project facts.

Restore and adoption share the controller operation lock with generation. Restore confirmation freezes project/activation/target/expected/digest/attempt and requires this preview attempt to be compiled without a known error. Identity, current, task or preview changes invalidate confirmation. Only expectedCurrentVersionId is posted; restore eligibility is independent of adoption parent rules. An acknowledged POST survives a failed calibration GET; an uncertain POST performs one GET and then offers manual queries, with no automatic write replay. 401 clears private state, while 404 removes inaccessible content.

The dependent REV-004 continuation guard waits for a successful current GET after acknowledged restoration. Unknown operations and failed fact reads prevent new generation; a different current preserves draft and inspected selection. Original unknown generation retries keep their request payload. No view, preview, restore or refresh starts generation automatically. This section describes selected implementation, not new validation evidence.

## Generation duration

2026-10-18 按用户要求修订：MODEL_TIMEOUT_MS 默认 0，不建立模型操作/生成服务的累计截止或定时器；本地显式配置也为 0。正值 1000–2147483647ms 为主动选择的有限总期限，最大值仅防止 Node timer 整数溢出；0 不受该时长约束。模型请求、工具执行、提交检查仍使用同一取消信号；用户取消、原连接断开、服务关闭和所有权丢失可中止活动请求，禁止迟到保存。步骤、token、文件/上下文、并发/配额限制保持不变。

前端 SSE 不再默认为 150 秒累计截止，持续收到 10 秒心跳的长任务可一直等待。10 秒首响应、25 秒无数据和 Nginx 相邻读取期限是连接故障检测，不是任务累计时长。状态查询和 iframe 编译是各自独立操作，仍有故障期限。live 验收同样不再用 10 分钟全局计时器终止真实生成；无总期限时需明确取消或 SIGINT/SIGTERM 结束，清理继续有界。

## Model invocation observations

GEN-010 的 model/observation.ts 维护服务端私有观测白名单。生产真实 fetch 的调用边界记录 dispatch，原样返回响应时只读取允许的 HTTP status/x-request-id 元数据，SDK 结束时记录可得的 responseModel 与 token usage；不克隆/消费正文，不增加请求、重试或超时预算。每个 attempt 使用独立 UUID，与 generation runId/projectId/requestId 和 1–6 step 关联，三个请求标识不混用。

app.ts 通过既有结构化 logger 写 modelObservation；观察失败不会改变产品结果，也不进入公开 SSE/HTTP 契约或数据库迁移。允许字段为事件、关联 ID、配置/响应模型、HTTP 状态、受限 req_ 请求标识、耗时、nullable 用量与安全错误分类。原始 headers/body/cause、提示词、工具正文、文件、推理与认证值均禁止；字段缺失为 null。x-request-id 只供排查，不能证明业务或预览成功，依据见 [OpenAI 官方请求追踪](https://developers.openai.com/api/reference/overview#debugging-requests)。

