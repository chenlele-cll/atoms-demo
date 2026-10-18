# Tasks

范围与边界见 [proposal.md](./proposal.md)，实现方案见 [design.md](./design.md)，验收行为见 [project-persistence](./specs/project-persistence/spec.md)。已按用户“实施 GEN-003”完成代码与实际验证，检查结果见文末；规划校验不作为运行证据。实施复用 GEN-001 的真实模板基线，不依赖模型密钥。

## 1. 运行时契约与文件数据库

- [x] 1.1 GEN-003 在后端加入固定 Zod 依赖，定义项目、模板、快照、消息、run、分页及安全错误的权威 schema 与推导类型；实现新增路由局部校验/序列化适配。验证：后端测试覆盖额外字段拒绝、非法路径/入口/依赖、体积、分页和输出内部字段排除，类型检查通过；在 Development 中记录契约归属和未来客户端提取边界。
- [x] 1.2 GEN-003 加入固定 better-sqlite3 与类型、必要 pnpm 构建许可、实际迁移和五张表的存储基础；配置外键、WAL、busy_timeout、参数绑定及版本拒绝。验证：frozen install 后在当前平台真实打开/读写 SQLite，临时文件测试覆盖迁移幂等、迁移失败回滚、更高版本拒绝、同项目关联约束及关闭重开；更新 Monorepo 的依赖和原生安装要求。

## 2. 模板交接与项目存储行为

- [x] 2.1 GEN-003 扩展 GEN-001 的模板准备目标，生成后端 src/dist 各自的模板部署副本，并实现服务端目录加载、摘要及快照校验。验证：准备测试断言前后端产物内容标识一致、目标独立、非法或缺失资产失败且不留下不完整输出；GEN-001 准备测试继续通过；同步 README 的独立构建和资产前提。
- [x] 2.2 GEN-003 实现从可信模板原子创建项目、初始 v0、当前引用、按归属分页和详情查询；完整快照落盘且不依赖模板重建。验证：真实文件测试覆盖新项目空消息/无 run、创建中途故障整体回滚、模板更新后旧内容不变、稳定分页和跨会话不可见，并在重开后逐文件比较；更新 Development 的保存与事务规则。
- [x] 2.3 GEN-003 实现内部追加有序消息、创建/结束生成记录和保存不可变候选的具体存储操作，不增加公开写接口或版本采用。验证：显式测试夹具覆盖消息分批、run 状态与时间、重复 requestId 拒绝、跨项目关联拒绝、候选不改变当前版本，以及相关写入失败回滚；关闭重开后内容一致；在 Development 记录这些操作与后续编排的分界。

## 3. 会话与公开项目接口

- [x] 3.1 GEN-003 加入固定 cookie 插件，实现持久化匿名会话、摘要存储、到期校验、APP_ORIGINS 配置和 POST 来源校验。验证：injection 覆盖 201 新建/200 复用、cookie 属性、失效后不能认领旧项目、缺失/伪造 Origin、非法公网 HTTP 配置；同步 `.env.example` 与 README，说明匿名会话期限及无法找回的限制。
- [x] 3.2 GEN-003 接入目录、项目创建、列表、详情与对话路由，使用 schema、显式 DTO 和归属查询，不新增前端客户端。验证：两个独立会话的 injection 测试走通完整调用顺序，断言模板冲突、非法字段、401/404、分页与消息顺序、当前快照和 latestRun，以及公开 GET 不设置会话；健康测试继续通过；README 记录实际请求/响应和调用顺序。
- [x] 3.3 GEN-003 加入固定限流插件、请求体/项目配额、统一错误映射、私有响应 no-store 和结构化安全日志。验证：受控配额/限流测试覆盖 409、带 Retry-After 的 429、413/415、存储失败 503、损坏快照 500，且失败不留数据；伪造转发头不能绕限，日志和错误响应不含敏感哨兵或底层 SQL；同步 Development 的错误和资源边界。

## 4. 启动、部署资产与既有隔离回归

