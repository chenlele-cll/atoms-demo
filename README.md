# Atoms Demo

React + Vite 前端与 Fastify 后端，同一仓库、独立启动、独立构建，通过 `/api` 通信。

项目目标是让用户通过自然语言生成和修改网页应用，交互预览结果，并保存项目与代码版本。

当前已有健康接口、前端连通检查、企业官网隔离模板预览、后端模型能力探针，以及匿名会话下的 SQLite 项目保存与读取接口。模型协议和失败处理使用本地替身测试；真实 OpenAI 能力仍待 API 配置与显式验收。内部有界候选生成、公开生成事件流/查询/取消、候选预览/采用及创建/对话/预览/只读源码工作台已实现；本地工作台使用受控 SDK 上游验证，真实模型最终业务与部署验收仍需独立完成。

## 环境

- Node.js `22.22.2`，见 `.nvmrc`。
- pnpm `12.11.2`，见根目录 `package.json`。
- 使用 nvm 时先运行 `nvm use`。首次安装可运行 `corepack enable`，由 Corepack 使用项目指定的 pnpm 版本。

选择上述工具链后，在根目录初始化开发环境：

```sh
./manager.sh bootstrap
./manager.sh doctor
```

bootstrap 复用官方安装器安装固定版 Process Compose，并执行 `pnpm install --frozen-lockfile`；不修改全局工具、环境文件或启动服务。重复执行复用已安装工具。Node/pnpm 需要预先可用；仅安装应用依赖仍可使用 `pnpm install --frozen-lockfile`。前后端共用根 lockfile，不需要分别安装。

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
- 连接诊断：<http://127.0.0.1:5173/diagnostics/connection>，保留原连接检查页面。
- 企业官网模板基线：<http://127.0.0.1:5173/templates/company-landing>，也可从首页进入；不需要后端或模型密钥。
- 后端健康接口：<http://127.0.0.1:3001/api/health>。
- 前端请求相对路径 `/api/health`，Vite 将 `/api` 原样代理到后端。
- 诊断页的“检查后端连接”按钮验证 HTTP 状态与响应结构；后端不可用时显示失败反馈。
- 两个进程相互独立，后端关闭时前端页面仍可加载。Vite 固定端口，冲突时直接报错。

完成 bootstrap 后，也可通过 [manager.sh](./manager.sh) 一键管理两个开发进程：

```sh
./manager.sh start
./manager.sh status
./manager.sh logs backend --tail 50
./manager.sh restart
./manager.sh stop
```

