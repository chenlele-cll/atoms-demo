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

模型客户端固定官方 `https://api.openai.com/v1`，不读取 SDK 的 OPENAI_BASE_URL 覆盖，不跟随重定向。先将供应商异常转为 `ModelError` 的允许字段（code、HTTP status 或 null、retryable），再交给日志或报告；不记录 SDK 异常 cause、原始 body、headers、提示词或文件正文。`retryable` 仅为提示，不触发重试。分类为 configuration、authentication、model_access、quota_rate_limit、upstream、network、refusal、invalid_output、truncated、timeout、cancelled；报告缺失用量使用 null。SDK 的原始 warning 文本也不进入日志。

## Generation when implemented

当前已有有界生成内核、独立验收入口及 GEN-005 公开生成/事件接口。`client.run` 建立操作截止时间，内部 `session.step` 每次只执行一个模型步骤；工具分派和下一步必须留在同一作用域内，并在分派前检查取消。GEN-002 探针仍独立于项目；实际生成契约见下节。所有生成继续遵守以下边界：

- 对文件路径、依赖范围、输出体积、步骤数和总时长设置限制；模型结果通过 schema 校验后仍需验证实际编译与交互。
- 生成代码在隔离的预览或执行环境中运行，不能在宿主后端进程中执行，也不能获得后端凭据。
- 任务阶段、工具活动和完成状态必须对应实际发生的工作，不能模拟模型执行或将未验证代码标记为可用。
- 明确定义失败、超时、取消和断线时的任务行为，失败时保留上一个可用快照。
- 初期请求内任务不承诺关闭浏览器后继续执行；需要可靠后台续跑时再实现相应机制。

## Bounded generation

GEN-004 的 backend/src/generation/contracts.ts 是内部请求、结果和工具的 Zod 来源。generateProject 只接受会话/项目/基线/请求 UUID 与修剪后的需求（1–4000 字符、UTF-8 最多 16 KiB），不接收代码、模型配置或工具列表。先检查持久会话到期及项目归属，再查询相同 requestId；仅新请求检查当前基线、支持布局和模型配置。匹配重放返回原 run/候选，不能再次调用或追加输入；需求或基线不同为 REQUEST_CONFLICT，失败重试需要新 requestId。项目级并发准入与公开取消由下节 GEN-005 管理器负责。

上下文只含固定规则、当前快照身份/依赖元数据、同项目最近完整历史及当前需求一次。历史选最近 10 条，按从近到远保留总正文不超过 16 KiB 的整条消息，再恢复序号顺序，记录省略数；代码通过工具按需读取，不从 catalog 替换项目数据。每步将工具 schema 与完整消息序列 UTF-8 JSON 计量，累计最多 256 KiB，超限失败而不截断文件。

三个工具的 schema 派生自同一 Zod 定义，strict=true、所有参数必填、parallel_tool_calls=false，无 SDK execute 或自动多步：list_files 返回冻结基线的排序路径/字节/可写标记；read_files 读取 1–8 个不同文件，正文合计不超过 96 KiB；submit_files 只允许一次终端提交 1–8 个完整文件，正文合计不超过 256 KiB。未知/多调用、额外参数、重复调用 ID 或无有效调用立即失败，不自动修复。读取结果与 SDK 的完整 response.messages/对应工具结果续接，推理续接项只留本轮内存，不进入对话、活动或日志。

company-landing 策略只允许已有 App.tsx 与 components/data/lib/generated 内的 TS/TSX 业务文件，以及已有 src/generated CSS；新文件仅在 /src/generated 下为 ts/tsx/css。根路径与 src 路径的业务规则均明确判断，实际接入使用 GEN-001 的 src 布局。入口引导、配置、许可、资源及预编译 CSS 只读。至少成功读取一个文件，覆盖已有路径必须已读取；拒绝路径绕过、重复、空正文、删除及完全无变化。全量复制文件映射后一次合并，复用快照契约校验 64 文件/2 MiB、身份和依赖，服务端重算 digest/changedFiles。新增样式使用普通 CSS；不做字符串伪编译或宿主执行，结果始终 previewStatus=unverified。