- [x] 4.1 GEN-003 将真实 catalog/store 初始化接入 server，验证 DATABASE_PATH，监听前迁移并加载资产；正常关闭及初始化/监听失败均释放连接，不影响无磁盘副作用的 buildApp 测试。验证：运行真实后端检查非法路径、不可写文件、更高 schema、缺资产、端口冲突和正常退出，确认失败无监听、数据保留且可重新启动；更新 README、后端环境模板、忽略规则和 Lifecycle。
- [x] 4.2 GEN-003 调整 manager 测试隔离副本的必要模板/准备脚本复制、目标平台原生安装与显式绑定检查，保持不复制用户环境、数据库或 node_modules。验证：从无生成资产的隔离副本完成安装、准备和真实起停，执行 `pnpm test:manager` 并确认原有故障/归属/清理场景保持通过；更新 Verification 的缓存、原生工具和安装前提。

## 5. 浏览器与重启自动化入口

- [x] 5.1 GEN-003 新增 `scripts/project-smoke.cjs` 及 `pnpm smoke:projects`，复用现有 playwright-core/Chrome，不增加产品测试页或新测试框架。验证：自动断言 dev/preview 相对 API、HttpOnly cookie、两个浏览器会话隔离、构建后端重启恢复、显式消息/run/候选夹具读回，以及无前端源的后端资产加载；仅清理所属进程和临时数据，证据写入忽略目录；同步 README 与 Verification 的命令、前提和验证边界。

## 6. 集成验收

- [x] 6.1 GEN-003 串行完成 frozen install、`pnpm check`、GEN-001 的准备与模板回归、`pnpm test:manager`、`pnpm smoke`（含 build）、新增 `pnpm smoke:projects`，最后执行 `pnpm openspec validate gen-003-project-persistence-api --strict --no-interactive` 和 `git diff --check`；复用本次源码未变时已取得的检查结果，记录命令、退出码、实际差异和关键恢复/隔离观察。验证：所有适用检查有真实证据，声明范围仅为模板项目持久化与 HTTP/浏览器传输，不把测试夹具记成模型生成，也不把本地构建验证记成线上部署或完整工作台验收。

## Implementation evidence

2026-10-18 按用户“实施 GEN-003”执行，未提交、推送、归档或部署至线上。后续用户追加模型兼容服务配置与真实测试，单独在 GEN-002 记录，不将该探针与本任务的显式存储夹具混为真实项目生成。

实际实现：

- [公开契约](../../../backend/src/contracts/projects.ts) 使用 Zod 推导类型并接入路由局部 validator/serializer。strict 输入、正常化虚拟路径、入口/许可/运行配置、精确依赖、64 文件/2 MiB、分页/序号及 DTO 排除内部字段均有运行时校验。复用中立模板规则，不维护手写第二套 JSON Schema，不增加共享 workspace 包或前端项目客户端。
- [存储](../../../backend/src/storage/store.ts) 与 [迁移](../../../backend/src/storage/migrations.ts) 使用真实 better-sqlite3 文件，五张表、foreign_keys、WAL、5000ms busy_timeout、user_version 写锁迁移及高版本拒绝；参数绑定和短同步事务。创建项目、消息/run/候选的关联写入要么全部提交，要么全部回滚；候选不可变且不采用。
- [会话与 API](../../../backend/src/routes/projects.ts) 提供目录、初始化/复用、项目创建/分页/详情/对话；随机 cookie 只存摘要，30 天到期，HttpOnly/Strict/Path=/api、HTTPS Secure。精确 Origin、JSON、请求体、事务配额、限流/Retry-After 和 trustProxy=false 生效，私有响应 no-store。错误及结构化日志不含 SQL、密钥/会话 token、绑定值、代码、查询正文或绝对路径。
- [模板准备](../../../scripts/prepare-company-template.mjs) 的三个目标相互独立，后端 src/dist 带自身完整 JSON 及自动复制的中立纯校验模块/类型，后端不读取 frontend/public。历史快照按自身身份校验，读取不依赖当前模板；新项目核对可信目录，候选身份/依赖核对其基础版本。
- 正式 server 在监听前验证配置、加载目录、打开/迁移数据库，关闭及初始化/监听失败都释放连接；裸 buildApp injection 不隐式打开数据库。目录资产、数据库路径、来源配置及部署限制已同步 README、指南、Development、Lifecycle、Monorepo、Verification。
- 固定 better-sqlite3 13.0.3、类型 9.6.0、cookie 11.1.3、rate-limit 11.2.1，复用 Zod 4.6.7；SQLite v13 自带 N-API 预构建且没有安装脚本，因此不新增构建脚本许可。当前平台及 manager 新安装副本均实际读写原生绑定，不复制 node_modules、用户环境、数据或旧生成资产。

