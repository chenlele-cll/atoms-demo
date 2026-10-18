# Atoms Demo

React + Vite 前端与 Fastify 后端，同一仓库、独立启动、独立构建，通过 `/api` 通信。

项目目标是让用户通过自然语言生成和修改网页应用，交互预览结果，并保存项目与代码版本。

当前已建立工程骨架、健康接口与前端连通检查。尚未实现应用生成、模型调用、数据库持久化和生成应用预览。

## 环境

- Node.js `22.22.2`，见 `.nvmrc`。
- pnpm `12.11.2`，见根目录 `package.json`。
- 使用 nvm 时先运行 `nvm use`。首次安装可运行 `corepack enable`，由 Corepack 使用项目指定的 pnpm 版本。

在根目录安装依赖：

```sh
pnpm install --frozen-lockfile
```

依赖安装共用根目录 lockfile。框架依赖分别声明在前后端的 package.json 中，不需要分别执行安装。

OpenSpec 使用仓库固定版本，通过 `pnpm openspec` 运行；安装的工作流和变更使用方式见 [OpenSpec 指南](./docs/engineering/openspec.md)。该入口使用项目范围的 CLI 设置，不改变个人全局配置。

## 本地开发

在两个终端分别启动：

```sh
pnpm dev:backend
```

```sh
pnpm dev:frontend
```

- 前端：<http://127.0.0.1:5173>。
- 后端健康接口：<http://127.0.0.1:3001/api/health>。
- 前端请求相对路径 `/api/health`，Vite 将 `/api` 原样代理到后端。
- 页面上的“检查后端连接”按钮验证 HTTP 状态与响应结构；后端不可用时显示失败反馈。
- 两个进程相互独立，后端关闭时前端页面仍可加载。Vite 固定端口，冲突时直接报错。

## 配置

默认值无需创建 `.env` 即可运行。如需覆盖，可参考各应用的 `.env.example` 在对应目录创建 `.env`：

| 文件 | 变量 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `backend/.env` | `HOST` | `127.0.0.1` | 后端监听地址 |
| `backend/.env` | `PORT` | `3001` | 后端端口，范围 1–65535 |
| `frontend/.env` | `API_PROXY_TARGET` | `http://127.0.0.1:3001` | 仅供 Vite 开发／预览代理使用 |

通过 pnpm 启动后端时，其工作目录为 `backend/`；原生 Node 环境加载器读取其中的 `.env`，进程已有变量优先。修改配置后重启对应进程。

前端不配置任何秘密。将来接入模型与数据库时，只在后端添加相应配置与校验。`API_PROXY_TARGET` 不会自动配置服务器上的生产反向代理。

## 验证

```sh
pnpm check
pnpm build
pnpm smoke
```

各命令的实际内容、浏览器前提、已有覆盖和按变更选择检查的要求，统一见 [验证规范](./docs/engineering/verification.md)。检查通过只证明对应范围，不代表尚未实现的产品能力已完成。

单独执行：

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @atoms/frontend build
pnpm --filter @atoms/backend build
```

## 服务器运行

在目标服务器安装相同工具链并执行安装、检查和构建。不要将本机的 node_modules 直接复制到不同操作系统。

启动生产后端：

```sh
pnpm --filter @atoms/backend start
```

前端将 `frontend/dist/` 交给已有 Web 服务器提供静态文件访问；将 `/api/` 原样转发到 `127.0.0.1:3001`。API 的 404 必须由后端返回，不能回退成前端 HTML。

如使用 Nginx，可参考以下路径规则并合入服务器已有配置，替换实际静态目录：

```nginx
root /srv/atoms/frontend/dist;

location / {
    try_files $uri $uri/ /index.html;
}

location /api/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

后端可交给服务器已有进程管理设施维护。具体域名、TLS 与进程管理配置待实际服务器接入时核对。将来添加流式接口时，还需配置反向代理缓冲和读取超时，并实测断线和取消。

本地检查生产前端产物可运行 `pnpm --filter @atoms/frontend preview`，访问 <http://127.0.0.1:4173>；该命令同样代理 `/api`，仅用于本地验收，不替代生产静态服务器。

## 目录