整个操作共享 MODEL_TIMEOUT_MS（默认 60000ms）和外部 AbortSignal，最多 6 次实际模型请求，每次沿用输出预算且 maxRetries=0。请求、工具、验证和事务前均检查；成功事务退出前再次检查，取消/超时使写入整体回滚。模型与网络等待不在数据库事务内，外部连接可写。受理原子保存 running/user；完成原子保存候选、事实摘要及 succeeded，保持 currentVersionId 不变；摘要只声明“候选已保存，预览未验证”。运行中基线改变拒绝保存。受理后失败保留输入，取消写 cancelled，超时写 failed/GENERATION_TIMEOUT；终态也写不入时返回 STORAGE_UNAVAILABLE、terminalStatePersisted=false，不冒充已持久化终止。成功已提交后到达的取消不改写结果。

活动只包含 runId、单调序号、时间、步骤、批准工具名、字节/路径、安全分类和保存标识。完成活动在相应动作后发出，saved 在事务提交后；观察者异常只计入 observerErrors，不影响事实结果。请求次数来自实际传输，用量按已观测单次值累计，任一步未知则合计 null；保留分项，重放未知指标全为 null。原始供应商异常、提示词、代码、工具正文与思维链均不进入结果或日志。进程硬杀可能留下 running，启动恢复按 Lifecycle 的独占所有权规则执行，不自动重试模型。

## Generation execution

公开生成体/路径/状态/事件以 backend/src/contracts/generations.ts 的 Zod schema 为权威，生成体 pick GEN-004 输入规则。状态与每帧只含关联 ID、起止时间、持久状态、安全错误、取消请求标记、候选 ID、实际 changedFiles 和 unverified；usage=null，不推测历史计数。不返回需求/对话/代码/工具正文。输入 strict，状态显式构造并校验；Fastify stream 是预序列化对象，因此 SSE 在编码前独立运行时校验，不依赖 JSON serializer。

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

backend/src/contracts/projects.ts 是项目/session/模板/快照/分页/安全错误的 Zod 契约来源，类型由 schema 推导。项目路由局部设置 Fastify validatorCompiler / serializerCompiler；请求 strict 拒绝额外字段，输出经显式 DTO 和 schema 投影，不返回 ownerSessionId、token 摘要、SQL 行或原始异常。健康契约保持独立。GEN-007 接入浏览器时再提取公开契约到中立模块，禁止复制规则或导入后端实现。

中立 templates/bundle.mjs 的纯文件规则随准备复制到后端部署资产；Zod 快照校验调用相同规则并重算 SHA-256，限制规范化虚拟路径、入口/样式/许可/运行配置、精确依赖版本、64 文件和总 UTF-8 2 MiB。新建项目核对当前可信目录；历史快照按自身身份验证，读取不依赖当前模板。保存候选须匹配基础版本的来源、入口和依赖，不改变 currentVersionId；结构合法不证明编译通过。

storage/store.ts 管理 sessions、projects、versions、messages、generation_runs 五张表；外键和组合引用限制关联在同一项目，快照更新由数据库触发器拒绝。创建项目、带消息创建/结束 run、保存候选均在短事务内全成或全退；配额在创建事务内部检查。追加消息分配递增序号，重复项目内 requestId 拒绝。只有内部编排调用这些写入方法；本次没有公开消息/快照/采用接口。run 的 succeeded 仅代表候选落盘，不代表预览验收。

持久会话使用随机 32 字节 token，数据库只存 SHA-256 摘要和 30 天到期时间。每个私有请求检查有效会话和 owner 条件；失效后初始化新会话不能认领旧项目。POST 只接受精确配置的 Origin 和 JSON；默认 trustProxy 关闭，不以伪造转发头绕过限流。请求体 8 KiB、项目 20 个/会话、消息 16 KiB、列表 50 条为初始边界，限流与配额可由显式构造参数在测试中缩小。

项目错误只使用固定 code/message/requestId：输入 400、会话 401、来源 403、资源 404、模板/配额 409、超大体 413、类型 415、频率 429（Retry-After）、存储不可用 503、损坏记录 500。底层 SQL、绑定值、绝对路径、cookie、提示词和代码不进入错误或日志；结构化 `{err}` 只记录安全分类。默认请求日志仅保留方法，响应日志仅状态，避免 URL 查询中夹带敏感内容；私有响应 no-store。

## UI and handoff

UI 规范由 [DESIGN.md](../../DESIGN.md) 导航到现有设计 skill；在该契约维护 token 与交互约定，不在本文复制。

按 [Verification](./verification.md) 收集实际结果；版本控制操作遵循 [Git workflow](./git-workflow.md)。
