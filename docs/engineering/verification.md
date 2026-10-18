# Verification

本文件是检查选择、覆盖范围和验收证据的维护入口。修改验证命令、测试覆盖或交付要求时更新；命令实现以根 [package.json](../../package.json) 和实际测试文件为准。

## Change matrix

| 变更范围 | 应执行的检查 |
| --- | --- |
| 纯文档、路径与导航 | 差异、相对链接、旧引用与 `git diff --check`；工程事实与实现对照 |
| 应用代码、构建或影响运行的配置 | `pnpm check`、`pnpm build`，以及受影响边界的行为与失败测试 |
| 依赖、lockfile、工具链 | frozen install、相关构建与检查；在目标环境验证实际安装和运行 |
| UI 行为与布局 | 应用检查，加运行中的浏览器验证，覆盖窄屏和错误状态；现有入口为 `pnpm smoke` |
| 进程起停与基础设施 | 运行真实服务验证本文件 Lifecycle scenarios 中适用的场景 |
| 技能安装与更新 | 核对固定来源、资源、许可证和发现路径；按技能职责验证实际场景，具体来源维护在 [skills.md](./skills.md) |
| OpenSpec 配置、CLI 或生成技能 | 验证项目版本及配置范围、工件状态推进、上下文与规则注入、严格校验和更新后发现路径；结构校验不替代实现验证 |
| 部署与反向代理 | 在目标服务器和最终访问地址（域名或 IP+端口）验证健康接口、API 转发与持久目录；流式接口接入后验证代理缓冲、超时及断线行为 |
| 只推送已有提交 | 按 [Git workflow](./git-workflow.md#push-procedure) 核对提交、远端和未提交内容；提交未变且证据仍适用时复用已有验证 |

为有意义的边界与失败处理添加聚焦测试，不为纯文字编写断言，也不以重复实现细节的测试代替行为验证。检查通过后，只因新的改动、失败或未解决疑点才扩大或重复测试。

## Integrated local acceptance

`GEN-008` 在 VER-001 基础上提供两个固定范围，由 [verify.mjs](../../scripts/verify.mjs) 和 [registry.mjs](../../scripts/verification/registry.mjs) 统一编排：

```sh
pnpm verify:product
pnpm verify
```

product 总预算 20 分钟，full 总预算 40 分钟；每步另有上限，且不得超过剩余总预算。无参数 `node scripts/verify.mjs` 或 `--help` 只显示说明，非法 profile 不启动；没有任意命令、跳过必需项或自动重试开关。`ATOMS_VERIFY_RUN_ID` 可指定 1–80 位字母/数字/下划线/短横线、首位字母或数字的全新标识，未设置则生成 UUID；目录存在即拒绝复用。

使用 `.nvmrc` 的 Node 和根 package.json 的 pnpm，先 frozen install 准备当前平台缓存。必须有系统 Google Chrome、npx、Git 和可用的 SQLite N-API 绑定；每次副本独立 offline frozen install，保留工作区 allowBuilds，不使用 ignore-scripts，也不复制已有 node_modules。缺缓存/绑定返回 blocked，不自动联网修复安装或修改 lockfile。full 另需已完成 `./manager.sh bootstrap` 的固定 Process Compose；manager 首次安装回归需要 GitHub 下载网络。两种范围的真实 Sandpack/bundler 与依赖下载仍需外网，离线依赖安装不代表浏览器离线可用。

3001/5173/4173 必须空闲，真实 bind 预检能识别非 HTTP 占用者；入口不停止现有实例。固定顺序如下，full 不嵌套 product，不重复完整应用构建：

| 顺序 | product | full | 执行与证据 |
| --- | --- | --- | --- |
| 前置检查、源副本、offline install、SQLite 读写 | 必须 | 必须；先 doctor | 真实脚本/工具/浏览器/端口；新源副本与私有 DB |
| pnpm check | 必须 | 必须 | lint/types，调度控制、契约准备、两应用测试；命令退出统计，数量未知时 null |
| pnpm test:template、pnpm test:infra | 必须 | 必须 | 模板准备与原有基础设施保护，infra 保留原入口自有隔离 |
| pnpm test:manager | NOT_SELECTED | 必须 | 原入口的固定工具与独立进程 fixture，不复制或重复安装原工具 |
| pnpm build | 一次 | 一次 | 副本中完整构建并记录 SHA-256 身份 |
| node scripts/smoke.cjs | 必须 | 必须 | 消费该构建，保留诊断/独立启动/代理/窄屏断言；独立 pnpm smoke 仍自带 build |
| smoke:template / projects / generation-stream / candidate | NOT_SELECTED | 各一次、串行 | 原拥有者的真实编译、归属、恢复、取消、采用竞争及控制测试 |
| pnpm smoke:workspace | 必须 | 必须 | 可见创建→真实 SDK 工具→SQLite→真实 Sandpack 报价→采用→重开及手机路径 |
| OpenSpec --all --strict | 必须 | 必须 | 原仓库当前工件；校验身份与应用输入分别记录 |

输入来自 Git 可见的当前实际文件，含未提交实现；只选根构建配置、README、CI、两应用、共用包、模板和 scripts。排除 .env/认证、私有题目、数据、node_modules、生成资产、dist 和运行产物；拒绝越界链接。副本复制前后及运行前后比较源身份，每个浏览器 suite 前后比较构建身份；变化为 STALE_INPUT/STALE_BUILD，不能把旧副本通过算在后来代码上。OpenSpec/工程文档另记工件身份，不因任务勾选制造应用源码失效。普通模型配置/数据库/代理和继承 NODE_OPTIONS 均不进入白名单子进程环境；显式 SDK fixture 用假凭据和 loopback 传输，额外 Node fetch 守卫拒绝远端模型端点。默认入口永不运行 live 探针或目标部署。

[verify.test.mjs](../../scripts/verify.test.mjs) 纳入 pnpm check，用自有临时 Git/文件与真实控制子进程验证计划、安装/native 失败、源副本、超时/总预算、信号、detached 清理、未知身份、报告和导出边界；其证据标 control-test，不能当成应用通过。业务断言继续由各原 suite 拥有，覆盖映射以登记的 owner/coverage 为准，不复制另一套产品流程或任务清单。

每个 browser suite 用单一 [evidence.cjs](../../scripts/verification/evidence.cjs) 随实际断言形成报告。父级同时要求退出 0、本次 run/profile/source/build 身份、最少必需 case、全部断言和清理通过；缺失、空、旧、全跳过、身份或退出矛盾均失败。主输出只显示阶段、状态、原因和本次报告位置，不解析 PASS 文本作为证据。普通 check/build 不伪造用例数量。首错停止，后续为 not-run/EARLIER_FAILURE；未选择为 not-run/NOT_SELECTED，不能报告 passed。状态 passed/failed/blocked/cancelled/not-run 分开；0 通过、1 断言/协议/普通超时/清理失败、2 前置未就绪，SIGINT/TERM 为 130/143；不明超时仍 failed。

本次目录为 `test-results/gen-regression/<runId>/{source,private,export}`，summary JSON/Markdown 逐步原子发布。source、副本运行数据、原日志、清单与子报告只留本地 private/source；分享仅取 export。export 只含字段投影后的摘要、覆盖标签和明确白名单截图；截图采集时遮罩输入、对话、源码、项目标题、错误正文和整个生成预览，须有匹配的脱敏声明及字节摘要，未确认的原始 PNG 不导出。路径穿越、链接、旧身份和被替换截图拒绝；失败可导出安全摘要，仍保留非零结果。

同仓库 product/full 使用互斥锁；身份与有界清理规则见 [Lifecycle](./lifecycle.md#integrated-verification-lifecycle)。本 change 的真实 full 和另一个 runId 的 product 实测维护在 [GEN-008 tasks](../../openspec/changes/gen-008-integrated-regression/tasks.md)。历史 VER-001/GEN-001～007 记录保留，不改写成新入口的执行记录。真实模型、最终部署和 hosted CI 独立标记未运行。

## GitHub Actions

`CI-001` 提供 [ci.yml](../../.github/workflows/ci.yml)，复用现有命令。配置落盘与云端运行分别记录；本步没有提交或推送，不能据此声称 GitHub runner 已通过。

| Job | 触发与 runner | 执行内容 |
| --- | --- | --- |
| `quality` / Quality (Ubuntu) | PR、main push、workflow_dispatch；ubuntu-24.04 | frozen install → pnpm verify:product；25 分钟 job 上限 |
| `lifecycle` / Full lifecycle (macOS) | 仅 workflow_dispatch 且 full_lifecycle=true；macos-15 arm64 | bootstrap → pnpm verify（full）；45 分钟 job 上限 |

每个 job 使用独立 runner，同一 job 的端口场景串行执行。默认日常检查不下载 Process Compose，完整回归按需开启；本地测试通过不能替代首次 Linux/macOS hosted runner 结果。GitHub 官方 [runner 列表](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) 列出上述标准 runner；[Ubuntu 24.04 镜像清单](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md) 包含 Chrome，验收前置实际启动 Chrome 后再进入检查。镜像内容仍会更新，实际失败应按对应 step 诊断。

Node 读取 .nvmrc，pnpm 读取 package.json，依赖使用唯一 lockfile 执行 frozen install。只由 pnpm action 缓存 store，setup-node 自动缓存关闭；不缓存 node_modules、工具目录或运行状态。各 job 分别有 25/45 分钟超时；同事件、PR 或分支的新运行取消旧运行，手动验收与自动检查使用独立分组。

工作流使用只读 contents 权限，checkout 不保留凭据，不使用 pull_request_target、应用 secrets 或部署权限。GEN-008 通过 run_id/run_attempt/job 组成唯一合法 ATOMS_VERIFY_RUN_ID；上传路径只指向本次 test-results/gen-regression/<runId>/export/，不用历史递归 glob。完成或失败均以 always 上传白名单摘要/遮罩截图，保留七天；不设置 continue-on-error，上传成功不会掩盖验收非零。未生成文件可忽略，不上传 source/private、fixture DB、原日志、环境或认证状态。

### Fixed action sources

上游版本与输入已按下列固定提交核对，工作流内使用完整 SHA，并注释对应标签。升级时核对 action.yml、runner 要求和实际运行结果，不只修改标签文字。

| 官方 Action | 标签与固定提交 |
| --- | --- |
| actions/checkout | [v7.0.1 · 3d3c42e5aac5ba805825da76410c181273ba90b1](https://github.com/actions/checkout/tree/3d3c42e5aac5ba805825da76410c181273ba90b1) |
| actions/setup-node | [v7.1.0 · 949feb2413d6458794dcd2491c4babbbce0c15c1](https://github.com/actions/setup-node/tree/949feb2413d6458794dcd2491c4babbbce0c15c1) |
| pnpm/action-setup | [v6.1.0 · ea17c68df8912ef543352723c149a84f56e3d413](https://github.com/pnpm/action-setup/tree/ea17c68df8912ef543352723c149a84f56e3d413) |
| actions/upload-artifact | [v7.0.2 · cf430e030ddbb5b0abf93d22962f4752f3646cd9](https://github.com/actions/upload-artifact/tree/cf430e030ddbb5b0abf93d22962f4752f3646cd9) |

### First hosted run

配置发布后，检查 Actions 的 CI 工作流与 Quality (Ubuntu) 结果。需要完整验收时，在 Run workflow 中开启 full_lifecycle；[手动触发入口](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch) 需先让工作流存在于默认分支。分支保护与必需检查不由该 YAML 自动配置，取得实际成功的检查名称后再按明确任务接入。

本步本地使用固定 [actionlint 1.7.12](https://github.com/rhysd/actionlint/releases/tag/v1.7.12) 校验工作流 YAML 和表达式，并核对固定上游输入；不向项目新增 linter 依赖。历史 CI-001 的配置和本地证据保留于 [CI-001 tasks](../../openspec/changes/ci-001-github-actions/tasks.md)。GEN-008 保留四个固定 Action SHA，重新核对其 action.yml 输入并用同版 actionlint 校验新的 job/表达式；本地 full/product 的实际结果见 GEN-008，未提交/推送/触发 hosted run。

## Existing coverage

`pnpm check` 先准备共享契约，再运行 ESLint、workspace 类型检查、契约准备测试、后端测试和前端纯逻辑测试。既有 [app.test.ts](../../backend/test/app.test.ts) 与 [config.test.ts](../../backend/test/config.test.ts) 覆盖健康接口、API 404、监听配置；GEN-002 增加模型配置、协议、生命周期及 CLI 测试，见下节。

`pnpm build` 分别构建前后端；后端构建配置排除测试文件。

`pnpm smoke` 先构建，再运行 [smoke.cjs](../../scripts/smoke.cjs)，用本机 Google Chrome 验证：

- 前后端独立启动及 `/api` 代理连通。
- 桌面截图、320/375/768px 下无横向溢出及窄屏截图。
- 不符合契约的响应提示、后端离线提示及按钮恢复可点击。
- 生产后端与前端本地 preview 连通，以及浏览器未捕获运行错误。

脚本需要 3001、5173、4173 端口空闲，产物写入忽略目录 `test-results/smoke/`。它不覆盖模型生成、持久化、流式取消、manager 或线上部署。

交互式浏览器验收复用仓库内官方 Playwright Skill，通过 `pnpm playwright` 使用独立具名会话。调用、Chrome 前提与固定版本见 [Browser verification](./skills.md#browser-verification)；先读快照再引用元素，覆盖相关状态、窄屏与错误路径，记录实际观察，不能只凭截图命令成功就声称布局正确。交互产物写入忽略的 `output/playwright/`，不替代上述固定 smoke 回归。

## Template baseline

`GEN-001` 的企业官网基线入口为 `/templates/company-landing`，连接检查迁至 `/diagnostics/connection`，不需要后端或模型配置。它是固定开源模板预览，不是模型成果；来源、许可和改动见 [模板说明](../../templates/company-landing/ADAPTATIONS.md)。

```sh
pnpm test:template
pnpm smoke
pnpm smoke:template
```

`test:template` 使用 Node 测试器和隔离目录，覆盖重复准备内容一致、预编译样式/内嵌图片、来源/许可/入口缺失、非法路径/符号链接、未声明或无法解析的导入、数量/UTF-8 字节限制、依赖漂移、digest 篡改及失败时保留上一完整输出。源码准备命令为 `pnpm prepare:template`，前端 dev/build 自动执行；删除生成 JSON 后正常构建会重新准备。

`smoke:template` 不自行 build；先完成 `pnpm build` 或带构建的 `pnpm smoke`，确保公开资源与 dist 的标识一致。需要系统 Chrome、5173/4173 空闲和外部 Sandpack/包下载网络。它串行启动自己的 dev/preview，从新浏览器上下文直接访问/刷新基线并检查：

- 开发与构建产物的 1280/320/375px 交互、宿主/iframe 实测宽度和溢出；导航、FAQ、主题与宿主隔离、手机菜单、键盘与焦点恢复。
- 实际 SDK 对应实例的编译完成/失败，不用 iframe load 或定时器报告成功；不依赖远程头像，页面没有未连接的订阅表单。
- 延迟实际 SDK runtime 模块、在初始化期间快速重试；新预览正常运行，旧实例没有遗留 message 监听器。
- 资源 404、非法 JSON、结构/路径错误、内容标识正确但有实际语法错误，以及新上下文中阻断 bundler 后的截止时间错误；移除每个故障后主动重试恢复。
- 成功场景无宿主/frame 未捕获异常，预期故障单独归类；端口冲突非零且不停止占用者，退出/信号只清理本次所属进程和浏览器。

同一命令随后运行 template-smoke-control.test.mjs：真实 HTTP 占用者保持可用，SIGINT/SIGTERM 在浏览器和前端启动后中断，分别检查 130/143 退出码、最终取消报告、十秒内清理和端口释放。Chrome 的默认信号退出交由 runner 接管，避免提前终止而漏写报告。

产物在忽略的 `test-results/template-baseline/<runId>/`，包含本次 digest、用例结果、清理状态、截图及私有诊断；交互复核使用独立 `gen-001` Playwright 会话，截图在 output/playwright/。外部 SDK 的非关键统计请求失败不代表模板交互通过或失败，真实编译和控件断言仍分别检查。

GEN-008 已将模板准备纳入两种范围、模板浏览器专项纳入 full；product 明确不选择该专项。manager 的隔离副本补充模板源/准备脚本并排除旧生成资产，以验证独立 dev 命令不依赖原工作目录缓存。实际结果和未验证范围见 [GEN-001 任务记录](../../openspec/changes/gen-001-company-template-baseline/tasks.md)，模板通过不能替代模型、持久化、完整 Top 1 或公网部署验收。

## Model access

GEN-002 的 [模型模块](../../backend/src/model/client.ts) 只由显式调用使用，后端启动/健康接口不初始化它。运行 `pnpm check` 会执行 backend/test 中的配置、协议和 CLI 自动化，无需 API 凭据；不读取开发者真实 `.env`。HTTP fixture 使用假密钥与本地随机端口，通过真实 SDK 发起 Responses 请求；传输注入仅为模块测试参数，没有生产假模型环境开关、任意上游地址选项或公共模型接口。

覆盖范围：

- 配置缺失、空值、非法模型标识、时限和输出预算；既有健康接口保持可用。
- 固定官方端点（不受 OPENAI_BASE_URL 影响）、禁止重定向重放、`/v1/responses`、显式模型、`store: false`、输出预算、JSON schema 与工具结果回传，all 最多四次实际请求；schema 不合法、路径/数量/UTF-8 体积、拒绝、截断和缺失最终文本均失败。
- 唯一内存工具的一次分派与随机 nonce 确认；缺少/未知/重复调用、非法参数、未确认或额外调用均失败，不自动修复。
- 401、403/404、429、上游故障、网络故障的安全分类和零重试；错误体/响应头包含哨兵秘密时，报告与捕获日志不回显。
- 真实 HTTP 延迟连接的超时/取消与底层连接结束，两次工具请求共用时限，晚到响应不继续步骤；操作结束移除监听器并关闭调用作用域，不能再次请求。输出格式失败可继续其他独立能力，账户/网络/时限故障停止后续样例。
- 子进程使用隔离工作目录及测试环境，不继承开发者凭据；帮助不读环境、不请求网络；源码与临时编译产物可运行；缺配置非零、报告脱敏/保存、SIGINT/SIGTERM 输出取消结果并在有限时间退出。临时编译产物放在 backend/node_modules 下以使用真实运行依赖，结束后删除。

真实验收单独执行：配置 backend/.env 的 API 项目凭据和显式模型，完成构建后运行 `pnpm model:probe:built --case all --report`。该命令最多四次计费请求，缺配置零次；只在三项必需能力都 passed 时退出零。报告 source=live 仅证明实际发起请求，是否通过仍看各项状态；前置失败为 not-run，模块传输替身为 fixture。用量缺失为 null，不估算账单。报告只包含标识、状态、时间、请求次数、用量和安全摘要，保存在忽略的 test-results/model-probe/。

本地替身通过不能替代 OpenAI 账户和模型权限实测。默认 check/smoke/verify、CI、manager 均不执行上述真实探针；现有 smoke 继续验证既有前后端连通，模板专项见上节。实际命令结果、未完成真实验收及供 GEN-004 复用的边界见 [GEN-002 tasks](../../openspec/changes/gen-002-model-access-validation/tasks.md)。这些能力不构成项目生成、持久化、预览编译或完整 Top 1 已完成。

## Project persistence

GEN-003 使用已有 Node 测试器和真实临时 SQLite 文件，覆盖迁移幂等/回滚/高版本拒绝、项目原子保存、不可变快照、同项目外键、消息分页、run 状态、候选保存不采用及关闭重开。HTTP injection 通过两个匿名会话覆盖完整调用顺序、Origin/JSON/strict 校验、cookie 到期、归属 401/404、稳定分页、模板冲突、事务配额、不可伪造 IP 的限流及 Retry-After、413/415/503/500 和敏感哨兵不泄露。启动子进程使用隔离工作目录与配置，不读取开发者 .env，覆盖只读文件、高 schema、缺资产、端口冲突和正常释放/再启动。

模板准备测试新增后端 src/dist 的独立目标、内容标识一致、资源/中立校验代码齐备以及失败保留旧输出且不残留暂存。manager 隔离副本排除生成资产、环境、数据与 node_modules，从 frozen offline install 重新安装，再实际打开/写入/查询原生 SQLite 绑定；v13 自带 N-API 预构建，保留现有 ignore-scripts 场景不代表跳过绑定验证。首次 bootstrap 的网络、缓存及固定工具前提仍适用。

```sh
pnpm check
pnpm test:template
pnpm test:manager
pnpm smoke
pnpm smoke:template
pnpm smoke:projects
```

端口场景串行执行；smoke 已含 build，另外两项浏览器专项使用该构建，不重复构建。连接 smoke 的后端源码/生产进程改用隔离 cwd 和临时 DATABASE_PATH，正常关闭后才删除临时数据；不接触开发者数据库。项目专项复用 playwright-core 与系统 Chrome，不增加测试框架或产品测试页：

- 在独立前端副本的诊断页，用浏览器 fetch('/api/...') 分别走 dev/preview 代理，检查公开目录不创建 cookie、HttpOnly/Strict/Path cookie、模板创建、空对话及刷新恢复。
- 独立上下文 A/B 的列表、详情及对话隔离；其他归属与不存在项目为相同 404 错误结构。
- 后端部署布局含自己的 dist、package、共用契约包及当前平台依赖，不含前端或原模板源；停止后通过内部入口写入明确的测试消息/run/候选，保留原 cookie 与数据库后重启，比较完整快照摘要、项目 ID、消息序号和当前版本不变。临时移走目录 JSON 时，已保存项目仍能由 store 读回；正式 server 仍要求加载可用目录后监听。
- 测试进程、浏览器和临时数据库均归本次所有，信号中止不启动后续场景；端口冲突不停止占用者。报告在忽略的 test-results/project-persistence/<runId>/，运行目录在清理后删除。

同一 smoke:projects 命令随后运行 project-smoke-control.test.mjs，以真实外部 HTTP 占用者和活动浏览器分别验证端口保护、SIGINT=130、SIGTERM=143、十秒内退出、最终取消报告、临时目录删除和端口释放。只清理本次 runner 所属进程，不接管其他测试或用户服务。

这些验证证明持久化和 HTTP/浏览器传输，不证明真实模型生成、候选编译/采用、完整工作台或线上部署。GEN-008 full 已纳入项目专项，product 保持 NOT_SELECTED。实际完成与证据见 [GEN-003 tasks](../../openspec/changes/gen-003-project-persistence-api/tasks.md)。

## Version history

REV-001 的 `backend/test/version-history.test.ts` 使用现有 Node 测试器、真实临时 SQLite 和 Fastify injection，随 `pnpm check` 执行，不需要模型凭据。聚焦运行可在根目录准备后端资产后执行 `pnpm --filter @atoms/backend exec tsx --test test/version-history.test.ts`；干净副本先运行后端 typecheck/test 的准备入口。

覆盖严格分页参数、超过 50 个同毫秒版本、第二连接追加及较旧 current、祖先/兄弟分支、自身父快照的增删改、240 码点 Unicode 摘录与消息来源、null/fallback、列表与 GEN-006 单版本读取一致、1 MiB 完整响应上限、页外损坏隔离、归属与 no-store、60/min/IP 限流及 Retry-After、损坏/矛盾关联、关闭重开与闭库安全 503。用 SQL 全表读取前后比较和注入的模型传输计数验证无产品写入、零模型调用；不把内部 fixture 指针切换当作真实恢复 API 验收。

迁移测试将隔离库还原为 v2 后实际打开升级至 v3、重复打开，逐项比较数据；捕获实际关联 SQL 的 EXPLAIN，确认使用 `run_version_result` 与 `message_run_role_order`，无临时排序。最大页、大快照及超过 64 条修改路径的样本验证响应完整或明确超限失败，不依靠默认模板补齐历史。

本变更相关整体检查为 `pnpm check` → `pnpm smoke`（已含 build）→ `pnpm smoke:projects`，占端口套件串行。历史页面、restore 与恢复后新生成尚待 REV-002～004 实际接通，不能由现有 fixture 或结构校验代替；实际命令、退出结果和剩余任务见 [REV-001 tasks](../../openspec/changes/rev-001-version-history/tasks.md)。

## Version restoration

REV-002 的 `backend/test/version-restoration.test.ts` 与 `version-restoration-network.test.ts` 随 `pnpm check` 执行，使用现有 Node 测试器、临时真实 SQLite、Fastify injection 与随机端口真实 HTTP。正常恢复测试的模型请求计数为零；与生成竞争的测试使用实际 SDK 和 loopback 受控上游，明确为 fixture，不读取真实 `.env` 或调用外部模型。

覆盖模板/祖先/未采用分支、strict 请求与全部错误状态、会话到期与跨归属 404、10/min/IP、显式检查依赖、全部 running 与取消收尾 Map、CAS/幂等先后顺序、单调更新时间、事务回滚、目标/父快照/同项目及跨项目结果关联损坏。SQL 全表前后比较证明实际恢复只改项目引用/更新时间，旧快照、消息与运行完整保留；模型传输计数和源码哨兵证明不调用或执行代码。

真实网络测试还覆盖 adopt/restore 竞争、SSE accepted 后恢复 busy、恢复先提交后旧基线生成拒绝、所有权撤销、请求已进入后触发真实 app.preClose 的写入拒绝、提交后销毁响应连接、查询不可用、POST 请求体延迟最后一个字节时先读旧值、目标切走后旧 CAS 拒绝，以及关闭所属监听应用/数据库并再次 listen 后保留原 cookie/current/完整快照。仅清理本次资源，不占固定开发端口，不以 injection 冒充这些网络证据。

本变更整体检查按 `pnpm check` → `pnpm build` → `pnpm smoke:projects` → `pnpm smoke:generation-stream` 串行执行，后两项消费该构建。实际命令/退出结果、源码身份和剩余边界见 [REV-002 tasks](../../openspec/changes/rev-002-version-restoration/tasks.md)。本任务不验证恢复 UI、恢复后模型上下文、真实模型业务质量或线上部署，也不修改其他 REV 的完成状态。

## Bounded generation

GEN-004 使用现有 Node 测试器覆盖实际 SDK 与真实临时 SQLite 链路。普通 check 使用显式 fixture 传输与假配置，不读取开发者 .env、调用外部模型或触碰生产 DATABASE_PATH。测试范围：

- 真实 GEN-001 bundle 的允许路径、保护文件、重复/绕过路径、未读覆盖、无变化、普通 CSS、96 KiB 读取/256 KiB 提交/最终 64 文件与 2 MiB；保留未改内容且旧快照不变。
- Zod strict 工具通过实际 Responses HTTP 请求执行 list/read/submit，检查 parallel=false、strict=true、完整读取正文及 SDK 支持的加密推理续接项进入后续请求。未知、多调用、重复 ID、额外字段、普通说明、拒绝和截断均失败，不修复或再试。
- 最多六次请求、累计上下文上限、实际延迟连接取消/超时、晚到结果不保存/不追加事件、提交事务内截止时间检查回滚；提交后取消及观察者异常不改写成功。
- 会话/归属/配置/基线预检，运行中与完成的请求重放、需求/基线复用冲突、跨连接相同请求不二次调用；模型等待期间另一真实连接可以写入，证明没有长写事务。
- 受理和候选/摘要事务故障回滚、基线变化、终态写入也失败时明确未确认；关闭重开一致、currentVersionId 不变。活动/错误/日志不含提示词、正文、思维链、原始供应商体或凭据。
- 源码/临时构建 CLI 子进程：帮助/非法参数零网络、缺配置 not-run 非零、fixture 来源、隔离数据库（保护生产路径哨兵）、保存/重开及 SIGINT=130/SIGTERM=143 实际连接终止、SQLite 关闭与有限退出。

```sh
pnpm check
pnpm smoke
pnpm smoke:projects
pnpm generation:smoke --help
pnpm generation:smoke:built --help
```

smoke 已含 build，项目恢复及端口用例串行运行。GEN-004 不改变应用启动/安装、模板准备或预览 UI；这些源码未变时复用 GEN-003 的 frozen/manager/模板专项证据，不为了新增内部方法重复全量生命周期验证。新增生成路径不接入默认 smoke/verify/CI 的真实调用。

真实验收只显式运行一次构建后的 `pnpm --filter @atoms/backend generation:smoke:built --live --case quote`。当前冻结版本使用固定官方端点；下述历史兼容服务验收还依赖独立待提交的 GEN-002 端点配置改动。运行器使用后端模型配置、一个公开固定需求和全新隔离项目，最多六次请求，报告实际服务、请求/用量、读取/提交活动、完整候选保存及数据库重开；不自动执行 filter、修复或重新计费。报告与关闭的本地测试数据库在忽略的 test-results/generation-smoke/<id>/，数据库不上传。预检失败为 not-run，本地注入为 fixture，有供应商请求才为 live；用量缺失与重放未知为 null。

本次真实 quote 已保存候选并确认旧当前版本不变，仍为 unverified；未执行候选编译、报价交互、第二需求或线上部署，不把工具参数合法或 SQLite 保存当作完整 Top 1。实际命令、退出结果、模型请求和证据见 [GEN-004 tasks](../../openspec/changes/gen-004-bounded-agent-generation/tasks.md)。

## Generation stream

GEN-005 在默认 pnpm check 中使用真实临时 SQLite、随机端口 Fastify、SDK HTTP 上游和进程测试，source=fixture，不读取 backend/.env 或访问外部模型。覆盖三个接口的严格输入/归属/Origin/Accept、重放冲突、独立 IP 限流、1/1/2 准入及日配额重开；accepted 在 gate 未释放时已经可读，单调关联活动和一次 terminal 依据实际存储。

取消/原连接 fetch abort/原始 socket 销毁会中止上游；关闭重复连接不接管原任务；提交后丢末帧仍可查询成功。终态写入失败为 unknown，无执行者 running 返回安全 503。传输测试覆盖 8 KiB 帧、总量、队列、可缩小等待阈值、真实慢读网络、独立连接正常工作与定时器清理。GEN-004 原测试继续检查事务内提交竞争和旧 CLI。

子进程使用构建应用与测试专用 scripts/generation-stream-server.mjs，只注入本地模型传输和假配置，没有生产假模型开关。验证同库不同端口竞争、realpath 别名、独立数据库、恢复失败释放、实际 SIGTERM 与活动 SSE、实际 SIGKILL 后等待库的 30 秒 stale、所有权丢失及存储关闭异常。重启保留消息、当前版本和既有候选，不自动重发请求；晚到的非协作输出不能访问关闭的存储。

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test:manager
pnpm smoke
pnpm smoke:generation-stream
pnpm smoke:projects
```

串行执行；smoke 已含 build，两个专项消费该产物。浏览器专项需要现有 playwright-core、本机 Chrome、npx 和空闲 3001/5173/4173；从现有首页用相对 /api，dev 和 preview 各验证 gate 前首帧、真实候选终态、取消、浏览器 abort 经代理传播、按 requestId 查询和所属后端重启，核对 currentVersionId/digest 不变。捕获真实帧逐字节重解码，并以明确的 UTF-8 注释夹具覆盖中文/emoji 跨块；不向生产事件添加虚假活动。只清理所属进程/数据；异常与 SIGINT/SIGTERM 同样执行有界清理，外部端口占用者保持运行。

报告在忽略的 test-results/generation-stream/<id>/report.json，只记录 fixture 场景、计数和状态，不保存 cookie、正文或数据库。测试启动器只供本地自动化，不列为生产命令。默认 check/CI 不消耗真实额度；本轮不把 fixture 传输通过当作真实模型、候选预览、完整 Top 1 或最终线上反代通过。实施结果见 [GEN-005 tasks](../../openspec/changes/gen-005-generation-stream-control/tasks.md)。

## Deployment framework

`DEP-002` 的 `./deploy.sh bootstrap` 显式准备固定 Ansible/Python 依赖；`./deploy.sh validate` 用真实 Ansible 做语法检查和离线模板渲染。`./deploy.sh test` 使用标准库 unittest：帮助/apply 无工具副本与含空格路径、离线重复 bootstrap、私有文件/字面密码/权限/重复 YAML 键/非法字段保护、真实 Ansible 官方传密与 SSH 失败脱敏、受控本地模块的前提通过/端口冲突/运行/未知状态、重复模板渲染、SIGINT/SIGTERM/超时下独立会话子进程清理与无关进程保护。

DEP-003 将同一入口扩展为离线 plan 文本/JSON、原生分阶段流程及显式依赖门禁；增加同包无操作/代码切换/配置独立更新/健康恢复决策、直接 playbook 空声明仍失败、原生 rescue/always 保留失败状态，以及配置暂存重复无变化、既有秘密 env 保留/过期暂存清理/符号链接拒绝测试。实际 Ansible 模块在隔离目录运行，未给产品增加测试开关，也不解析假 release.json 作为生产契约。

这些测试只用隔离配置、命令/SSH 替身和本地 builtin 模块，不读取真实 inventory、连接真实服务器或调用模型；不将 fixture 结果当成服务器通过。plan/check/status 与接入说明见 [Deployment](./deployment.md)，缺依赖的 apply 仍明确失败。本次框架证据在忽略的 test-results/dep-003/framework/；真实 Nginx/systemd、公网 TLS/流、更新/回退和数据保留仍待后续接点及 DEP-004 目标验收，DEP-001 连接问题保持独立记录。默认 check/verify/CI 不自动安装 Python 工具或执行部署检查。

DEP-004 的[验收矩阵](../../openspec/changes/dep-004-deployment-acceptance/design.md)和[实际状态](../../openspec/changes/dep-004-deployment-acceptance/acceptance-report.md)分别维护场景断言与证据。框架可先完成，GEN-009 发布包及真实 apply 接点仍待实现，目标部署场景未运行；入口拒绝、模板渲染、纯决策与 fixture 成功不得替代幂等部署、更新、失败恢复或数据保留验收。

## Candidate review

GEN-006 使用现有 Node 测试器，根 test/check 串联契约准备测试、后端测试和前端固定 tsx 测试；前端无 DOM 测试框架。[prepare-contracts.test.mjs](../../scripts/prepare-contracts.test.mjs) 在独立副本 offline frozen install 后验证无 dist 的独立后端/前端构建、并发准备/typecheck、缓存复用、缺失输出、源码变化及准备失败阻止 dev；不复制真实环境、数据库或 node_modules。manager 副本也复制共用包源/准备脚本并实际启动独立应用，doctor 检查新增 workspace。

后端 [candidate-review.test.ts](../../backend/test/candidate-review.test.ts) 的真实 SQLite/injection 覆盖有归属完整版本、模板/候选、跨项目同形 404、错误输入、成功关联、同父竞争 CAS、目标幂等、活动/孤立 running、故障回滚和重开。前端纯逻辑覆盖键/旧事件/错误锁定/超时/重载、采用确认/未知/冲突，以及 HTTP body/UTF-8/JSON/schema/摘要/关联/超限/取消和截止；这些不能代替实际编译。

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test:manager
pnpm smoke
pnpm smoke:template
pnpm smoke:candidate
pnpm smoke:projects
pnpm smoke:generation-stream
```

聚焦诊断可运行 `pnpm test:contracts`、`pnpm --filter @atoms/backend test` 和 `pnpm --filter @atoms/frontend test`；两应用入口自动准备契约，后端还准备模板资产。使用项目 Node/pnpm、本机 Chrome/npx、固定工具和缓存；端口 3001/5173/4173 空闲，所有端口场景串行。smoke 已含 build，后续专项消费同源产物。模板与候选正向预览需可访问外部 Sandpack/bundler 和依赖下载，外部服务失败时正向场景保持失败，不能伪造 done 或静态截图代替。

[candidate-smoke.cjs](../../scripts/candidate-smoke.cjs) 在真实 API/SQLite 与完整构建副本上预置明确 fixture succeeded/候选，不增加生产假模型开关。dev/preview 分别操作新增报价控件、原导航/FAQ、主题及隔离检查，比较计算数值、主操作和完整快照/引用；覆盖真实语法/运行错误、坏响应/离线/摘要、受阻 bundler 与重试、A/B 和双标签竞争、提交后丢响应、未知查询/同载荷手动重试、其他新选择、活动/未确认生成和写故障。延迟刷新期间断言采用禁用且零写入，释放后再验证重复激活只提交一次。采用后重启/刷新重读持久引用并重新编译，随后运行错误不自动回退。

桌面与 320/375px 检查宿主/frame 真实宽度、长路径、按钮高度、键盘焦点及临时输入重置；检查实际 iframe sandbox/allow/referrerPolicy、其他窗口消息不能采用、父页面读取被跨源拒绝。外部 bundler 只收到代码/依赖，不传平台凭据或对话。报告及必要截图在忽略的 test-results/candidate-review/<id>/，source=fixture；不上传数据库、cookie 或完整代码，只清理所属服务与数据。本地明确测试代码的编译/采用不等于 GEN-010 真实模型或业务验收，也不构成 GEN-009 最终反代/部署通过。

GEN-008 已将候选专项串联到 `pnpm verify`（full），product 保持 NOT_SELECTED。保留的混合工作区结果见 [GEN-006 tasks](../../openspec/changes/gen-006-candidate-preview-adoption/tasks.md#implementation-evidence)，独立任务分支的实际验证另记在 [隔离验证记录](../../openspec/changes/gen-006-candidate-preview-adoption/tasks.md#isolated-review-evidence)，合并后的实际检查与剩余边界见 [Integration evidence](../../openspec/changes/gen-006-candidate-preview-adoption/tasks.md#integration-evidence)，不以历史混合工作区通过代替。

## Project workspace

GEN-007 增加 `backend/test/workspace-messages.test.ts` 的真实 SQLite 最新/更早页和原增量协议兼容测试，以及 `frontend/test/workspace-*.test.ts` 的 JSON、SSE 和应用控制器测试。覆盖 single-flight、401/404/503、安全错误、UTF-8/CRLF 跨块、同块多帧、心跳/截断/顺序/关联/双终态/超限、有界 reader/计时器、JSON 分支、StrictMode 订阅重放、取消与成功竞争、丢末帧查询、原 ID 恢复、隐藏/限次查询、存储过期/不可用、会话和项目隔离。纯测试不替代浏览器和实际 SDK 链路。

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm smoke
pnpm smoke:workspace
pnpm smoke:candidate
pnpm smoke:projects
pnpm smoke:generation-stream
pnpm smoke:template
```

端口专项串行，smoke 含 build，后续消费同源构建；需要 Chrome、空闲 3001/5173/4173 和外部 Sandpack/依赖下载网络。`workspace-smoke.cjs` 以可见输入/点击创建并生成，真实 SDK 经受控 loopback 上游返回 list_files/read_files/submit_files，真实编排和 SQLite 保存，再操作真实 Sandpack 报价、明确采用、刷新及所属后端重启。主路径不用 page.evaluate 代替表单或注入 compiled；evaluate 仅用于读取事实、布局/滚动、API 比对及故障断言。

dev/preview 分别覆盖示例不提交、创建去重/丢响应/离页晚到、未配置模型、受理活动、消息无双气泡、报价计算、原请求丢终帧恢复、取消/离页断流、采用丢响应查询、基线身份、源码不执行且与 API 一致、上游限流/拒绝及真实编译失败、A/B/过期会话、延迟会话确认前快捷键零创建且就绪后正常提交、新标签/前进后退/未知路径、跨项目草稿、73 条历史的最新/更早顺序与阅读锚点，以及 1280/1024/768/375/320px 的宿主宽度、局部源码滚动和键盘焦点。历史消息仅在所属后端停止时向本次测试数据库预置，与主路径实际生成区分；候选竞争/CAS/未知采用和预览隔离继续执行 GEN-006 专项。

每次使用独立前端/构建后端副本和数据目录，测试 launcher 只注入假配置与本地 SDK 传输；不读取真实环境或调用计费模型。生成次数来自真实 HTTP 计数，报告 `source=fixture`、`realModelCalls=0`，位于忽略的 `test-results/workspace/<runId>/report.json`；清理仅作用于所属进程/浏览器/数据。端口预检拒绝时保留外部占用者。GEN-008 的 product/full 都已串联工作台专项；CI 配置复用相应入口，hosted 执行另行确认。实际结果维护在 [GEN-007 tasks](../../openspec/changes/gen-007-project-workspace/tasks.md)；本地 fixture 成功不替代 GEN-010 真实模型或 GEN-009 最终部署验收。

## Lifecycle scenarios

`OPS-001` 的原生配置验收使用真实进程，检查双服务与单服务启动、HTTP readiness、健康响应及前端 API 代理、所属进程故障恢复、就绪持续失败、外部端口冲突和停止后的进程清理。核对状态时同时检查是否运行、就绪、退出码与重试次数，不把 `process list` 命令成功当作项目健康；注意 [原生状态及就绪限制](./lifecycle.md#behavior-and-limits)，退出码可能属于前一轮进程。原生记录见 [OPS-001](../../openspec/changes/ops-001-process-compose/tasks.md)。

`pnpm test:manager` 执行 [manager.test.mjs](../../scripts/manager.test.mjs)，在含空格和深路径的隔离副本中使用真实前后端及固定工具，验证重复/并发调用、重启、原生故障恢复后的状态、外部端口保护、就绪超时、中断回滚、调用者硬杀后的锁恢复、supervisor 退出、陈旧 PID、跨副本隔离、未知 socket 和强制停止。它需要 3001/5173 空闲、项目 Node/pnpm、固定 Process Compose 和本机 pnpm 依赖缓存；隔离副本以 offline frozen install 安装，不复制环境文件。产物在忽略的 `test-results/manager/`，需等待 stale 锁和停止截止时间；不会在工作副本自动安装缺失工具，首次安装场景仅操作隔离副本。`pnpm check` 包含 lint、类型、调度/契约准备和两应用单元测试，生命周期变更额外执行本命令；完整验收已由上述 `pnpm verify` 串联。

该回归还包含 OPS-003：无 node_modules/工具的副本使用真实官方网络下载安装，验证重复 bootstrap、环境文件及 lockfile 保护；受控下载替身验证校验失败和中断清理。doctor 覆盖缺失/错误版本、配置、端口和健康实例，不输出环境值；logs 覆盖服务/行数限制、在线读取、跟随取消及停止后读取。首次安装场景需要 GitHub 网络；其他副本安装复用 pnpm 缓存。测试不访问开发者的真实环境文件，fixture 内只创建测试值。

`INF-001` 的 `pnpm test:infra` 执行 [infra.test.mjs](../../scripts/infra.test.mjs)：无 node_modules/Process Compose 的带空格深路径副本从其他工作目录调用 shell 入口，限制 PATH 并监测意外工具调用，覆盖文本/JSON、重复和并发空操作、环境/持久数据/状态文件保护、非法参数，以及未接入 Compose 配置的拒绝。文件快照核对无额外运行产物或修改，证据在忽略的 `test-results/infra/`。`pnpm test:manager` 另在真实健康实例上执行三个 infra 动作，核对实例记录与服务 PID 保持一致、健康检查继续通过。当前仅验证空配置接口，不代表容器、数据卷或真实基础设施已验证；任务记录见 [INF-001](../../openspec/changes/inf-001-infrastructure-interface/tasks.md)。

以下仍是后续扩展对应能力时的验收要求，具体已验证范围以上述记录为准；不能将其当作尚未实现的基础设施或流式能力的证据：

- 重复启动不会增加实例，停止后可以再次停止，重启后恢复到一组健康实例。
- 部分进程退出可恢复或明确报错；端口冲突、依赖缺失和就绪超时返回失败，且不影响其他程序。
- 起停顺序符合实际依赖；停止后无遗留子进程，保留持久数据。
- 接入真实基础设施后验证就绪、停止和数据保留；空配置覆盖见上述 INF-001 记录。
- 流式取消、超时、断线和重连行为需要运行中的服务与真实网络，不能只依赖 Fastify injection。

起停状态和幂等语义见 [Lifecycle](./lifecycle.md)。接入数据库时验证重启后数据仍在、访问隔离与失败回滚；接入模型与预览时验证真实调用、编译及交互，不能用示例结果代替。外部 bundler、依赖下载和网络失败在本地及最终部署域名下分别验证。

## Evidence and handoff

记录任务编号、对应提交或实际差异、执行命令、退出结果，以及有代表性的输入与观察结果。证据必须对应被交付的代码；后续改动影响结果时重跑相关检查。

脚本运行成功不等于产品所有能力完成。交接时区分已实现、已验证、未验证和不可用部分，明确缺少凭据、工具或目标环境造成的限制。

本地日志、截图和临时报告保存在忽略目录，不进入提交；源码与需要分发的技能资源按各自职责入库。CI、线上部署及自动技能触发只有实际执行并取得结果后才能报告通过。

## Local deployment acceptance

GEN-009 本次最终验收按用户明确授权使用独立快照，仅不含并行 REV 任务尚未配套实现的 `backend/test/version-restoration.test.ts` 和 `backend/test/version-restoration-network.test.ts`；其余当前应用与 GEN-009 实现保留。快照内公共 check/product/release/deployment 入口不修改，原工作区文件和默认检查规则保留。建立快照时原工作区受这两份未完成测试阻塞，本次结果只对应记录的冻结授权基线；后续完整工作区须待 REV 配套实现后正常执行 check。

GEN-009 的独立入口为 `pnpm test:release`、`pnpm release:build [--json]`、`NGINX_BIN=/absolute/nginx pnpm smoke:deployment --release /absolute/package`。release 控制测试随 check 执行，不要求 Nginx；额外真实故障控制入口为 `ATOMS_DEPLOYMENT_TEST_RELEASE=/absolute/package NGINX_BIN=/absolute/nginx pnpm test:deployment-control`，验证缺 Nginx、外部端口、并发锁、实际 SIGINT/SIGTERM 及损坏包拒绝，结果为 control-test，需独占 3001/8080；真实部署验收要求 Nginx/Chrome、3001/8080 空闲、同平台发布包和 Sandpack 网络，不接入默认 verify 或 CI。按 README 顺序先 frozen install/check/verify:product，再 build release、独立消费产物。

release 控制用例覆盖固定 CLI、已有输出保护、输入排除/越界 symlink/变更、完整清单/模式/缺资产/ABI/篡改、Nginx 路径注入、报告身份与脱敏、互斥/外部端口及所属进程超时/取消；控制 fixture 标为 control-test，不作为真实应用证据。实际发布运行是 offline frozen install → 原生 SQLite → 一次 build → 固定 pnpm deploy --prod --frozen-lockfile → 产物外移加载契约/SQLite → 输入复核/删除源副本/原子发布，构建日志位于 .runtime/release-build/<releaseId>/。

部署报告关联 releaseId/releaseDigest/sourceDigest/buildDigest、Nginx 版本/配置摘要、精确 origin 和每个阶段来源。阶段 A 使用未修改 server.js，无模型配置，验收模板实际编译、项目创建与深链接、Origin/归属/模型未受理、相同 cookie 停启重开；阶段 B 私有启动器注入真实 SDK 的本地 HTTP fixture，复用工作台可见表单/报价/采用断言，真实工具编排/候选入库与 Sandpack 交互，经 Nginx 实测 gate 前 accepted、至少一次真实 10s 心跳、完成/取消/断流、SIGTERM 与 SIGKILL stale 后 interrupted/无重发；阶段 C 回到生产入口读取采用结果，演练冷备份 quick_check、隔离恢复、坏配置/只读目录/高 schema/同库第二实例失败及原数据重开。

所有服务由本次 runner 管理，未创建 Vite/tsx；只有 frontend 静态根可以公开，JS/CSS MIME 与缓存、缺资源/API/私有文件、后端离线均有实际断言。产物搬迁前后重新比较清单；原包保持只读。总预算 10 分钟，正常就绪 30s、真实预览最多 70s、清理最多 10s，硬杀单独等待 32s stale。缺前提、断言、取消或清理失败均非零；不能通过跳过必需场景报告成功。

`test-results/deployment/<runId>/{releases,shared,private,export}` 保留本次证据，分享只取 export 的白名单 JSON/Markdown 摘要；不导出截图、源码/需求/对话、cookie/DB、原日志/配置或密钥。live 模型、公网 HTTPS、hosted CI 永远单独标 not-run。本次平台/耗时/实际命令与 GEN-010 交接身份在 [GEN-009 tasks](../../openspec/changes/gen-009-local-release-validation/tasks.md)，本地成功不代表服务器发布或跨版本数据库迁移通过。
