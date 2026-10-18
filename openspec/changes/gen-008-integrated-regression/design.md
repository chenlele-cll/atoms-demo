# Design

## Context

动机和范围见 [proposal.md](./proposal.md)。当前 pnpm verify 通过 shell 串联 doctor、check、infra、manager、smoke 和 OpenSpec；smoke 自带 build，几个测试分别写入自己的忽略目录。CI 默认复用 check/infra/smoke，完整 manager 验收只在手动 macOS job。GEN-001～007 的产品检查均尚待实施，不能把规划中的命令当成现有可运行入口。

已有 Node 测试器、Fastify injection、playwright-core/Chrome、隔离 manager fixture 和固定 proper-lockfile。本任务消费先前产品规格，整合测试工程，不改变产品 HTTP、生成、预览、采用或权限规则，因此声明 skip_specs，不创建人为产品能力。

## Goals / Non-Goals

**Goals:**

- 将产品主路径与模块专项回归纳入可复现的入口，明确输入/构建身份、先后顺序与证据范围。
- 在干净数据和受控模型传输下检查真实 SDK、数据库、浏览器与预览，不让环境或旧产物制造假通过。
- 让失败、中断、未运行与清理结果可定位，并让 CI 复用同一检查计划。

**Non-Goals:**

- 不重新建立测试框架、云数据库、队列、容器或另一份产品/任务清单。
- 不在默认回归中执行 model:probe、generation:smoke --live、真实模型或目标服务器部署；分别由 GEN-010、GEN-009 验收。
- 不把控制器替身测试、截图、OpenSpec 结构通过或配置已落盘当成应用/hosted runner 已通过。

## Decisions

### 1 同一固定计划提供 product 与 full 两种范围

新增 scripts/verify.mjs 和具体套件登记，根命令 `pnpm verify:product` 选择 product，既有 `pnpm verify` 选择 full；没有任意命令执行、跳过必需项或自动重试参数。无参数/帮助说明范围，错误 profile 拒绝执行。各模块原有 check/smoke 入口仍可独立运行。

| 顺序 | product | full | 执行位置与目的 |
| --- | --- | --- | --- |
| 前置检查 | 必须 | 必须；另执行 doctor | 原工作区只读检查固定工具、脚本、Chrome、端口；full 需要已 bootstrap 的 Process Compose |
| 源副本与 frozen install | 必须 | 必须 | 本次隔离目录，安装自己的依赖并验证 SQLite 原生绑定 |
| pnpm check | 必须 | 必须 | 副本；包含前后端、SDK/存储/流状态和新增调度控制测试 |
| pnpm test:template | 必须 | 必须 | 副本；GEN-001 准备流程与文件边界 |
| pnpm test:infra | 必须 | 必须 | 原入口自身隔离，保持当前 CI 覆盖 |
| pnpm test:manager | 不选择 | 必须 | 原入口自身隔离，保持原工具和真实起停验收 |
| pnpm build | 一次 | 一次 | 副本；完整应用生产构建，记录构建摘要 |
| node scripts/smoke.cjs | 必须 | 必须 | 副本；复用已构建产物，保留诊断/独立启动/代理回归 |
| smoke:template / smoke:projects / smoke:generation-stream / smoke:candidate | 不选择 | 各一次、串行 | 副本；拥有各自边界与故障断言的专项入口 |
| pnpm smoke:workspace | 必须 | 必须 | 副本；真实 UI 创建→工具→候选→交互→采用→重开 |
| OpenSpec 严格校验 | 必须 | 必须 | 原仓库当前工件，记录与应用输入不同的校验身份 |

full 是一次展开计划，不能嵌套调用 verify:product 而重复 check/build。统一入口在 build 后直接执行现有 smoke.cjs，避免再调用自带 build 的 pnpm smoke；各产品专项原约定要求预先 build，保持这一语义。共享契约的必要准备不等于再次完整构建前后端。

product 明确只覆盖主路径和普通工程/接口测试，不把未选择的专项/manager 写成通过；full 才完成登记的专项集合。必需脚本或报告接入缺失是前置失败，不降级为仅原健康 smoke。

### 2 一次隔离源副本保护真实环境与测试输入

