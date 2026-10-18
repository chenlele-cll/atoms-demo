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

当前模型模块提供有限调用与能力样例与 runner，尚无项目生成实现。`client.run` 建立操作截止时间，内部 `session.step` 每次只执行一个模型步骤；工具分派和下一步必须留在同一作用域内，并在分派前检查取消。探针中的 `/App.tsx` 仅做结构/路径/字节检查，`inspect_fixture` 只使用公开内存数据；二者不读写项目、不执行代码。后续接入项目生成时继续遵守以下边界：

- 对文件路径、依赖范围、输出体积、步骤数和总时长设置限制；模型结果通过 schema 校验后仍需验证实际编译与交互。
- 生成代码在隔离的预览或执行环境中运行，不能在宿主后端进程中执行，也不能获得后端凭据。
- 任务阶段、工具活动和完成状态必须对应实际发生的工作，不能模拟模型执行或将未验证代码标记为可用。
- 明确定义失败、超时、取消和断线时的任务行为，失败时保留上一个可用快照。
- 初期请求内任务不承诺关闭浏览器后继续执行；需要可靠后台续跑时再实现相应机制。

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
