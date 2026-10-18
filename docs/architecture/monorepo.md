# Monorepo contract

本文件维护目录、依赖和工具链边界。调整应用组织、共享代码或 workspace 配置时阅读并更新；框架选型的原因见 [stack-decisions.md](./stack-decisions.md)。

## Current topology

| 位置 | 职责 |
| --- | --- |
| `frontend/` | React + Vite 浏览器应用，拥有自己的依赖、启动入口和构建产物 |
| `backend/` | Fastify HTTP 服务，拥有自己的依赖、配置、启动入口和构建产物 |
| `packages/contracts/` | 前后端实际共用的公开 Zod 契约、纯快照规则与摘要校验，输出 ESM/声明 |
| 根目录 | workspace 命令、唯一 lockfile、公共开发工具配置与 Agent 入口 |
| `scripts/` | 仓库级运行和验证脚本；包含固定 product/full 验收计划、隔离输入/报告/进程辅助、端口预检、manager/setup、行为测试、官方安装器副本与浏览器冒烟脚本 |
| `deploy/` | 固定控制端 Python/Ansible 依赖、只读 playbook 与生产配置模板；不属于 workspace 应用，不提供产品运行依赖 |
| `templates/` | 固定来源的公开模板资产；company-landing 保存适配源码/许可/清单，bundle.mjs 是准备与浏览器共用的纯格式校验，不是 workspace 应用 |
| `docs/` | 产品参考、技术决策和工程规范，按英文子目录组织 |
| `.agents/skills/` | 所有仓库技能及资源的唯一目录；宿主通过原生发现或路径适配读取，来源和职责见 [skills.md](../engineering/skills.md) |

## Dependency boundaries

- 前后端独立启动、构建和运行，通过 HTTP 下的 `/api` 通信。前端不能导入后端源码或直接访问数据库，后端不能依赖前端 UI 实现。
- 开发代理和生产反向代理属于 HTTP 接入方式，不改变应用之间的代码边界。
- 每个应用在自己的 package.json 中声明实际使用的依赖；根目录声明公共开发工具，不能依靠另一应用的依赖偶然可见。
- `backend/src/app.ts` 构建应用并注册路由，不监听端口；`server.ts` 负责环境加载、监听和进程生命周期。
- 路由负责 HTTP 边界。生成和存储职责随首次实现形成实际模块，不持续堆入路由，也不预建空的 service、repository 或通用依赖注入层。
- backend/src/model 维护单供应商客户端、延迟配置、独立探针和安全错误，AI SDK/OpenAI 仅在 backend 声明，Zod 的公开契约使用见下节。探针文件和工具不依赖模板或项目模块，不新增浏览器可用的计费接口；真实调用与替身测试分别记录。
- backend/src/contracts、storage、projects、templates 分别维护公开 Zod 契约、SQLite 存储/迁移、配置/安全错误及后端目录。项目 routes 通过注入调用这些具体模块，不把 SQL 放入 HTTP handler；GEN-006 的浏览器消费者与后端通过 @atoms/contracts 共用必要公开契约；GEN-007 实际消费的会话、分页、消息和 SSE 契约也归共享包；模型/存储实现保留后端。
- backend/src/generation 维护内部生成契约、冻结文件工具、显式有界编排和隔离验收，复用 model 单步传输与 storage 事务；GEN-005 在具体 manager/stream 和 generation 路由中接入公开执行及生命周期，不增加框架 Agent。生成工具只持有快照/策略，模型调用在事务之外，候选不会原地覆盖当前版本。

## Workspace and toolchain

- workspace 成员以根目录 [pnpm-workspace.yaml](../../pnpm-workspace.yaml) 为准，共用根目录唯一的 `pnpm-lock.yaml`。
- Node 版本以 [.nvmrc](../../.nvmrc) 为准，pnpm 版本和 Node 范围以根 [package.json](../../package.json) 为准。`.nvmrc` 的存在不代表当前终端已经切换版本。
- 在仓库根目录安装依赖，使用 frozen lockfile 验证可重复安装；依赖调整同时更新声明和唯一 lockfile。
- Sandpack 间接依赖 es5-ext 的 postinstall 仅输出提示，不生成运行文件；allowBuilds 显式设为 false，不需要执行该脚本。保留既有 esbuild 构建许可，不自动批准包附带的 Agent skills。
- TypeScript 的公共编译约束在 [tsconfig.base.json](../../tsconfig.base.json)，应用差异保留在各自配置中；ESLint 使用根目录统一入口。
- 前后端产物分别写入各自的 `dist/`，生产后端构建排除测试。测试源码随项目维护；依赖目录、构建产物和本地运行产物不入库。
- 前端 dev/build 先运行 scripts/prepare-company-template.mjs，从模板源生成忽略的 frontend/public/template-assets/company-landing.bundle.json；Vite 将它复制到 dist。模板源码不导入宿主 React 树，预览运行依赖与宿主安装依赖分开，样式提前编译。来源及改动见 [模板适配说明](../../templates/company-landing/ADAPTATIONS.md)。
- 同一准备脚本支持 frontend/backend-src/backend-dist 三个独立目标。后端准备目录含 bundle JSON 与同源中立校验模块/类型，不维护第二套文件规则；src 资源被忽略，构建会准备 src 并将对应副本放入 dist，编译产物独立于前端目录。typecheck/test 也先准备 src，使全新安装可独立运行检查。
- 后端固定 better-sqlite3 13.0.3、@types/better-sqlite3 9.6.0、@fastify/cookie 11.1.3、@fastify/rate-limit 11.2.1，复用现有 Zod 4.6.7。SQLite 13 自带 N-API 平台预构建且没有安装脚本，本次无需新增 pnpm 脚本许可；保留已有 esbuild 许可和 es5-ext 拒绝。目标平台 frozen install 后必须执行真实绑定读写，不能以声明或复制别处 node_modules 代替。