每次创建 `test-results/gen-regression/<runId>/`，内含 source、private 和 export 子目录。复制当前实际文件内容，包含未提交的本次实现，但仅从 Git 可见文件中选择根构建配置、公开 README、.github/workflows 及 frontend/backend/packages/templates/scripts 的必要输入；不调用 checkout/reset/stash，不修改原分支或源文件。控制测试使用自有临时输入/Git fixture，不要求隔离副本本身含原仓库 .git。

显式排除 .git、node_modules、dist、生成模板资产、data、.runtime、.tools、test-results、实际 .env/认证文件和私有题目材料；公开 .env.example 可以复制。禁止通过 symlink 逃出允许输入，拒绝路径越界。OpenSpec 校验留在原仓库，不为产品 fixture 复制个人宿主设置或私有资料。

副本执行 offline frozen install，使用已声明的原生构建许可并实际打开/读写自己的 SQLite 文件；缺缓存/绑定明确报前提失败，不改为 ignore-scripts 或复用工作目录 node_modules。首次依赖/原生构建前提在 README 说明，不能以“离线包安装”保证所有外部网络均不需要。

普通 JSON/浏览器检查和 baseline 的 documented dev/start 命令都在无真实 .env 的副本中运行，数据库仅能位于自己的数据目录。infra/manager 保持现有成熟的自有 fixture 机制，不在副本重复下载/复制 Process Compose；full 的 doctor/工具入口仍从原工作区读取受验证工具元信息。

子进程环境使用必要运行变量白名单，保留正常 PATH/HOME/TMPDIR 等系统含义，不改用测试 HOME；不继承 OPENAI_API_KEY、MODEL_*、DATABASE_PATH 或生产代理目标。测试模型构造仅注入假密钥和 loopback 受控传输，生产入口没有假模型开关。额外检查受控上游调用和未知外部模型请求，默认不能触发真实模型；浏览器实际 bundler/依赖下载仍需要网络。

输入清单与内容摘要对应实际运行的代码/锁文件/构建和测试配置。副本复制后核对输入，构建后记录产物摘要，在各浏览器套件前确认未被故障用例改坏；故障只作用于套件自己的子副本或请求边界。运行前后比较原工作区相关源码，发生变化标为 STALE_INPUT，不能将旧副本结果当成新代码通过。工件/文档状态与运行源码分别记录，避免勾选任务造成虚假的代码失效或混淆。

### 3 只补齐跨路径缺口，断言继续由原套件拥有

固定登记包含 owner、入口、必需条件、报告类型与覆盖标签，不维护第二份任务复选框。普通 Node 测试继续由 pnpm check 承载；专项浏览器用例留在已有各 smoke，不把其断言全部复制进统一脚本。

| 能力/风险 | 主要拥有者与证据 |
| --- | --- |
| 模板来源、准备、真实预览 | GEN-001 准备测试与模板 smoke；workspace 主路径实际使用该基线 |
| 模型协议、工具及硬上限 | GEN-002/004 的 SDK 受控 HTTP/状态测试，check 纳入；不运行 live 探针 |
| 创建、归属、回滚、文件重开 | GEN-003 数据库/API 测试及项目 smoke |
| 首帧、断线、取消、配额、恢复 | GEN-005 网络/进程测试和事件流 smoke，不只依赖 injection |
| 真实编译、采用竞争、未知确认 | GEN-006 状态/数据库测试及候选 smoke |
| 可见表单、正确基线、只读源码 | GEN-007 workspace smoke，经实际 SDK 工具、SQLite 和预览，而非预种项目代替创建 |
| 重复运行与隔离 | 本次执行两次独立 runId 的主路径检查，无旧 DB/cookie/产物冒充新运行；正常/故障用例各自清理 |
| 旧工程保护 | 诊断 smoke、infra、full 的 manager；保留原断言及所属进程规则 |

补缺优先扩展对应拥有者，例如主路径缺少采用后重开或异常恢复连接时扩展 workspace smoke，不在编排层实现另一个业务流程。正向用例必须真实编译并操作新增报价等控件；故障测试可以控制上游/网络/存储，但预期失败被正确处理才算该测试通过，不能把底层故障误报为产品成功。

GEN-008 补的是测试实现与证据连接，若发现需要改变产品行为，先明确缺陷与 owning GEN 任务并修订对应实现范围，不在“让测试绿”名义下改变生成/采用语义。