健康实例重复 start 不重建，重复 stop 成功；并发修改串行执行，启动失败或中断会回滚。`logs backend --follow` 在另一个终端持续读取，Ctrl+C 只结束读取；停止后仍可读取当前保存的应用日志。JSON 诊断、超时、来源及原生调试方式见 [生命周期指南](./docs/engineering/lifecycle.md#manager-commands)。托管 profile 使用固定本地端口和代理值。

基础设施入口已接入，选择项目 Node 后即可执行，无需先 bootstrap：

```sh
./manager.sh infra start
./manager.sh infra status --json
./manager.sh infra stop
```

当前三个命令均明确返回“未配置外部基础设施”（JSON 为 `not_configured`），重复执行成功，不安装工具或启动服务。真实服务在需要时通过 `INF-002` 接入 Docker Compose；检测到尚未接入的 Compose 配置时明确失败，见 [基础设施约定](./docs/engineering/lifecycle.md#infrastructure-contract)。

## 创建与项目工作台

在首页填写名称与需求、选择真实模板，再点击“创建并生成”。示例只填入文本；Enter 换行，Ctrl/Cmd+Enter 提交（中文组合输入期间不提交）。创建、生成不自动重试；创建响应未知时保留需求，刷新真实项目列表确认。

工作台 `/projects/:projectId` 显示服务端对话、本次实际活动、原请求查询/取消、当前与候选预览和所选版本只读源码。候选保存后先检查真实预览，再明确“使用这个版本”；也可切回当前版本继续，新需求始终以当前已采用版本为基线。聊天/预览/代码切换保留正在运行的连接和预览临时输入；离开项目会关闭原连接并取消未完成工作。取消请求和真实终态分别展示。

候选直达、版本 API、明确采用与隔离预览的详细边界见下方[候选预览与采用](#候选预览与采用)。工作台复用相同的预览与采用状态。

刷新或重新打开用原会话读取已保存项目/对话/当前版本；待确认请求仅查询原 ID，不重发模型。消息默认取最新 50 条，可加载更早；原 afterSequence API 保持兼容。页面内草稿和阅读位置按项目保留，刷新不恢复未发送草稿。会话失效不能认领旧项目。模型未配置仍保留已创建项目和原需求。

`pnpm smoke:workspace` 在构建后从可见表单走真实 SDK 受控上游、工具、SQLite、Sandpack 报价操作、采用与重开，dev/preview 分别验证；不使用真实模型额度。先运行 `pnpm smoke` 完成构建，需要 Chrome、空闲 3001/5173/4173 和外部 Sandpack 网络，证据在忽略的 `test-results/workspace/`，边界见 [Workspace verification](./docs/engineering/verification.md#project-workspace)。

## 企业官网模板基线

复用固定提交的 MIT 开源模板 `leoMirandaa/shadcn-landing-page`，在与宿主不同源的 Sandpack iframe 中运行 React 18；宿主仍使用 React 19 和 CSS Modules。基线保留导航、价格展示、FAQ、主题和手机菜单，明确标注样例内容；没有注册、支付、订阅或咨询发送服务。来源、逐文件校验值和适配记录见 [模板说明](./templates/company-landing/ADAPTATIONS.md)。

前端 dev/build 自动从本地固定源码预编译 Tailwind、内嵌图片并准备文件集合，普通启动不拉取上游分支。也可在根目录单独运行：

```sh
pnpm prepare:template
pnpm test:template
pnpm build
pnpm smoke:template
```

`smoke:template` 需要已构建产物、Chrome、空闲的 5173/4173 端口及外部 Sandpack/依赖下载网络，自行管理所属 dev/preview 服务，不启动上游应用。模板源、纯格式校验与生成资产分开维护；生成 JSON 被忽略并随前端构建复制到 dist。预览按实际编译结果显示状态，资源/格式/编译/超时故障可主动重新加载；重新加载重置预览临时状态。完整覆盖与实际证据见 [Verification](./docs/engineering/verification.md#template-baseline)。

## 配置

默认值无需创建 `.env` 即可运行。如需覆盖，可参考各应用的 `.env.example` 在对应目录创建 `.env`：

| 文件 | 变量 | 默认值 | 作用 |
| --- | --- | --- | --- |
| `backend/.env` | `HOST` | `127.0.0.1` | 后端监听地址 |
| `backend/.env` | `PORT` | `3001` | 后端端口，范围 1–65535 |
| `backend/.env` | `DATABASE_PATH` | `../data/atoms.sqlite` | 相对 backend 工作目录解析的持久数据文件；禁止内存/空路径及 backend/dist 内路径 |
| `backend/.env` | `APP_ORIGINS` | `http://127.0.0.1:5173,http://127.0.0.1:4173` | 逗号分隔的精确来源；公网必须 HTTPS，不与开发 HTTP 混用 |
| `backend/.env` | `OPENAI_API_KEY` | 无；仅模型调用时必填 | 独立 OpenAI Platform 项目的服务端凭据 |
| `backend/.env` | `MODEL_ID` | 无；模板建议 `gpt-6.1-sol` | 显式指定模型；无权限时失败，不自动切换 |
| `backend/.env` | `MODEL_TIMEOUT_MS` | `60000` | 每项完整能力样例的时限，整数 1000–120000ms |
| `backend/.env` | `MODEL_MAX_OUTPUT_TOKENS` | `4096` | 每次请求的输出上限，整数 256–8192 |
| `frontend/.env` | `API_PROXY_TARGET` | `http://127.0.0.1:3001` | 仅供 Vite 开发／预览代理使用 |

通过 pnpm 启动后端时，其工作目录为 `backend/`；原生 Node 环境加载器读取其中的 `.env`，进程已有变量优先。修改配置后重启对应进程。

模型配置延迟到显式调用边界校验；后端启动、健康检查和模板预览不需要密钥。前端不配置任何秘密。`API_PROXY_TARGET` 不会自动配置服务器上的生产反向代理。

## 项目数据 API

按以下顺序，通过同源 `/api` 请求使用；项目工作台也使用这些接口。所有 POST 必须为 JSON，并带 APP_ORIGINS 中的 Origin。脚本调用需显式提供 Origin，并保存/回传 cookie；浏览器 fetch 使用同源默认凭据。

| 请求 | 请求内容与响应 |
| --- | --- |
| POST /api/session | `{}`；201 新会话，200 复用；`{expiresAt}` |
| GET /api/templates | 公开 `{items:[{id,version,digest,name,category,source}]}`，不返回代码或设置会话 |
| POST /api/projects | `{templateId,templateVersion,templateDigest,title}`；201 `{project,currentVersion,latestRun:null}` |
| GET /api/projects?limit=20&cursor=… | 当前会话的 `{items,nextCursor}`；最多 50 条元数据，不含代码 |
| GET /api/projects/:projectId | `{project,currentVersion,latestRun}`，当前版本含完整 snapshot |
| GET /api/projects/:projectId/messages?afterSequence=0&limit=20 | `{items,nextAfterSequence}`，原增量协议，按序号升序，最多 50 条 |
| GET /api/projects/:projectId/messages?direction=backward&limit=50 | `{items,nextBeforeSequence,latestSequence}`；可用互斥的 `beforeSequence=N` 取更早页，items 始终升序 |

新项目原子保存服务端可信模板 v0，消息为空、没有生成记录；模板冲突返回 409，客户端不能注入文件或所有者。匿名 cookie 为 HttpOnly、SameSite=Strict、Path=/api，有效期 30 天，复用不延长；HTTPS 配置启用 Secure。数据库只保存 token 摘要。清理 cookie 或到期后会失去旧项目入口，没有找回或认领接口；数据不会自动删除。有效会话访问他人的项目与不存在项目均为 404，无会话为 401。

会话初始化默认每 IP 每分钟 30 次，创建项目 10 次；每会话最多 20 个项目。超限分别返回带 Retry-After 的 429 或项目配额 409；上述 POST 请求体最多 8 KiB。错误统一 `{error:{code,message},requestId}`，私有响应 no-store。消息/run/候选由生成内核写入，没有任意代码写入或分享接口；版本读取/采用见下节，候选保存保持当前版本不变。契约与限制见 [Development](./docs/engineering/development.md#project-persistence)，真实验证见 [Verification](./docs/engineering/verification.md#project-persistence)。

## 候选预览与采用

使用原会话直接打开 `/projects/:projectId/candidates/:versionId`，读取已存版本并在跨源 Sandpack iframe 中预览。页面展示当前/候选、模板来源、实际修改文件和编译状态；支持查看当前版本、重试和明确“使用这个版本”。没有会话或归属时显示真实错误，不初始化或认领项目。

| 接口 | 行为 |
| --- | --- |
| GET /api/projects/:projectId/versions/:versionId | 完整不可变 version、successfulRun 或 null、changedFiles、currentVersionId、adoptionAvailability；有归属、no-store、每 IP 每分钟 60 次 |
| POST /api/projects/:projectId/versions/:versionId/adopt | 严格 `{expectedCurrentVersionId}`，上限 1 KiB；返回 `{projectId,currentVersionId,updatedAt,alreadyCurrent}`；每 IP 每分钟 10 次 |

采用须关联本项目成功生成运行，parent 与 expected 相同，当前仍为 expected，且没有活动或未确认生成。过期为 409 CURRENT_VERSION_CONFLICT；不是合法候选为 409 CANDIDATE_NOT_ADOPTABLE；活动为 409 PROJECT_BUSY，孤立 running 为 503 RUN_STATE_UNCONFIRMED。同一合法目标已是当前时返回 alreadyCurrent=true，不重复写入；不提供历史恢复。采用只切换当前引用，不修改快照或调用模型。

按钮仅在本轮候选真实编译完成、无已知错误且服务端条件可用时启用。编译反馈是本地观察，不是可信编译证明或业务验收；后端不接受 verified 标记。网络断开/响应不合法时显示待确认并查询当前项目，查询失败可再次查询；仍是原版本不能证明原请求不会提交，可由所有者明确重试同一载荷。出现其他当前版本时保留冲突，不自动更换 expected 或回写旧版本。

外部 Sandpack/bundler 会接收用于预览的代码，依赖联网与依赖包下载。iframe 不接收平台会话、对话或后端配置；sandbox 仅允许 scripts/same-origin，allow 为空且 no-referrer。切换/重试重置预览内临时输入；刷新及后端重启重新读取持久选择并重新编译，浏览器运行错误不会静默回退已采用版本。

刷新与采用共用同步互斥保护；刷新期间禁用首次采用和手动重试，避免迟到的旧读取覆盖采用确认。

前后端通过 `packages/contracts` 共用会话/目录/项目/消息/分页/版本/快照/run/SSE/采用/安全错误契约。独立 dev/build/typecheck/test 自动准备其 ESM/声明，根 check 也先准备；契约源改变后重新准备或重启应用，不承诺跨包热更新。生产后端部署须含中立包的 package.json、dist 和运行依赖，见 [Monorepo](./docs/architecture/monorepo.md#shared-contract-build)。

先 `pnpm build`，再 `pnpm smoke:candidate`；需要 Chrome、空闲 3001/5173/4173 以及外部 Sandpack 网络。报告位于忽略的 `test-results/candidate-review/<id>/report.json`，以明确 fixture 候选验证真实编译、报价控件、隔离、错误、采用竞争和重启，不消耗真实模型额度。覆盖与限制见 [Verification](./docs/engineering/verification.md#candidate-review)，历史混合工作区证据与隔离验证记录见 [GEN-006 tasks](./openspec/changes/gen-006-candidate-preview-adoption/tasks.md#isolated-review-evidence)。

## 模型能力探针

先在本地 `backend/.env` 配置独立 API 凭据与模型，勿在聊天或仓库发送秘密。ChatGPT Pro 与 OpenAI Platform 的 API 凭据、额度和模型权限分开；本项目不读取 ChatGPT/Codex 登录缓存。推荐模型是否可用以账户实际调用为准。

```sh
pnpm model:probe --help
pnpm model:probe --case text
pnpm build
pnpm model:probe:built --case all --report
```

无参数或 `--help` 仅显示帮助，不读取环境文件、不发请求。只有显式 `--case text|files|tools|all` 才调用；文本/文件各最多 1 次、工具最多 2 次、all 最多 4 次，没有自动重试。使用 Responses API 并设置 `store: false`；每项样例共用一个截止时间，Ctrl+C / SIGTERM 中止活动请求并分别退出 130/143。认证、权限、额度、服务、网络、超时或取消会停止剩余样例。

文件样例只检查 `/App.tsx` 的结构、非空内容及 16 KiB 字节上限，不写入、不执行、不证明编译通过；工具只读取公开内存数据，最终回答须确认本次实际工具结果。默认输出脱敏 JSON，可选报告保存到忽略的 `test-results/model-probe/<runId>.json`。`source` 区分 live/fixture/not-run，用量缺失为 null；缺配置、任一必需项失败或未执行均非零退出。默认 check/smoke/verify、健康检查及 CI 均不调用真实模型。覆盖和验收边界见 [Model access](./docs/engineering/verification.md#model-access)。

## 有界候选生成

GEN-004 提供 generateProject 内核，GEN-005 将其接入下节公开接口；生成 UI 由 GEN-007 接入。内核从已保存当前版本读取代码，通过 list_files/read_files/submit_files 修改有限业务文件，最多六次模型请求、共享默认 60 秒期限、零重试。受理记录与用户输入先保存，合法提交将完整候选、事实摘要和成功状态原子保存，当前版本保持不变。失败保留输入；同一 requestId 重放不再次调用模型。

```sh
pnpm generation:smoke --help
pnpm generation:smoke:built --help
# 完成 pnpm build 后，显式执行一项真实样例：
pnpm generation:smoke:built --live --case quote
```

另有公开 filter 样例；每次只执行所选一项，不自动追加第二项或修复。源码命令会先准备后端模板资产；帮助不读取后端环境或请求模型。只有 --live 和指定 --case 同时存在才调用，使用 backend/.env 的模型配置及固定官方端点；兼容端点支持仍在独立待提交的 GEN-002 改动中。运行器创建自己的随机匿名会话、项目和 SQLite 文件，忽略生产 DATABASE_PATH，不接收现有项目 ID。

报告在忽略的 test-results/generation-smoke/<id>/report.json，同目录保留关闭后的隔离测试数据库用于本地核对，不能上传这些数据库。报告区分 live/fixture/not-run，含实际请求/已知用量、工具元数据、修改路径与候选重开比较，不含代码、提示词或凭据。保存成功仍为 previewStatus=unverified；本轮不证明报价交互、浏览器编译或线上部署。边界见 [Development](./docs/engineering/development.md#bounded-generation)，实测见 [GEN-004 记录](./openspec/changes/gen-004-bounded-agent-generation/tasks.md)。

## 生成事件与控制 API

先初始化会话并创建项目，在 POST 之前生成并保存 requestId（UUID）；取得项目当前 baseVersionId 后调用：

| 请求 | 行为 |
| --- | --- |
| POST /api/projects/:projectId/generations | `{requestId,baseVersionId,prompt}`，Accept: text/event-stream；新任务 200 SSE，相同载荷重复请求为 202 running JSON / 200 terminal JSON |
| GET /api/projects/:projectId/generations/by-request/:requestId | 200 JSON 状态，不调用模型；无执行者的 running 为 503 RUN_STATE_UNCONFIRMED |
| POST /api/projects/:projectId/generations/by-request/:requestId/cancel | 严格 `{}`；活动任务 202、cancellationRequested=true，终态 200 保持原结果 |

POST 沿用精确 Origin、JSON 与 cookie；生成体最大 32 KiB，prompt 修剪后 1–4000 字符且不超过 UTF-8 16 KiB。额外字段/非法路径 400、缺会话 401、来源 403、无归属 404、Accept 406、体积 413、类型 415。过期基线/载荷冲突 409，缺模型配置 503，均在受理及开流前返回安全 JSON。

用 fetch 读取响应流，第一帧 accepted（seq=1），activity 是真实工具/请求元数据，terminal.state 是持久化状态。所有帧含递增 seq、项目/request/run/base ID；不发送代码、需求正文或思维链。成功仅代表候选已保存、previewStatus=unverified。terminal.state.status=unknown 表示落盘未确认；HTTP 200 或 EOF 都不能单独判断成功。心跳为注释，不计进度，不提供事件重放。

断线后凭原 requestId 查询，不自动重新 POST；只关闭最初 SSE 才取消未完成运行，不能通过重复请求接管连接。显式取消先返回“已请求”，待查询确认 cancelled；成功先提交则保持 succeeded。关闭浏览器不保证后台续跑。当前每项目/会话/全局活动数为 1/1/2，生成 POST 每 IP 每分钟 6 次，查询与取消分别 120 次；每会话滚动 24 小时最多 20 次新受理（失败/取消也计数，匹配重放不重复扣日配额）。不排队；容量 429/503 带 Retry-After。多反代客户端可能共享 IP 配额，部署前核对实际环境。

同一数据文件只运行一个后端服务；先取得文件所有权再恢复/监听。硬杀后可能需等待 30 秒 stale 窗口，禁止手工删未知锁；详见 [Lifecycle](./docs/engineering/lifecycle.md#generation-service-lifecycle)。流协议及资源上限见 [Development](./docs/engineering/development.md#generation-execution)。

## 验证

项目专项需先构建，再运行 `pnpm smoke:projects`，覆盖真实浏览器的 dev/preview 代理、cookie 隔离、完整快照恢复和构建后端重启；测试中的消息、run 与候选明确为内部夹具，不消耗模型额度。

生成流专项同样先 `pnpm build`，再运行 `pnpm smoke:generation-stream`；需要 Chrome 和空闲 3001/5173/4173。它以 fixture SDK 上游验证浏览器经 dev/preview 的首帧、终态、取消、断线查询及所属后端重启，报告在忽略的 `test-results/generation-stream/<id>/report.json`。跨字节 UTF-8 解码使用明确的注释夹具，实际业务帧仅为允许的元数据；不调用真实模型，不证明候选预览或最终服务器反代通过。详细前提与覆盖见 [Verification](./docs/engineering/verification.md#generation-stream)。

统一产品回归与完整专项回归：

```sh
pnpm verify:product
pnpm verify
```

product（20 分钟总预算）在新源副本中执行 offline frozen install、SQLite 绑定读写、check、模板准备、infra、一次生产构建、原诊断 smoke 和完整工作台主路径；full（40 分钟）再加入 doctor、manager 及模板/项目/事件流/候选专项。各步骤有单独上限，首错停止，不自动重试；未选择项明确为 NOT_SELECTED，默认不调用真实模型或部署服务。

先选择项目 Node/pnpm、frozen install 准备本平台缓存，安装 Chrome/npx/Git，让 3001/5173/4173 空闲；full 还需 bootstrap 的固定 Process Compose 和 manager 首次安装回归所需 GitHub 网络。副本不复制 node_modules 或真实 .env，缺 offline 缓存/native 绑定会阻塞；外部 Sandpack 仍需网络。原 smoke/专项入口保留原用途，`pnpm smoke` 独立运行仍自带 build。

产物在忽略的 `test-results/gen-regression/<runId>/`；本地默认新 UUID，可用 `ATOMS_VERIFY_RUN_ID` 指定全新合法标识，拒绝复用旧目录。仅 `export/` 的投影摘要与白名单遮罩截图可分享；`source/` 和 `private/` 的副本、日志、数据库与原始截图留本地。状态/退出、覆盖、脱敏与前提见 [集成本地验收](./docs/engineering/verification.md#integrated-local-acceptance)。

日常按变更范围选择以下命令：

```sh
pnpm check
pnpm build
pnpm smoke
pnpm smoke:projects
pnpm test:manager
pnpm test:infra
```

各命令的实际内容、浏览器前提、已有覆盖和按变更选择检查的要求，统一见 [验证规范](./docs/engineering/verification.md)。检查通过只证明对应范围，不代表尚未实现的产品能力已完成。

[GitHub Actions 配置](./.github/workflows/ci.yml) 已提供：PR、main 推送和手动触发运行 Ubuntu 的 verify:product；手动可开启 macOS 的完整 verify 验收。配置需发布到 GitHub 后才能取得远端运行结果，触发方式、固定来源和覆盖边界见 [CI 说明](./docs/engineering/verification.md#github-actions)。

交互式浏览器检查使用仓库官方 Playwright Skill 和 `pnpm playwright`，无需全局安装。固定版本、具名会话及截图路径见 [浏览器验收入口](./docs/engineering/skills.md#browser-verification)。

单独执行：

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @atoms/frontend build
pnpm --filter @atoms/backend build
```

## 服务器运行

两应用独立 dev/build/typecheck/test 先准备共享契约。后端 dev/typecheck/test 在执行前准备 src/template-assets，build 先准备 src，再编译并准备 dist/template-assets；三个目标从同一中立模板源产生一致内容，前后端构建各写自己的目标。后端部署包含整个 backend/dist、@atoms/contracts 的 package.json/dist 及在目标平台安装的各自运行依赖，不需要 frontend 源码或 public 目录。better-sqlite3 13.0.3 自带 N-API 原生预构建文件；安装后仍需验证实际打开/读写，不跨系统复制 node_modules。

后端监听前加载自身模板目录并迁移真实 SQLite 文件；初始化、缺资产、不支持 schema 或监听失败均非零退出。正常停止保留数据库，启动不清库、不回退到内存，不自动降级高版本数据。数据库应放在 dist 之外的持久目录。

在目标服务器安装相同工具链并执行安装、检查和构建。不要将本机的 node_modules 直接复制到不同操作系统。

启动生产后端：

```sh
pnpm --filter @atoms/backend start
```

前端将 `frontend/dist/` 交给已有 Web 服务器提供静态文件访问；将 `/api/` 原样转发到 `127.0.0.1:3001`。API 的 404 必须由后端返回，不能回退成前端 HTML。

`DEP-002/003` 已提供 [deploy.sh](./deploy.sh) 与固定 Ansible Core：`bootstrap` 准备本地工具，`plan`/`plan --json` 查看离线阶段与待接入点，`validate`/`test` 验证框架，`check`/`status` 只读检查服务器。私有 inventory 从 [server.example](./server.example) 准备，已有私有文件不覆盖；真实配置不入库。具体命令、字段和检查范围见 [部署指南](./docs/engineering/deployment.md)。

部署框架已定义预检、发布暂存、配置暂存、激活、健康、失败恢复和收尾，包含配置暂存保护与幂等决策。生产模板采用已有 Nginx + systemd，支持 IP HTTPS、API 流转发和外置 SQLite/配置。依赖未接入时 `apply` 列出缺项后返回非零，尚无真实上传、切换、服务操作或部署通过记录；后续补齐接点，DEP-004 再做目标验收。

releaseId 创建、复用、配置更新与回滚规则统一维护在 [发布版本标识](./docs/engineering/lifecycle.md#deployment-release-identity)。发布包不可变，重复部署不得隐式重建；发布构建继续由 GEN-009 实现。

本地检查生产前端产物可运行 `pnpm --filter @atoms/frontend preview`，访问 <http://127.0.0.1:4173>；该命令同样代理 `/api`，仅用于本地验收，不替代生产静态服务器。

## 目录

```text
frontend/              React + Vite 前端应用
  AGENTS.md            前端任务路由与局部边界
  src/
    api/health.ts       HTTP 客户端与响应校验
    App.tsx            创建、项目工作台与直达页面路由
    App.module.css     页面样式
    main.tsx           浏览器入口
    styles.css         全局基础样式
    templates/         公开模板资源加载与解析
    template-baseline/ 企业官网模板基线页及隔离预览
    preview/           共用快照 iframe 与每次尝试的状态机
    candidate-review/  候选读取、编译状态与明确采用
    workspace/         创建、持久对话、生成控制、预览与只读源码
    diagnostics/       独立连接诊断页面
  vite.config.ts       开发与预览代理
backend/               Fastify 后端应用
  AGENTS.md            后端任务路由与局部边界
  src/
    app.ts             构建应用，不监听端口
    server.ts          环境加载、监听与退出
    config.ts          服务配置解析
    routes/health.ts   健康接口
    routes/projects.ts 匿名会话、目录和项目 API
    routes/versions.ts 有归属的版本读取与条件采用
    contracts/         Zod 输入/输出与快照契约
    storage/           SQLite 迁移、事务和内部写入
    templates/         后端可信模板目录
  test/                接口与配置行为测试
packages/contracts/    会话/目录/项目/消息/版本/快照/run/SSE/采用/错误共用契约与摘要校验
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
    core-paths.md      核心路径、模板生成策略、范围与验收目标
    assignment.md     原始题目整理稿，仅本地保留
scripts/
  prepare-company-template.mjs    模板样式/资源准备与原子输出
  prepare-company-template.test.mjs 模板准备与边界行为测试
  template-smoke.cjs              模板真实浏览器回归
  template-smoke-control.test.mjs  模板验收的端口归属与信号清理检查
  project-smoke.cjs               项目 API、浏览器会话隔离和 dist 重启恢复
  check-dev-port.cjs   托管服务启动前检查固定端口，不终止占用者
  manager.mjs          短时运行的生命周期命令，调用 Process Compose
  setup.mjs            无需 node_modules 的 bootstrap / doctor / infra 入口
  manager.test.mjs     隔离副本上的真实进程行为回归
  infra.test.mjs       空基础设施 CLI 的无依赖与副作用验证
  vendor/process-compose/         原样固定的官方安装器及许可证
  smoke.cjs            浏览器端到端冒烟脚本（pnpm smoke）
manager.sh            本地 bootstrap/doctor/start/stop/restart/status/logs/infra 入口
templates/            中立模板文件集合校验及固定来源的 company-landing 资产
process-compose.yaml  原生本地开发进程与就绪、退出、日志配置
.process-compose-version        固定 Process Compose 工具版本
AGENTS.md              开发与交付约定
DESIGN.md              平台设计入口，链接到详细设计 skill 与现有启动页约定
.agents/skills/atoms-frontend-design/   已确认的 Lovable 风格及工作台设计规范
.agents/skills/        所有仓库技能的唯一目录：设计、Git、Playwright、OpenSpec
.playwright/           浏览器 CLI 的项目配置
.config/openspec/      项目范围的官方 OpenSpec CLI 设置
.github/workflows/ci.yml         日常质量检查与手动完整生命周期验收
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

所有仓库 Skills 统一保存在 `.agents/skills/<name>/SKILL.md`，配套脚本、引用和资源跟随技能目录。Codex 和 OpenCode 读取同一份文件，不再维护按工具复制的技能目录。其他宿主需要适配时只配置发现路径，内容仍在共享目录。上游版本、许可证、调用差异及个人同名技能的处理边界见 [Skills 说明](./docs/engineering/skills.md)。

| Skill | 用途 | 来源与适配 |
| --- | --- | --- |
| [atoms-frontend-design](./.agents/skills/atoms-frontend-design/SKILL.md) | 前端设计、实现与评审，约束平台配色、组件、工作台布局、交互状态、响应式与可访问性 | 基于 awesome-design-md 和 open-design 中的 Lovable 设计分析，按 Atoms 场景编写；来源链接与适配说明见 skill 正文 |
| [git-commit](./.agents/skills/git-commit/SKILL.md) | 用户请求提交时分析差异、按范围暂存并生成 Conventional Commit | 复用 `github/awesome-copilot` 原版，固定上游提交 |
| [yeet](./.agents/skills/yeet/SKILL.md) | 用户明确请求暂存、提交、推送并创建 PR 时使用 | 复用 `openai/skills` 原版；执行前遵循仓库 Git 工作流 |
| [playwright](./.agents/skills/playwright/SKILL.md) | 真实浏览器快照、交互、截图和调试 | 复用 `openai/skills` 原版；CLI `0.1.22` 固定为项目开发依赖 |
| [OpenSpec workflows](./docs/engineering/openspec.md#skill-entry-points) | 规划、实施、修订、同步、验证与归档 | 固定 CLI `1.14.3`，官方 Codex/OpenCode 适配生成同一组七个工作流入口 |

进行平台 UI 开发前，先阅读 [DESIGN.md](./DESIGN.md)，再加载对应 skill；工具无法自动发现时，直接读取仓库内的 `SKILL.md`。创建与项目工作台沿用该设计规范。

## 项目资料

- [核心功能路径与生成质量方案](./docs/product/core-paths.md)：Top 1 模板起步与真实生成、Top 2 对话修改与版本恢复、Top 3 固定版本分享的范围与验收目标；实际完成与验证范围以对应任务证据为准。
- [Agent 工作入口](./AGENTS.md)：按任务选择文档、Skills 与检查；前后端细则分别见 [前端指南](./frontend/AGENTS.md) 和 [后端指南](./backend/AGENTS.md)。
- [Git 工作流](./docs/engineering/git-workflow.md)：任务编号、分支命名、提交格式、验证及合并约定。
- [OpenSpec 指南](./docs/engineering/openspec.md)：项目 CLI、上下文、技能与变更工件。
- [Skills 说明](./docs/engineering/skills.md)：上游技能来源、固定版本、触发条件和升级方式。
- [生命周期指南](./docs/engineering/lifecycle.md)：manager 命令、Process Compose 开发编排与基础设施接入边界。
- [文档索引](./docs/README.md)：产品参考、技术决策及 Monorepo、开发、验证和生命周期规范的职责与阅读时机。
- [技术栈调研与初始化建议](./docs/architecture/stack-decisions.md)：选型依据及适用边界。
- [设计入口](./DESIGN.md)：平台采用 Lovable 风格的暖色极简 AI 创作工作台；详细规范位于项目级 [atoms-frontend-design skill](./.agents/skills/atoms-frontend-design/SKILL.md)，创建与项目工作台已接入。

原始题目整理稿位于 `docs/product/assignment.md`，仅供本地参考，已由 `.gitignore` 排除，不随仓库发布。密钥、`.env` 和本地工具输出不进入版本控制。