实际检查与观察：

| 命令/边界 | 结果 |
| --- | --- |
| pnpm install --frozen-lockfile | 退出 0；项目 Node 22.22.2 / pnpm 12.11.2，唯一 lockfile 一致 |
| pnpm check | 退出 0；lint、两端严格类型与 85 项后端 Node 测试通过，零失败/跳过 |
| SQLite 与迁移测试 | 真实临时文件，迁移幂等、DDL 失败回滚、高版本保留、创建中途故障整体回滚、各记录恢复、稳定分页、跨项目约束和不可变候选通过 |
| HTTP injection | 两会话完整调用顺序、空消息/无 run、当前快照、latestRun、Origin/JSON/strict 字段、cookie 到期、401/404、409/429/413/415/503/500 及哨兵脱敏通过 |
| 启动子进程 | 隔离 cwd/环境；空/内存配置、非法来源、只读文件、高 schema、目录文件和缺目录 JSON 均在监听前失败；端口占用者保留；正常退出 0 并可重新启动 |
| pnpm test:template | 退出 0；29 项通过，含独立后端目标、内容一致、资产齐备与失败保留旧输出/无暂存残留 |
| pnpm test:manager | 退出 0；13 项（含主测试）通过，约 126.7s；隔离 frozen 安装后的原生绑定、从无生成资产起停，以及既有故障/归属/清理场景均通过 |
| pnpm smoke | 退出 0，已含前后端 build；源码后端与实际 dist、代理、320/375/768/1280px、离线/错误恢复和浏览器无未捕获异常通过。后端使用临时 cwd/数据，不读取开发者后端 .env |
| pnpm smoke:template | 退出 0；13 个实际浏览器场景全部通过，包含 60 秒真实超时、语法错误、恢复、窄屏与键盘。另有 3 个端口/信号控制场景，Node 计数 4，全部通过 |
| pnpm smoke:projects | 退出 0；dev/preview 共 6 个浏览器场景全部通过。每种模式校验 HttpOnly cookie、跨会话隔离、刷新、构建后端停止后保存明确消息/run/候选夹具、重启后完整快照和顺序恢复；当前版本仍为 v0。另有外部端口保护、SIGINT=130、SIGTERM=143 控制场景，Node 计数 4，清理均通过 |
| 部署布局 | 项目专项中的后端布局没有前端或原模板源，加载自己的 dist 资产；暂移目录 JSON 后 store 仍读回完整已存快照。正式 server 启动依然要求可用目录，未借此改变启动契约 |
| 严格校验、相对链接及 git diff --check | 通过，最终状态以 CLI apply 复核为准 |

集成证据：`test-results/gen-003/b9acdb83-42fe-4730-9baa-7a5bd55f5a37/report.json` 及该目录日志，记录实际代码 SHA-256 和命令退出码。专项证据：

- manager：`test-results/manager/18963732-7e77-4170-a399-186a7e869ded/report.json`。
- 模板：`test-results/template-baseline/082c71d8-c4b0-4f95-96ea-cd14468e19d0/report.json`。
- 项目：`test-results/project-persistence/8765014b-d934-419a-bc83-620892c44458/report.json`，status/cleanup 均 passed；控制用例另生成明确失败/取消报告。

四个部署副本的模板 digest 一致，仍为 `44e5ae3cc6ad1faf92e9000108279abe533b903dc7ea9b04124466690c2133e6`。生成目录、临时数据库、报告和秘密均被忽略；本轮所属浏览器/进程/临时运行目录已清理。模板初次预检遇到另一个隔离运行占用端口，未停止占用者，等待释放后完整复测通过。依赖工具入口曾指向外部已删除临时副本，使用 frozen force install 重建生成入口后最终检查通过，没有修改源码掩盖工具故障。

保留 GEN-001/002 的既有实现与其他未实施 change；只增加本任务必需的模板目标、manager fixture 安装/绑定检查及连接 smoke 数据隔离。没有公开消息/run/候选写接口、版本采用、真实项目生成或工作台 UI。模型兼容服务四次真实请求的单独验收不代表这条完整 Top 1 已完成，也不代表官方 OpenAI 账号权限或线上部署。