### 4 子套件结构化报告阻止空跑和陈旧证据

为浏览器套件增加统一最小报告辅助，随各断言实际完成记录结果；不解析 console 中 PASS 文本作为事实。报告包含 schemaVersion、suite/runId、profile、sourceDigest/buildDigest、source=fixture 或 not-run、case ID/断言结果、安全 observationCode 和相对证据路径。源码/报告辅助只有一份权威校验，不为此安装另一套 schema 库。

浏览器 suite exit 0 还必须有本次报告、非空必需 case、身份匹配且所有要求断言通过。缺报告、全跳过、退出码与报告矛盾、旧 runId、错误构建摘要或越界证据路径均失败。check/build/原生工具等成熟命令按实际退出结果记录，无法取得用例数量时记 null，不伪造统计。

统一 summary.json/summary.md 逐步写入，执行状态为 passed/failed/blocked/cancelled/not-run；不选择项 reason=NOT_SELECTED，前序失败导致未执行为 EARLIER_FAILURE。缺工具/脚本/明确网络依赖是 blocked，断言/非法报告/普通超时是 failed；原因不明确的超时不能被粉饰成纯环境问题。blocked 和 cancelled 都非整体通过。

每项报告 source 表示模型替身来源，不代表浏览器/数据库是假运行。编排器控制测试另标 evidenceKind=control-test，应用回归标 application-regression；测试调度器用的假 child 输出不能成为产品通过证据。模型真实调用、最终部署和 hosted CI 另列 not-run/独立记录。

最终整体通过只在所选全部必需步骤、断言、源码一致性与清理均成功时成立。原子替换报告，不让写到一半的 JSON 被读取为成功；进程硬杀留下的 running/incomplete 报告不能转为通过。没有自动重跑、接受旧结果或隐藏 quarantine。

### 5 端口、信号和时间预算纳入结果

复用已有 proper-lockfile 对原仓库的 verify 运行互斥，product/full 竞争立即返回忙，不在同一端口并跑。用真实 bind 检查 3001/5173/4173，而非只靠 HTTP 探针；检查后的监听竞争仍由实际启动失败处理，不能按端口杀进程或接管未知实例。

每步显式预算和总预算，product 初始 20 分钟、full 初始 40 分钟；单步以剩余总预算为上限，等待/启动/预览自身截止时间不取消。实施后用真实耗时核对是否足够，预算调整有记录，不为了 CI 变短去缩减或跳过必需断言。网络失败不自动重试为绿。

首次失败停止新步骤，在 finally 做有限清理；SIGINT/SIGTERM 不再启动下一项。各 suite 的启动器共享必要的归属/关闭辅助，登记本次 child、监听进程和浏览器关闭职责，先给正常中止机会，再仅对身份仍匹配的所属进程有限升级。父脚本不能只终止 pnpm 而遗留 detached 服务；单纯向旧 PID 发信号不算清理成功。

正常清理预算 10 秒，期限或身份不确定则记录 CLEANUP_INCOMPLETE 并非零退出，不继续下一个占端口检查。保留诊断所需私有输出，只删除本次确认拥有的临时内容；未知文件/进程保留。硬杀/断电不保证 finally 执行，下次入口检查占用并拒绝接管，不以自动删锁/杀端口掩盖残留。

建议退出语义：0 全部所选验收通过，1 断言/报告/清理失败，2 环境或前置未就绪，130/143 明确中断；控制测试验证真实退出行为。主输出只给阶段、分类及本次报告位置，详细输出在忽略的 private 目录，不上传原始日志。

### 6 CI 复用入口，导出只有白名单证据

保留当前 Quality (Ubuntu) 和手动 Full lifecycle (macOS) 的 job 名称、runner、事件、只读权限及固定 Action SHA。默认 job frozen install 后调用 verify:product，替换重复的 check/infra/build/OpenSpec step；手动 job bootstrap 后调用 verify。没有新 secrets、外部部署权限或自动发布。

初始 job 超时分别 25/45 分钟，给 20/40 分钟 runner 及导出留余量；实施按实际耗时记录调整，不能报告未来 hosted runner 已验证。配置遵循官方 [job 时间限制](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idtimeout-minutes)。

