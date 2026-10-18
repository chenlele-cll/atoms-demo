# Tasks

目标与边界见 [proposal.md](./proposal.md)，技术方案见 [design.md](./design.md)，行为验收见 [bounded-generation](./specs/bounded-generation/spec.md)。已按用户“实施 GEN-004”完成内核、自动化与一次真实报价样例，具体证据见文末。复用 GEN-001～003 的实际实现，不以规划校验替代运行证据。公开生成接口、事件流和项目级并发在 GEN-005，预览与采用在 GEN-006。

## 1. 生成契约、上下文与文件策略

- [x] 1.1 GEN-004 定义生成输入/结果和三个工具的权威 Zod schema，建立当前快照与同项目历史的上下文构造，限制需求、历史条数/体积和累计上下文。验证：后端测试覆盖额外字段、空或超限需求、历史有序选择、当前需求不重复、不能混入其他项目或配置秘密、上下文超限且不截断文件；更新 Development 的生成契约与上下文归属。
- [x] 1.2 GEN-004 实现 company-landing 的具体修改策略和全量文件合并，保留固定入口/依赖/来源，按实际内容计算修改列表与摘要。验证：使用 GEN-001 真实 bundle 测试受保护文件、路径绕过、重复路径、未读覆盖、无变化、普通 CSS、单次提交及最终快照上限，确认未改文件逐字保留、旧快照不变；同步 Development 的允许范围和候选未验证边界。

## 2. 模型工具往返与有界执行

- [x] 2.1 GEN-004 接入 GEN-002 的单步工具请求，实现 list_files/read_files/submit_files，并保持 strict、串行工具、真实结果续接及无重试。验证：本地随机端口 Responses 服务穿过实际 SDK，断言读取的独特内容和必要续接项进入后续请求，工具参数与调用 ID 校验有效，未知工具/多调用/额外参数不执行；既有 GEN-002 协议测试继续通过，在 Development 记录工具权限边界。
- [x] 2.2 GEN-004 完成最多 6 次请求的显式循环、共享截止时间与 AbortSignal，拒绝无调用、拒绝、截断、非法工具及未提交结束。验证：延迟本地服务观察底层请求中止；测试步骤/上下文预算、取消后晚到结果、提交前截止时间和停止后的零额外请求，确认无自动修复、预算扩张或模型切换；同步 Development 的失败/取消规则。

## 3. 项目受理、幂等与候选保存

- [x] 3.1 GEN-004 通过现有存储实现归属/会话/基线预检，以及 requestId 唯一的 running 记录和 user 消息原子受理；重复请求查询在新增基线校验之前，模型调用在事务之外。验证：真实临时 SQLite 测试未授权/过期/缺配置零模型请求、重复与并发相同请求只调用一次、不同需求/基线复用标识冲突、重复调用不追加消息；更新 Development 的受理与重试规则。
- [x] 3.2 GEN-004 原子保存完整候选、服务端事实摘要与成功 run；失败保留用户输入和当前版本，取消/超时写安全终态，终态无法落盘时如实返回未确认。验证：数据库测试覆盖候选或摘要写入失败整体回滚、运行中基线变化、终态更新失败、成功提交后取消、关闭重开和相同请求重放；完整文件/关联一致且 currentVersionId 不变，既有 GEN-003 项目测试通过；同步 Development 的事务与候选状态含义。

## 4. 事实活动与本地验收入口

- [x] 4.1 GEN-004 提供只含必要元数据的内部活动观察与安全结果，保存后才发出 saved；汇总实际请求/用量，缺失及重放未知指标为 null，不公开思维链或工具正文。验证：观察序列与真实动作一致、观察回调异常不改变已提交结果，含提示词/代码/凭据哨兵的日志和错误不泄露，失败结果不冒充保存或预览通过；同步 Development 的日志与活动边界。
- [x] 4.2 GEN-004 新增源码与构建 generation:smoke 入口、根转发和隔离项目运行器；仅 --live 加指定公开 case 才能调用真实模型，不使用生产 DATABASE_PATH 或现有项目。验证：子进程测试帮助零请求、缺配置 not-run 非零退出、参数拒绝、构建入口加载、测试专用注入下的信号中止/保存重开与资源释放，确认 fixture 不标为 live；更新 README、Verification 的计划命令为实际用法、报告目录和验收限制。

