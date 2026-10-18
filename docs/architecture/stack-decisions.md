# 技术栈调研与初始化建议

状态：前端 React + Vite、后端 Fastify + Node.js + TypeScript 已确认，前后端在同一仓库中分别启动。工程骨架与依赖已初始化，提供健康接口和前端连通检查。模型、数据库与生成应用预览依赖随实际实现引入。用户已有服务器，要求保持简单、只引入必要技术。本文记录本项目的技术决策与适用边界。

## 1. 选型目标

先满足项目的真实可用性、稳定性、工程质量与可解释性，再在合格方案中降低实现成本。不能将依赖最少、开发最快或框架流行作为单独的决策依据。

交付目标是可部署、可测试、具有真实 AI 生成与交互预览、支持持久化的网页应用。用户已有服务器，不再围绕托管平台选型。一个仓库包含独立前端和后端，分别安装所需依赖、提供启动命令并独立运行；共用一个 workspace lockfile。每项依赖必须解决当前存在的问题。

## 2. 推荐组合

| 层次 | 推荐 | 理由与边界 |
| --- | --- | --- |
| 语言 | TypeScript | 前后端共享数据契约与校验 schema |
| 前端 | React + Vite | 独立开发服务器，构建为静态文件；当前无需 Next.js 的服务端渲染或服务端路由 |
| 后端（已确认） | Fastify + Node.js + TypeScript | 独立 HTTP 服务，提供请求生命周期、schema 校验、错误处理与接口测试基础，负责模型调用、生成事件流和数据库读写 |
| UI | CSS Modules + 少量全局 CSS | 使用 Vite 内置支持，先不安装样式框架、组件库或图标库 |
| AI 接入 | Vercel AI SDK + Zod | 统一模型调用、流式结果、工具调用与结构化文件输出 |
| 模型 | 实现生成时配置一个实际可用的供应商与模型 | 具体选择取决于现有凭据、可达性和结构化输出／工具支持，不凭框架兼容声明代替实测 |
| 应用预览 | Sandpack React | 浏览器内运行受约束的 React 项目，默认使用外部 bundler；不是完整远程 Linux 环境 |
| 持久化 | SQLite + better-sqlite3 | 直接使用参数化 SQL；单机 Demo 无需数据库服务或 ORM，使用简短的 SQL 迁移维护表结构 |
| 部署 | 已有服务器，前端静态文件与后端服务分别运行 | 静态文件由现有 Web 服务器提供，`/api` 转发到独立 Node 后端；复用已有进程管理和反向代理设施 |
| 工具链 | Node.js LTS + pnpm | 本地与部署环境统一运行时与包管理器，提交唯一 lockfile |
| 静态质量 | TypeScript 严格检查 + ESLint | 前端沿用 Vite React TypeScript 模板配置，后端使用相应 TypeScript 检查规则；不叠加其他 lint／格式工具 |
| 行为验证 | Node 内置测试器 + Fastify injection；浏览器实测 | 当前接口与配置无需额外测试框架；前端复杂逻辑出现时按需添加 Vitest，需要持续浏览器回归时再加入 Playwright 工程配置 |

AI SDK 用于减少流式协议、工具调用和结构化输出的手写工作，不要求部署到 Vercel，也不要求使用其模型网关。只接一个实际可用的供应商，不预先编写多模型适配层。

Sandpack 用于避免自行实现 React 编译与预览环境。它是当前基于 React 生成目标的推荐；如果最终只生成 HTML/CSS/JS，可以使用隔离 iframe，并移除这项依赖。

## 3. 主要候选方案比较

| 方案 | 合适的情况 | 本项目的取舍 |
| --- | --- | --- |
| Next.js 统一前后端 | 页面与 API 统一承载 | 不采用，用户明确要求前后端独立运行 |
| Vite + React + 独立 TypeScript 后端 | 前后端分离、独立启动、同语言开发 | 当前推荐，以轻量 HTTP 服务承载后端 |
| React + FastAPI | 已有 Python 智能体实现或强依赖 Python 工具生态 | 当前未发现这类需求，不作为默认；不能仅因“AI 项目”就引入第二语言 |
| 独立 Node 后端 + SQLite 文件 | 已有服务器，单机运行，读写量有限 | 当前推荐的数据与运行方式；数据库放在部署产物之外的持久目录，避免更新代码时覆盖 |