CI 提供合法且唯一的 ATOMS_VERIFY_RUN_ID，由 run_id/run_attempt/job 组合；本地默认 UUID。入口严格校验标识并拒绝复用已存在目录，不能覆盖旧结果。上传只指向这个 runId 的 export 目录，不用递归 glob 把历史/control-test fixture 也传上去。

export 仅含校验后的摘要、覆盖标签和明确选定的测试截图，相对路径解析必须位于本次允许目录；不传 private、source、.env、cookie/storageState、SQLite、认证状态、提示词/代码正文或原始堆栈。导出截图在采集时遮罩输入/对话/代码等正文，故障预览中可能回显正文的区域也遮罩；未确认脱敏的截图只留本地，不能直接复制全部 PNG。失败时能生成的摘要照常导出，始终保留真实非零结果；保留既有七天 artifact 策略。参考官方 [artifact 使用说明](https://docs.github.com/en/actions/tutorials/store-and-share-data)，不增加 PR/邮件通知或持久证据服务。

### 7 控制测试与实际验收分别证明不同事实

新增 scripts/verify.test.mjs 及必要具体辅助测试，沿用 Node 测试器纳入 check；CLI 固定真实计划，测试替身仅在模块级显式注入，不开放生产环境替换命令/跳过用例开关。

控制矩阵包括：profile 选择/完整入口不重复 build、缺脚本/Chrome/原生绑定、端口占用与同库 verify 并发、源码复制排除/越界 symlink、frozen 安装失败、子进程非零、缺/空/旧/矛盾报告、未知模型外联、预期失败 case、source/build 变化、时间预算、SIGINT/TERM 与清理失败、artifact 路径越界及哨兵脱敏。只在临时 fixture 故障注入，不改真实文件。

实际验收先执行一次 full，再以另一个 runId 执行 product，验证两个公开入口及不同源副本、数据库/cookie 的独立性；每次完整构建一次，不在单次计划中嵌套重跑。调试时源码未变的已有共用检查可复用为对应代码的证据，但不能把复用写成未实际发出的命令已经执行，也不能以旧报告替代第二个隔离运行。每次记录真正的入口、源摘要、平台和未运行范围。

CI 先做 YAML/固定输入校验及本地等价检查；发布和实际 GitHub run 只有后续明确授权并真的发生才报告通过。本 change 不要求为测试配置完成而自动 push、触发远端或归档上游 GEN 任务。

## Risks / Trade-offs

- 隔离源副本增加安装时间 → 单次副本复用、offline frozen 与明确缓存/native 前提，不复制 node_modules 冒充冷启动。
- 外部 bundler 网络不稳定 → 明确阻塞/失败且非零，不以假 ready、截图或隐式重试替代正向编译。
- 跨套件公共辅助演变为大测试框架 → 仅抽真实重复的源副本、报告和进程职责，业务断言留原拥有者。
- 工作区在运行中继续修改 → 源与构建摘要核对，证据绑定实际输入，不声称检查了后来的代码。
- 子进程或父脚本被硬杀 → 保留 incomplete 状态，下一运行不接管未知占用者；正常信号路径有实际控制测试。
- 主路径配置被误认为全部专项/真实模型通过 → 报告列出 NOT_SELECTED 与 not-run 的边界，full、live、部署和 hosted run 分开记录。

## Migration Plan

1. GEN-001～007 实际实现后逐项核对脚本与断言，建立固定登记及所选范围；缺入口先明确前置任务，不在此补一个空通过命令。
2. 实现源副本、冻结安装、输入/构建身份及最小报告辅助，并在各自阶段落地控制测试和说明。
3. 接入串行执行、有限清理、结构化子报告与跨路径缺口；既有独立 smoke 命令仍保持用途，默认不调用真实模型。
4. 更新根 verify/verify:product、CI 和 README/Verification；Lifecycle 仅维护实际进程与清理规则，原 VER-001/CI-001 历史证据不改写为本次结果。
5. 跑控制/配置检查、一次真实 full 和独立重复主路径，记录当前已执行/阻塞/未执行；只对后续改变影响的范围重跑，严格校验本 change。
6. 回退仅撤回编排、报告/CI 适配并恢复原验证入口，不删除项目数据或测试历史，也不将上游 GEN 标为完成。服务器与真实模型验收分别留 GEN-009/010。