## 5. 集成验收

- [x] 5.1 GEN-004 运行 `pnpm check`、`pnpm smoke`（含 build）及 GEN-003 实施后的项目恢复回归；若实际改动影响启动/安装，再补对应 frozen install、manager 或模板检查，源码未变且已有有效证据时不重复执行。验证：记录命令、退出码、实际差异与代表性工具/保存观察，确认默认测试与 CI 不访问真实模型；执行 `pnpm openspec validate gen-004-bounded-agent-generation --strict --no-interactive`、链接检查和 `git diff --check`。
- [x] 5.2 GEN-004 在 API 配置可用且 GEN-002 工具能力验证通过后，显式运行构建入口 `pnpm --filter @atoms/backend generation:smoke:built --live --case quote`，只执行一例并复用同一次真实调用证据。验证：报告实际模型、请求次数/已知用量、读取与提交活动、独立候选保存和文件重开一致、旧当前版本不变；凭据缺失或未通过则本项保持未完成，不以 fixture 替代。未运行的浏览器编译、报价交互、第二需求和线上部署仍标为未验证，交给 GEN-006/009/010。

## Implementation evidence

2026-10-18 按用户“实施 GEN-004”实施，复用实际 GEN-001～003 与用户已授权配置的兼容服务。本轮没有提交、推送、归档或线上部署，也没有新增公开生成/SSE/取消接口和前端 UI。

- [生成契约](../../../backend/src/generation/contracts.ts)、[上下文](../../../backend/src/generation/context.ts) 与 [文件策略](../../../backend/src/generation/policy.ts)：strict 请求/工具；当前需求一次、同项目整条历史有界选择；冻结文件目录/读取、已读覆盖、仅一次提交，全量合并并服务端重算摘要/实际变更。固定入口/来源/依赖、保护资产、普通 CSS、各层字节/数量限制及旧快照保留均验证。
- [显式编排](../../../backend/src/generation/service.ts) 复用 GEN-002 单步客户端，strict=true、并行关闭、最多六请求、零重试、共享截止时间和 AbortSignal。真实 SDK response.messages 连同必要推理续接项进入下一步，工具正文只留内存，不作为对话或活动公开。非法批次/调用 ID/参数、拒绝、截断、无提交及预算耗尽立即失败。
- [存储接入](../../../backend/src/storage/store.ts)：有效会话/归属检查、请求查重在新基线/配置检查之前；受理原子保存 running 和 user。完成事务重新检查当前基线和终止条件，原子保存候选/事实摘要/成功 run，不改变当前版本。失败保留输入；终态更新失败返回明确未确认，不以缓存成功替代。扩展安全 errorCode 枚举，无破坏性数据库迁移。
- 同一请求跨连接并发与完成重放不再调用模型，输入/基线不同时冲突；模型等待中另一真实 SQLite 连接可写，证明不持有网络长事务。保存后取消及观察者异常不反向改写成功，取消/超时后晚到内容不再执行工具、保存或追加事件。
- 模型客户端增加事实请求观察与分项用量；任一步未知则合计 null，保留已知分项；重放指标为 null。活动含安全元数据，saved 仅在提交后发出，源码/结果/日志不回显原始模型错误、提示词、代码、工具正文或凭据。
- 新增源码与构建 generation:smoke 入口及根转发。帮助不加载 .env 或请求模型；只有显式 --live --case quote|filter 才执行一项公开样例，始终创建自己的随机项目/SQLite 文件，忽略生产 DATABASE_PATH。不启用生产假模型环境开关或临时公开诊断 API。

实际检查：