使用 pnpm workspace 管理 `frontend/` 和 `backend/`，不引入 Turborepo 或 Nx。前端通过 HTTP API 与后端通信，不能直接导入后端实现或访问数据库。

开发环境中 Vite 与后端监听不同端口，分别启动；Vite 将 `/api` 代理到后端。生产环境前端静态资源与 `/api` 可以通过同一个反向代理域名访问，这不影响前后端的独立构建和运行。

后端已确定使用 Fastify：其请求契约、失败处理与接口测试能力符合当前独立后端的需求。主要权衡是工程可用性与维护成本，开发速度作为满足这些前提后的考虑因素。

### 后端框架的决策依据

| 候选 | 与当前需求的匹配 | 取舍 |
| --- | --- | --- |
| Fastify | schema 校验与响应序列化、请求生命周期、插件封装、内置 HTTP injection 测试入口 | 已选定；流式输出、取消和超时仍需实现与实测，框架不会自动解决任务执行问题 |
| Hono | Web 标准 Request/Response、现成 SSE 与流式 helper、TypeScript 集成 | 可行，但请求日志、契约和错误规范需要自行组合；跨运行时能力不是当前主要需求 |
| FastAPI | Python 类型校验、API 文档与 Python 工具生态 | 如果后续明确依赖 Python 智能体／执行工具，或开发者更熟悉 Python，应重新评估；当前没有这类已确认前提 |
| NestJS | 模块与依赖注入适合较多业务模块或团队统一规范 | 当前模块规模有限，暂没有需要引入其完整组织方式的证据 |
| Express | 成熟的 Node 路由与中间件生态 | 可行，但校验、错误契约和测试能力需要额外组合；当前没有已有 Express 资产可复用 |

Fastify 原生使用 JSON Schema；当前模型结构化输出计划使用 Zod。实现时需明确 API schema 的唯一来源及接入方式，避免手写两套相同的校验规则。具体适配依赖在版本兼容核对后决定。

### Fastify 与 FastAPI 的最终比较结论

比较对象是 Node.js + TypeScript + Fastify 与 Python + FastAPI，而不是 Web 框架与运行时直接比较。两套方案都能满足本题，不以未经测量的性能差异作为选型依据。

当前选择 Fastify，是因为后端主要进行模型调用、项目数据读写和事件推送，没有已确认的 Python 专属工具依赖。统一 TypeScript 有助于维护前后端的消息、文件和事件契约；同语言不替代 HTTP 边界的运行时校验。

FastAPI 的 Pydantic 校验、OpenAPI 文档与 Python 工具生态具有实际价值，但当前没有足够需求支持为这些能力引入第二套语言环境。这个结论不代表 FastAPI 能力不足，也不假设用户更熟悉某种后端语言。

如果后续明确引入 Python 专属执行工具，或运行规模改变，再根据实际需求评估局部 Python 服务或其他调整，不预建相关架构。

### 可以在面试中说明的选择与边界

- TypeScript / Node.js：当前后端主要等待模型与数据库 I/O，且无已确认的 Python 专属依赖；统一语言有助于维护文件、消息与事件契约。CPU 密集的编译或不可信代码执行不能放在 HTTP 主进程内。
- 流式反馈：主要需求是后端持续推送进度与生成结果，可使用 HTTP 事件流；暂未发现必须使用双向 WebSocket 的需求。断线后的任务行为、错误事件与取消要明确设计和验证。
- SQLite：当前是单机、有限写入、少量关系表的场景，可提供事务、约束与持久化。写事务应短，模型调用在事务外进行。需要多实例或持续高并发写入时重新评估 PostgreSQL；不预设未经测量的性能阈值。
- AI SDK：复用模型流式、工具调用与结构化输出协议；项目状态、权限、步骤上限和失败恢复由业务代码控制。使用 SDK 本身不构成智能体实现。
- Sandpack：把生成代码与宿主后端分开执行，提供 React 编译和预览；不等同于完整 Linux 沙箱，外部网络依赖和浏览器存储边界必须验证。
- 直接 SQL：当前表和查询数量有限，SQL 能明确表达约束与事务；省略 ORM 不能省略参数绑定、表结构迁移和持久化验证。

代码组织按路由、生成流程、模型接入和数据访问划分实际职责，不为展示架构而预建通用仓储、依赖注入或多服务层级。

## 4. 最影响工期的决定：生成代码在哪里运行

