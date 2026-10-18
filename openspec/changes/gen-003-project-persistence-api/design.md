# Design

## Context

动机见 [proposal.md](./proposal.md)，行为契约见 [project-persistence](./specs/project-persistence/spec.md)。当前 `backend/src/app.ts` 仅注册健康路由，`server.ts` 负责监听与信号，`config.ts` 只解析 HOST/PORT；后端已有 Node 测试器和 Fastify injection，没有数据库依赖。前端仅有连接检查，不存在需要本次迁移的用户数据或项目客户端。

[GEN-001](../gen-001-company-template-baseline/design.md) 规划了中立模板源、固定内容摘要和文件集合，但尚未实施。本变更以该资产契约为依赖，不假定模板已经能运行。平台数据与生成应用自身的业务数据分开；此处只保存平台项目。开发、构建和测试继续使用现有 workspace、唯一 lockfile 和独立应用命令。

## Goals / Non-Goals

**Goals:**

- 以真实文件数据库交付可恢复的数据边界，使创建响应中的当前版本与落盘记录一致。
- 让后续生成编排通过明确的内部存储操作写入记录，HTTP 路由不直接拼接 SQL，也不直接运行生成代码。
- 使用少量具体模块和现有测试工具，覆盖失败回滚、归属隔离、浏览器 cookie 与进程重启。

**Non-Goals:**

- 本次不建立账号系统、后台队列、跨实例数据库服务或通用模板市场。
- 内部候选保存不等于预览验证或版本采用；运行中的生成任务如何恢复、取消和判断可用，由 GEN-004/005/006 定义。
- 不增加尚无调用方的共享 workspace 包、前端项目客户端或临时演示 UI；工作台在 GEN-007 接入这些 HTTP 契约。

## Decisions

### 1 使用已有技术决策中的 SQLite，明确原生安装与生命周期

后端新增固定版本的 `better-sqlite3` 与必要类型，使用同步短事务；不加入 ORM 或独立数据库容器。已核对 `better-sqlite3@13.0.3` 的 Node >=22 元数据与项目 Node 22.22.2 相容，实施仍需在本机实际安装、打开文件和执行查询，不能把版本声明当作原生绑定验证。仅为该实际依赖增加 pnpm 构建许可，保留现有 esbuild 许可。

新增配置 `DATABASE_PATH`，默认 `../data/atoms.sqlite`，相对于后端 workspace 的工作目录解析为绝对路径；数据在 dist 之外并被忽略。拒绝空路径，不允许生产路径静默变成内存数据库。建立父目录、打开文件、启用 foreign_keys、文件数据库 WAL 和 5000ms busy_timeout 后才监听。

迁移使用随 TS 构建的有序 SQL 定义，以 `PRAGMA user_version` 记录版本；在事务中取得写锁后重新读取版本、执行实际迁移和更新版本。遇到更高版本拒绝启动；迁移失败回滚，不删库重建。数据库记录内容须在读取边界再次校验。

