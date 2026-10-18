# Monorepo contract

本文件维护目录、依赖和工具链边界。调整应用组织、共享代码或 workspace 配置时阅读并更新；框架选型的原因见 [stack-decisions.md](./stack-decisions.md)。

## Current topology

| 位置 | 职责 |
| --- | --- |
| `frontend/` | React + Vite 浏览器应用，拥有自己的依赖、启动入口和构建产物 |
| `backend/` | Fastify HTTP 服务，拥有自己的依赖、配置、启动入口和构建产物 |
| 根目录 | workspace 命令、唯一 lockfile、公共开发工具配置与 Agent 入口 |
| `scripts/` | 仓库级验证脚本，当前为浏览器冒烟脚本 |
| `docs/` | 产品参考、技术决策和工程规范，按英文子目录组织 |

## Dependency boundaries

- 前后端独立启动、构建和运行，通过 HTTP 下的 `/api` 通信。前端不能导入后端源码或直接访问数据库，后端不能依赖前端 UI 实现。
- 开发代理和生产反向代理属于 HTTP 接入方式，不改变应用之间的代码边界。
- 每个应用在自己的 package.json 中声明实际使用的依赖；根目录声明公共开发工具，不能依靠另一应用的依赖偶然可见。
- `backend/src/app.ts` 构建应用并注册路由，不监听端口；`server.ts` 负责环境加载、监听和进程生命周期。
- 路由负责 HTTP 边界。生成和存储职责随首次实现形成实际模块，不持续堆入路由，也不预建空的 service、repository 或通用依赖注入层。

## Workspace and toolchain

- workspace 成员以根目录 [pnpm-workspace.yaml](../../pnpm-workspace.yaml) 为准，共用根目录唯一的 `pnpm-lock.yaml`。
- Node 版本以 [.nvmrc](../../.nvmrc) 为准，pnpm 版本和 Node 范围以根 [package.json](../../package.json) 为准。`.nvmrc` 的存在不代表当前终端已经切换版本。
- 在仓库根目录安装依赖，使用 frozen lockfile 验证可重复安装；依赖调整同时更新声明和唯一 lockfile。
- TypeScript 的公共编译约束在 [tsconfig.base.json](../../tsconfig.base.json)，应用差异保留在各自配置中；ESLint 使用根目录统一入口。
- 前后端产物分别写入各自的 `dist/`，生产后端构建排除测试。测试源码随项目维护；依赖目录、构建产物和本地运行产物不入库。

## Adding shared code

当前没有公共运行时包。出现真实共享契约时，再确定最小的共享方式：只共享公开类型或边界校验 schema，不包含后端凭据、数据库访问或应用实现。建立 workspace 包时使用显式 workspace 依赖，保持依赖方向清晰、无环。

新增框架、服务、公共包或依赖必须对应当前需求。缓存与构建编排工具在任务依赖或实际成本需要时评估，避免为目录完整而增加模块。

## Enforcement status

现有工具执行严格类型检查、ESLint 和行为测试。跨应用源码导入、模块依赖方向目前仍需审查，本文件不代表相关自动检查或 CI 已实现。新增自动约束时应同时更新配置和验证记录。
