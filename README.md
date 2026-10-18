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

`check` 依次执行 ESLint、前后端 TypeScript 检查和后端行为测试。后端使用 Node 内置测试器，通过 Fastify injection 检查接口，并验证环境配置边界。

`build` 分别生成 `frontend/dist/` 与 `backend/dist/`。后端构建不包含测试文件。构建通过不代表模型生成、持久化或预览已经实现。

`smoke` 先执行生产构建，再用 Playwright 驱动系统 Chrome 走完整浏览器验收：前后端独立启动、`/api` 代理连通、320/375/768/1280px 布局无横向溢出、异常响应提示、后端离线错误反馈与按钮恢复、生产构建 + 前端 preview 冒烟。脚本只依赖 `playwright-core`，不下载浏览器，需要本机已安装 Google Chrome；截图输出到 `test-results/smoke/`（已忽略入库）。

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
  src/
    api/health.ts       HTTP 客户端与响应校验
    App.tsx            最小启动与连通检查页面
    App.module.css     页面样式
    main.tsx           浏览器入口
    styles.css         全局基础样式
  vite.config.ts       开发与预览代理
backend/               Fastify 后端应用
  src/
    app.ts             构建应用，不监听端口
    server.ts          环境加载、监听与退出
    config.ts          服务配置解析
    routes/health.ts   健康接口
  test/                接口与配置行为测试
docs/                  技术选型文档；原始题目材料仅本地保留
scripts/
  smoke.cjs            浏览器端到端冒烟脚本（pnpm smoke）
AGENTS.md              开发与交付约定
DESIGN.md              当前启动页面的最小 UI 约定
README.md              本文件
package.json           workspace 根：命令、工具链版本、共享开发依赖
pnpm-workspace.yaml    workspace 成员声明与 pnpm 设置
pnpm-lock.yaml         唯一依赖锁文件
tsconfig.base.json     共享严格类型配置
eslint.config.mjs      前后端共用 lint 配置
.nvmrc / .editorconfig / .gitignore   仓库级环境与版本控制配置
```

没有预建空的业务目录。生成、存储、迁移与预览模块随首次实现建立。

## 项目资料

- [技术栈调研与初始化建议](./docs/技术栈调研与初始化建议.md)：选型依据及适用边界。

原始题目整理稿仅供本地参考，已由 `.gitignore` 排除，不随仓库发布。密钥、`.env` 和本地工具输出不进入版本控制。