`server.ts` 负责构造真实 catalog/store，再传入 `buildApp`；无参数构造不隐式访问磁盘，原有健康 injection 测试保持可用。项目测试显式提供临时文件 store。连接由一个应用实例拥有，通过关闭钩子释放；初始化、插件加载、监听失败也清理已打开资源，避免模块级全局连接。数据库事务内没有网络调用或 await；[better-sqlite3 事务说明](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#transactionfunction---function) 明确其同步边界。

### 2 五张表满足当前交接，不预建版本管理服务

| 表 | 本次需要的数据与约束 |
| --- | --- |
| `sessions` | 内部 ID、唯一 token 摘要、创建和到期时间；不保存原始 token |
| `projects` | ID、ownerSessionId、标题、模板 ID/版本/摘要、currentVersionId、创建和更新时间 |
| `versions` | ID、projectId、项目内版本序号、parentVersionId、template/generated 类型、完整快照 JSON、创建时间；内容不可更新 |
| `messages` | ID、projectId、项目内递增序号、user/assistant 角色、正文、可空 runId、创建时间 |
| `generation_runs` | ID、projectId、项目内唯一 requestId、baseVersionId、可空 resultVersionId、状态、安全 errorCode、起止时间 |

快照包含 GEN-001 的入口、固定直接依赖、文件映射及模板来源，不只保存 diff 或模板路径。使用外键、组合唯一键和检查约束保证当前版本、父版本、run 及结果版本属于同一项目；项目当前引用在创建事务内部可暂空，提交前必须指向已插入的初始快照。所有 SQL 绑定参数，动态排序仅使用固定字段。

项目创建事务先校验配额，随后保存项目、模板 v0 和当前引用；失败整体回滚。新建项目不插入消息或 run。内部提供追加有序消息、创建/结束 run、保存候选的具体操作；涉及关联写入时作为一个短事务提交。run 状态只容纳 `running/succeeded/failed/cancelled/interrupted` 的持久值，合法终止状态和时间字段受校验；编排与进程重启后的状态处理留给 GEN-004/005。`succeeded` 不代表代码编译通过或已采用。

保存候选只新增快照并关联 run，不修改 currentVersionId；没有公开的消息写入、快照写入、采用或恢复接口。本次单元测试通过显式测试夹具验证这些内部边界，不伪装真实生成。完整快照优先于增量存储，是为了让重开项目不依赖模板源或重放算法；64 文件/2 MiB 上限约束初期规模。

### 3 后端使用同一份中立模板资产，部署不依赖前端源代码

扩展 GEN-001 的 `scripts/prepare-company-template.mjs` 输出目标，仍以 `templates/company-landing/` 为唯一源；同一准备逻辑生成相同文件集合和摘要，不复制另一套模板实现。

前端保持 GEN-001 的 public 输出。后端 dev 在启动前生成 `backend/src/template-assets/company-landing.bundle.json`；构建在 tsc 后将同样内容写入 `backend/dist/template-assets/`。`server.ts` 相对自身模块位置加载 `./template-assets/`，使 src 与 dist 使用同一相对定位。各应用构建只写自己的目标，避免并行 workspace build 争写。生成目录被忽略，缺资产或解析失败则启动失败。

在 `backend/src/templates/` 放置当前单模板目录加载与校验；不实现动态插件发现。检查标识、版本、摘要重算、正常化虚拟路径、入口存在、固定依赖及 GEN-001 的体积限制。公开目录只返回名称、类别、来源、版本和摘要。创建项目时，从已加载的可信完整集合复制快照；浏览器不能提交替代文件。返回模板不存在 404、版本或摘要过期 409。

这比运行时读取 `frontend/public` 多一份可重建资产，但后端可以独立部署，且保存后的项目不依赖该副本恢复。生产打包必须包含 dist 内的资产；隔离验证会移除对前端源目录的依赖。

### 4 匿名会话是本次可演示的归属机制

`POST /api/session` 严格接受 `{}`，使用 32 字节加密随机 token，base64url 编码；数据库仅存 SHA-256 摘要。cookie 名为 `atoms_session`，HttpOnly、SameSite=Strict、Path=/api、Max-Age 30 天，数据库到期时间一致。有效会话返回 200 并复用，不自动延长到期日；新会话返回 201。响应只暴露到期时间等必要状态。失效 cookie 初始化为新会话；不尝试通过客户端项目 ID 认领旧数据。

`APP_ORIGINS` 配置精确 Origin 白名单，默认 `http://127.0.0.1:5173`、`http://127.0.0.1:4173`；校验不得带路径、凭据、通配符或非法值。允许 loopback HTTP 开发；非 loopback 必须 HTTPS，且不能与 HTTP 开发来源混合部署。公开部署 cookie 设置 Secure，以显式配置决定，不信任客户端转发头。所有 POST 校验 Origin，包括会话初始化，缺失或不匹配返回 403；调用脚本和 injection 测试明确提供 Origin。

利用 `@fastify/cookie` 处理 cookie，避免自写解析器；使用现有 Vite 相对 `/api` 代理和未来同源反代，不增加开放的凭据 CORS。每次私有请求查询有效持久会话，并把 ownerSessionId 加入访问条件。无会话为 401；有效会话访问其他归属或不存在的合法 ID，统一 404。响应 DTO 不含 ownerSessionId、tokenHash 或原始 SQL 行。

匿名机制省去账号接入，但浏览器清理 cookie 或到期会失去入口；数据不会自动删除，也没有找回入口。此限制需要写入实际使用说明，不能宣传为账号级云同步。

### 5 以 Zod 为新增路由的唯一契约来源

在 `backend/src/contracts/projects.ts` 定义公开请求/响应与快照的 Zod schema，类型由 schema 推导；模板加载、存储读取及 HTTP 边界复用具体规则。新增路由插件局部注册 Fastify validatorCompiler 和 serializerCompiler，输入失败返回框架可处理的错误，输出经 schema 校验后序列化；安全错误处理不直接返回 Zod 输入、SQL 或内部异常。

采用 [Fastify 支持的自定义编译器](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/) 而不是同时手写 JSON Schema，也不为仅有几个路由加入 Swagger/OpenAPI 依赖。Zod 对请求对象使用 strict，避免 Fastify 默认剔除额外字段后把注入字段当成功请求。保留健康路由已有契约。此处没有浏览器消费方，不新建共享包；GEN-007 接入客户端时再把公开 schema 提取到中立契约模块，不能复制规则或让前端导入后端实现。

| HTTP | 输入与结果 |
| --- | --- |
| `POST /api/session` | `{}`；201 新建或 200 复用，响应含 expiresAt |
| `GET /api/templates` | 无会话要求；返回可用模板元数据列表，不返回代码 |
| `POST /api/projects` | `{templateId,templateVersion,templateDigest,title}`；201 项目详情 |
| `GET /api/projects` | `limit` 默认 20、最大 50；可选有界 cursor；返回元数据 items、nextCursor |
| `GET /api/projects/:projectId` | 返回 project、含完整快照的 currentVersion、latestRun 摘要或 null |
| `GET /api/projects/:projectId/messages` | `afterSequence` 默认 0，`limit` 默认 20、最大 50；返回有序 items、nextAfterSequence 或 null |

项目 ID 使用 UUID；创建标题 trim 后 1–120 字符，创建请求体上限 8 KiB。列表按 updatedAt 降序、ID 降序排序，cursor 是最多 256 字节的 base64url 编码时间/ID 元组，经 schema 校验后绑定查询；它不是授权凭据。对话序号为非负安全整数，单条正文上限 16 KiB；时间由服务端生成。严格解析查询字符串，不接受无限页或任意排序表达式。

错误统一为 `{error:{code,message},requestId}`，含 400 输入、401 会话、403 来源、404 资源、409 模板冲突或配额、429 频率、503 存储暂不可用；损坏快照等内部错误为安全的 500。超大请求体为 413，非 JSON 为 415。私有响应 `Cache-Control: no-store`；不得把原始异常对象序列化给客户端。

### 6 使用与 Demo 规模相匹配的限制和日志

新增 `@fastify/rate-limit`，默认会话初始化 30 次/分钟/IP、创建项目 10 次/分钟/IP；对超限使用统一错误与 Retry-After。保持 `trustProxy` 关闭，不按任意 X-Forwarded-For 识别客户端。每会话最多 20 个项目，在创建事务中检查；达到上限返回 `PROJECT_LIMIT_REACHED` 的 409，不提供无意义的等待重试承诺。限流参数和项目配额作为应用构造配置，可由测试明确缩小；不为本次功能扩展一组不必要的环境变量。

Fastify 结构化日志沿用 `{ err }` 形式，但存储/校验异常先映射为经过裁剪的错误分类，不把含 SQL、绑定参数或文件路径的底层 cause 直接写入。补充 Cookie、Set-Cookie 的脱敏，不记录请求体、代码及消息。测试使用独特敏感哨兵字符串，断言日志和错误响应不包含它；正常详情只向所有者返回代码，不向其他会话或列表泄露。

SQLite 忙、磁盘满和 I/O 失败不返回成功；回滚后返回安全 503。没有吞错继续服务的内存替代。有限 busy_timeout 防止同步调用无界阻塞；单进程加短事务适合当前演示，不承诺多写实例扩展。

### 7 按真实边界测试，不增加临时 UI 或测试框架

后端测试继续使用现有 `tsx --test`。每个存储用例使用临时目录中的真实 SQLite 文件和显式关闭；包含迁移幂等、更高版本拒绝、外键/跨项目关联、创建中途失败整体回滚、不可变候选、消息顺序、run 记录及关闭重开。故障通过受控存储边界或 SQLite 约束触发，不依赖污染开发数据库。

Fastify injection 用两个独立 cookie jar 验证整个路由表、严格字段、路径与分页输入、Origin、到期、配额、限流及安全错误。输出响应使用同一 schema 解析；额外断言记录内容和隔离，不能只看状态码。存储记录里的测试 run 必须说明是夹具，不算模型验收。

新增 `scripts/project-smoke.cjs` 和计划命令 `pnpm smoke:projects`，复用已有 playwright-core 与系统 Chrome。命令要求先 build，自行管理本次后端及前端进程，用临时 DATABASE_PATH 和独立浏览器上下文，不添加测试产品页。浏览器从现有首页通过 `fetch('/api/...')` 执行真实同源请求：

| 场景 | 验收断言 |
| --- | --- |
| dev 代理与 cookie | 初始化会话、读取目录、创建、列表、详情、空对话；浏览器收到 HttpOnly cookie，document.cookie 不能读取，刷新后项目仍可读 |
| 会话隔离 | 独立上下文 B 看不到 A 的项目，详情/对话与不存在项目返回相同 404 形状 |
| 构建产物与重启 | 前端 preview 对接实际 dist 后端；创建后停止并重启所属后端，保留数据文件和 cookie，比较完整文件映射、摘要和项目 ID |
| 已存记录恢复 | 启动前由内部存储入口写入显式测试消息/run/候选夹具，重启后验证查询顺序与当前版本未改变，不报告模型已调用 |
| 资产独立性 | 后端构建在没有前端源或 public 目录的隔离部署布局中加载自己的模板副本，保存后不依赖模板源重开项目 |
| 失败与清理 | 非法配置、不可写存储和不支持 schema 在监听前失败；清理仅限本次进程、浏览器与临时目录，保护占用端口的其他程序 |

证据存入忽略的 `test-results/project-persistence/`，记录实际命令、退出码与观察。此测试验证数据 API 和浏览器传输，不声称工作台、生成预览或线上部署通过；完整产品路径仍由 GEN-008/009/010 收口。

现有 `scripts/manager.test.mjs` 只复制指定根文件/脚本，不含中立模板源，且用 `--ignore-scripts` 安装；直接加入模板和 native 依赖会破坏隔离副本。实施时补充其必要模板/准备脚本复制和显式原生构建验证，不复制工作副本 node_modules、用户环境、数据库或生成资产，不依赖偶然缓存的 native 成功。同步更新必要安装前提并运行完整 manager 回归，不能跳过这条已有检查。

## Risks / Trade-offs

- 原生绑定受系统与 Node ABI 影响 → frozen install 后执行真实 SQLite 打开/读写；部署在目标平台安装，不跨系统复制 node_modules。
- 完整快照带来磁盘增长 → 限制单快照及项目数，保持同步短事务；候选清理和数据库容量运营不在本任务中承诺。
- 匿名 cookie 丢失导致无法找回 → 使用说明明确生命周期；不临时增加不安全的项目 ID 认领接口。
- 模板准备与已有生命周期隔离副本冲突 → 单一源、独立输出目标、fixture 新安装及起停回归共同验证。
- 与并行的 manager、CI 或其他 change 修改同一配置 → 只调整本功能需要的片段，实施前重新读取实际脚本与任务状态，保留他人变更。
- 当前仅完成规划 → 所有运行能力以 apply 的实际证据为准；本次严格校验不构成数据库、浏览器或部署验收。

## Migration Plan

1. 先完成 GEN-001 的模板基线与文件契约，再实施本变更；模型服务与密钥不是 GEN-003 前提。
2. 加入必要依赖、原生构建许可、数据库配置和初始迁移；使用临时文件完成行为测试后接入真实启动。
3. 扩展模板准备与后端部署资产，接入会话和项目路由；更新 `.env.example`、忽略规则及隔离副本的安装/资产前提。
4. 执行 frozen install、`pnpm check`、`pnpm test:manager`、`pnpm smoke`（已含 build），随后运行 `pnpm smoke:projects`；共享端口串行使用。GEN-001 的准备/模板回归保持通过；最后严格校验选定 change。
5. 同步 README 的实际 API/启动方式，以及 Development、Lifecycle、Verification、Monorepo 中本次改变的规则和边界；不把未实现的后续任务写成可用能力。
6. 发布回退只回退应用产物并保留数据库；已有数据文件绝不自动降级或删除。程序拒绝更高 schema 时，使用相容版本或经过明确备份的恢复流程；本任务不增加破坏性重置命令。