| 预览方式 | 能力 | 成本与约束 |
| --- | --- | --- |
| 单 HTML + 隔离 iframe | HTML/CSS/JS 小型应用 | 接入最少，但输出格式和组件生态较受限；需处理隔离与存储行为 |
| Sandpack | 多文件 React 项目的编辑与运行预览 | 推荐候选；需验证 bundler、依赖下载、错误事件和预览存储行为 |
| WebContainers | 浏览器内运行 Node 工程与进程 | 需要跨源隔离等平台能力，浏览器兼容与嵌入资源约束更复杂 |
| E2B 等远程沙箱 | 在隔离 Linux 环境安装依赖、运行构建与服务 | 更接近完整开发环境；新增凭据、费用、沙箱生命周期与预览服务管理 |

推荐以浏览器端 React 应用作为生成目标。宿主平台的前后端架构与生成应用的运行架构分别定义，不要求生成完整服务端工程。

如果必须生成带独立后端、服务端秘密或任意命令的全栈工程，应重新评估远程沙箱，不能把 Sandpack 当作同等替代。

## 5. 工程规范入口

本文维护选型依据与候选比较。实现规则分别维护在下列文档中，调整相应约束时更新其权威入口：

| 范围 | 文档 |
| --- | --- |
| workspace、目录与依赖方向 | [Monorepo contract](./monorepo.md) |
| 类型、HTTP、配置、日志、生成与持久化 | [Development conventions](../engineering/development.md) |
| 检查选择、当前覆盖和验收证据 | [Verification](../engineering/verification.md) |
| 起停行为、幂等语义与基础设施 | [Lifecycle](../engineering/lifecycle.md) |

## 6. Harness 与能力状态

仓库入口由 [AGENTS.md](../../AGENTS.md) 导航，文档职责见 [文档索引](../README.md)。Git 操作与已落盘技能分别维护在 [Git workflow](../engineering/git-workflow.md) 和 [Skills 说明](../engineering/skills.md)。UI 由 [DESIGN.md](../../DESIGN.md) 导航到已有的详细设计契约。

当前已建立应用启动、连通检查与验证入口；OpenSpec 尚待接入。统一生命周期脚本、数据库迁移和生成预览随对应任务渐进接入；能力是否可用以实现及实际验证记录为准。

## 7. 本地观察与验证范围

- 初始化使用本机已有的 Node.js `22.22.2` LTS 与 pnpm `12.11.2`，在 `.nvmrc` 和 package.json 中固定工具链。
- 已安装 React `19.3.1`、Vite `8.3.4`、Fastify `5.12.7`。TypeScript 使用与当前 typescript-eslint peer 范围兼容的 `5.9.3`；依赖由根目录 lockfile 锁定。
- 已建立开发入口、生产构建、严格类型检查、ESLint 和后端接口／配置测试。实际命令与配置以 README 和 package.json 为准。
- 尚未接入模型、SQLite 持久化、Sandpack 预览或实际服务器；不能将工程骨架验收描述为这些能力已完成。

## 8. 初始化前的实际前提

- 确定是否接受“生成浏览器端 React 应用”的运行范围。
- 确认可使用的模型供应商与服务端凭据。不要在聊天或公开仓库粘贴秘密值。
- 用户已有服务器；具体上线时再核对操作系统、Node.js 版本与持久目录，不阻塞本地骨架初始化。
- 初始化可以先完成环境模板、静态检查和启动入口。模型凭据在接入真实生成时配置，不要求为了空骨架提前申请外部数据库或沙箱账户。

## 9. 官方依据

- Vite：https://vite.dev/guide/
- Hono Node.js 服务：https://hono.dev/docs/getting-started/nodejs
- Hono Streaming Helper：https://hono.dev/docs/helpers/streaming
- Fastify 校验与序列化：https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/
- Fastify 接口测试：https://fastify.dev/docs/latest/Guides/Testing/
- AI SDK 结构化输出：https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data
- Sandpack：https://sandpack.codesandbox.io/docs
- Sandpack bundler 托管说明：https://github.com/codesandbox/sandpack/blob/main/website/docs/src/pages/guides/hosting-the-bundler.mdx
- better-sqlite3：https://github.com/wiselibs/better-sqlite3
- WebContainers 浏览器要求：https://webcontainers.io/guides/browser-support
- E2B：https://e2b.dev/docs
