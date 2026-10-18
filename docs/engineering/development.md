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

当前尚无数据库实现。加入持久化时使用 SQLite 参数绑定、短事务及实际迁移；模型调用保持在写事务之外。

平台项目、对话与代码快照的数据，和生成应用自身的业务数据分别定义。使用预览侧 localStorage 时定义项目级命名空间，不能直接描述为云端持久化；项目隔离、刷新和版本切换行为需要实际验证。

数据库文件位于部署产物之外的持久目录，停止或更新服务不能默认删除数据。使用原生依赖时在目标平台安装，不能跨操作系统复制 node_modules。

公开调用入口同时定义项目归属、访问范围和与使用规模匹配的请求及费用限制；新增队列、外部数据库等组件需要实际需求支持。

## UI and handoff

UI 规范由 [DESIGN.md](../../DESIGN.md) 导航到现有设计 skill；在该契约维护 token 与交互约定，不在本文复制。

按 [Verification](./verification.md) 收集实际结果；版本控制操作遵循 [Git workflow](./git-workflow.md)。