后端显式使用运行依赖 proper-lockfile 4.1.2，类型 @types/proper-lockfile 4.1.4 仅开发使用；根已有同版本工具依赖继续独立声明。后端独立部署安装自身运行依赖，不依赖根 node_modules 偶然可见。所有权模块只处理规范数据文件与 release，Fastify 的 preClose/onClose 协调生成→存储→锁；GEN-007 的 SSE schema 已随实际浏览器消费者提入 @atoms/contracts，管理器和存储实现仍只在后端。参数与本地文件系统前提见 [Lifecycle](../engineering/lifecycle.md#generation-service-lifecycle)。

## Shared contract build

`packages/contracts`（@atoms/contracts）输出 ESM JavaScript 与声明到 dist；前后端通过 workspace:* 显式依赖。包仅含实际共用会话/目录/项目/消息/run/SSE/版本/快照/采用/错误 schema 与推导类型，Zod 固定 4.6.7。浏览器与后端都须同步验证 SHA-256，因此使用纯 JavaScript @noble/hashes 2.0.1，不引入 Node crypto 到浏览器，也不手写散列算法。纯文件格式/规范 JSON 仍来自 templates/bundle.mjs；包构建复制同源纯模块与类型到自身资产，不维护第二套规则。

scripts/prepare-contracts.mjs 是统一准备入口，复用 root proper-lockfile 串行化同仓库的操作；按契约源码、配置、lockfile 和纯模板规则输入的 SHA-256 与必要输出摘要检查，缺失/过期才构建。编译到私有暂存目录并在成功后替换 dist，失败阻止后续命令，普通编译失败保留原产物。60 秒总期限涵盖取锁与构建，信号/超时终止所属编译进程组；锁由所属 release 释放，所有权丢失则不释放未知锁。包 build/typecheck、根 check、两应用独立 dev/build/typecheck/test 和源码 generation:smoke 复用入口，不增加常驻 watcher。

manager 隔离副本复制 packages/contracts 源、build.mjs 和准备脚本，经独立 frozen install 构建，排除环境、数据库、node_modules 与 dist；doctor 同时诊断该 workspace 及声明依赖。后端生产布局须包含中立包 package.json/dist/同平台运行依赖，不依赖前端或根模板源码。浏览器专项的 prepare-backend-runtime.mjs 复制应用及共用包输出，只链接本机已安装的外部依赖；这用于同平台测试，不作为跨平台复制 node_modules 的部署办法。

## Adding shared code

当前 @atoms/contracts 是唯一公共运行时包，只共享实际使用的公开类型、边界校验 schema 和浏览器可用摘要/文件规则，不包含后端凭据、数据库访问或应用实现。建立 workspace 包时使用显式 workspace 依赖，保持依赖方向清晰、无环。

新增框架、服务、公共包或依赖必须对应当前需求。缓存与构建编排工具在任务依赖或实际成本需要时评估，避免为目录完整而增加模块。

## Enforcement status

现有工具执行严格类型检查、ESLint 和行为测试。[CI 配置](../engineering/verification.md#github-actions) 已接入既有检查，远端执行结果以实际 Actions 记录为准。跨应用源码导入和模块依赖方向目前仍需审查，本文件不代表这些约束已经自动执行。新增自动约束时应同时更新配置和验证记录。

GEN-007 的前端固定依赖 eventsource-parser 4.1.2，负责有界 POST 响应的 SSE 分帧；本地控制器继续负责 HTTP、UTF-8、总字节/帧数、关联/顺序、超时和终态，不手写第二个 SSE 解析器。它是浏览器运行依赖，不加入后端或共享契约包。