```text
frontend/              React + Vite 前端应用
  AGENTS.md            前端任务路由与局部边界
  src/
    api/health.ts       HTTP 客户端与响应校验
    App.tsx            最小启动与连通检查页面
    App.module.css     页面样式
    main.tsx           浏览器入口
    styles.css         全局基础样式
  vite.config.ts       开发与预览代理
backend/               Fastify 后端应用
  AGENTS.md            后端任务路由与局部边界
  src/
    app.ts             构建应用，不监听端口
    server.ts          环境加载、监听与退出
    config.ts          服务配置解析
    routes/health.ts   健康接口
  test/                接口与配置行为测试
docs/
  README.md            文档索引与目录约定
  architecture/
    stack-decisions.md 技术选型依据
    monorepo.md        目录与依赖边界
  engineering/
    development.md    开发规范
    verification.md   验证与交付
    lifecycle.md      起停行为与后续接口约定
    git-workflow.md   Git 工作流
    skills.md         技能来源与使用范围
    openspec.md       OpenSpec 入口、工件和配置归属
  product/
    assignment.md     原始题目整理稿，仅本地保留
scripts/
  smoke.cjs            浏览器端到端冒烟脚本（pnpm smoke）
AGENTS.md              开发与交付约定
DESIGN.md              平台设计入口，链接到详细设计 skill 与现有启动页约定
.opencode/skills/atoms-frontend-design/   已确认的 Lovable 风格及工作台设计规范
.opencode/skills/openspec-*/     官方生成的 OpenCode 工作流入口
.agents/skills/        固定上游 Git 技能与官方生成的 OpenSpec 技能
.config/openspec/      项目范围的官方 OpenSpec CLI 设置
openspec/              项目上下文与变更工件
README.md              本文件
package.json           workspace 根：命令、工具链版本、共享开发依赖
pnpm-workspace.yaml    workspace 成员声明与 pnpm 设置
pnpm-lock.yaml         唯一依赖锁文件
tsconfig.base.json     共享严格类型配置
eslint.config.mjs      前后端共用 lint 配置
.nvmrc / .editorconfig / .gitignore   仓库级环境与版本控制配置
```

没有预建空的业务目录。生成、存储、迁移与预览模块随首次实现建立。

## 项目 Skills

Skills 的完整文件保存在本仓库中：复用上游的 Git 技能位于 `.agents/skills/`，现有设计 skill 位于 `.opencode/skills/`。这些文件作为项目交付内容纳入版本控制，使用规范不依赖开发者机器上的全局 skill 安装。上游版本、许可证及使用边界见 [Skills 说明](./docs/engineering/skills.md)。

| Skill | 用途 | 来源与适配 |
| --- | --- | --- |
| [atoms-frontend-design](./.opencode/skills/atoms-frontend-design/SKILL.md) | 前端设计、实现与评审，约束平台配色、组件、工作台布局、交互状态、响应式与可访问性 | 基于 awesome-design-md 和 open-design 中的 Lovable 设计分析，按 Atoms 场景编写；来源链接与适配说明见 skill 正文 |
| [git-commit](./.agents/skills/git-commit/SKILL.md) | 用户请求提交时分析差异、按范围暂存并生成 Conventional Commit | 复用 `github/awesome-copilot` 原版，固定上游提交 |
| [yeet](./.agents/skills/yeet/SKILL.md) | 用户明确请求暂存、提交、推送并创建 PR 时使用 | 复用 `openai/skills` 原版；执行前遵循仓库 Git 工作流 |
| [OpenSpec workflows](./docs/engineering/openspec.md#skill-entry-points) | 规划、实施、修订、同步、验证与归档 | 固定 CLI `1.14.3`，官方 Codex/OpenCode 适配生成同一组七个工作流入口 |

进行平台 UI 开发前，先阅读 [DESIGN.md](./DESIGN.md)，再加载对应 skill；工具无法自动发现时，直接读取仓库内的 `SKILL.md`。该设计 skill 已用于建立设计规范，产品工作台尚未实现。

## 项目资料

- [Agent 工作入口](./AGENTS.md)：按任务选择文档、Skills 与检查；前后端细则分别见 [前端指南](./frontend/AGENTS.md) 和 [后端指南](./backend/AGENTS.md)。
- [Git 工作流](./docs/engineering/git-workflow.md)：任务编号、分支命名、提交格式、验证及合并约定。
- [OpenSpec 指南](./docs/engineering/openspec.md)：项目 CLI、上下文、技能与变更工件。
- [Skills 说明](./docs/engineering/skills.md)：上游技能来源、固定版本、触发条件和升级方式。
- [生命周期指南](./docs/engineering/lifecycle.md)：Process Compose 开发编排、现有起停入口与后续 manager、基础设施契约。
- [文档索引](./docs/README.md)：产品参考、技术决策及 Monorepo、开发、验证和生命周期规范的职责与阅读时机。
- [技术栈调研与初始化建议](./docs/architecture/stack-decisions.md)：选型依据及适用边界。
- [设计入口](./DESIGN.md)：平台采用 Lovable 风格的暖色极简 AI 创作工作台；详细规范位于项目级 [atoms-frontend-design skill](./.opencode/skills/atoms-frontend-design/SKILL.md)。规范已确定，产品工作台尚未实现。

原始题目整理稿位于 `docs/product/assignment.md`，仅供本地参考，已由 `.gitignore` 排除，不随仓库发布。密钥、`.env` 和本地工具输出不进入版本控制。