| 执行项 | 退出与观察 |
| --- | --- |
| pnpm check | 退出 0；lint、两端类型检查及 125 项后端 Node 测试全部通过，零失败/跳过；包含既有 GEN-002/003 回归 |
| 文件策略和 SDK/SQLite 集成 | 真实 bundle、strict/串行协议、独特基线正文与加密续接、同项目历史、边界/无变化/非法工具、步骤/上下文耗尽、原子受理/保存故障、基线改变、终态未确认、重放、真实请求中止与晚到丢弃通过 |
| CLI 子进程 | 源码/临时构建帮助与参数拒绝零网络，缺配置 not-run 非零；fixture 保存重开、生产路径哨兵保持、SIGINT=130 / SIGTERM=143、真实连接中止及 SQLite 关闭通过 |
| pnpm smoke | 退出 0，已包含前后端 build；既有 dev/proxy、320/375/768/1280px、错误/离线恢复及生产后端 + preview 通过，无浏览器未捕获异常 |
| pnpm smoke:projects | 退出 0；dev/preview 共六个浏览器会话隔离/完整文件/重启恢复场景通过；另有三个端口/信号控制场景（Node 计数 4），全部通过 |
| pnpm generation:smoke --help | 退出 0；根源码转发和公共资产准备正常，没有模型请求 |
| 构建 generation:smoke:built --help | 退出 0；构建入口与运行依赖正常，没有模型请求 |
| 选定 change 严格校验、相对链接、git diff --check | 通过；结构校验没有替代上述运行证据 |

没有新增依赖、安装许可或启动逻辑；server/app、模板准备、manager 及其安装行为未在 GEN-004 修改。本轮复用 GEN-003 已通过的 frozen/原生绑定/manager/模板专项记录，未无故重复这些耗时验证。保留其他 change 和用户已有待提交内容。

## Live quote acceptance

显式执行一次 `pnpm --filter @atoms/backend generation:smoke:built --live --case quote`，退出 0；没有追加 filter、重跑或自动修复。服务为用户指定的 https://ai.elegantyc.com/v1，provider=openai-compatible，model=gpt-6.1-sol；此结果不推断官方 OpenAI Platform 权限或账单。

| 事实 | 实际结果 |
| --- | --- |
| 来源/整体状态 | live / passed，42660ms |
| 模型请求 | 3 次；list_files → read_files → submit_files，每次一个工具，终端提交后不再确认调用 |
| 读取/提交 | 读取结果 JSON 7947 UTF-8 字节，实际提交完整文件正文 5683 字节 |
| 实际修改 | /src/App.tsx、/src/generated/QuoteEstimator.css、/src/generated/QuoteEstimator.tsx |
| 候选 | 独立保存、数据库关闭重开一致，currentVersionId 仍为原模板基线，saved/reopened/unchangedCurrent 均 true |
| 用量 | 服务返回 input 19122、output 2055、total 21177；分项保留在报告，不折算费用 |
| 候选 digest | 6d1795f74a9e005250cdb6ed13accb9cab497f8bca06d772bce22a892cf09c3c |
| 预览状态 | unverified；未运行浏览器编译、报价输入/勾选交互、第二需求或线上部署 |

真实报告：`test-results/generation-smoke/ff14930a-3983-4d4e-9501-13e04e59d908/report.json`，同目录 project.sqlite 为关闭后的本地隔离测试数据，不上传。报告和候选数据库检查未包含后端实际密钥。

集成证据：`test-results/gen-004/5c95b987-2689-4985-9915-397d93be1baa/report.json` 及同目录 check/smoke/projects/live 日志，含实际源码 SHA-256。项目恢复报告：`test-results/project-persistence/d6cef616-82c1-4d43-9bb3-5a4429786766/report.json`，status/cleanup 均 passed；所属测试 HTTP 服务、浏览器、子进程和临时 CLI 构建目录已清理。独立 live 数据库按设计保留用于后续本地复核，未访问或修改生产项目。

后续 GEN-005 接入公开运行/事件/取消/项目级并发与硬杀恢复，GEN-006 接入候选预览/采用，GEN-009/010 验证最终部署与真实交互；本轮不能描述为完整 Top 1 已通过。
