# Tasks

范围见 [proposal.md](./proposal.md)，方案见 [design.md](./design.md)，验收见 [generation-execution](./specs/generation-execution/spec.md)。实施与验证状态以复选框及下方实际证据为准；规划校验不代表运行验证。复用 GEN-001～004 的实际模板、客户端、存储和生成内核，保留其他 change 的并行修改。此项以 fixture 验证传输和生命周期，真实模型与最终部署分别在 GEN-010、GEN-009 验收。

## 1. 公开输入、状态与事件契约

- [x] 1.1 GEN-005 定义三个公开接口和 accepted/activity/terminal 的权威 Zod schema，复用 GEN-004 输入规则，明确 200 SSE、重复请求 JSON、202 取消请求及 unknown 的区别。验证：后端测试覆盖路径、额外字段、32 KiB 体积、Accept、关联/序号、安全错误与内部字段排除；更新 Development 的契约归属及 README 的接口说明，不建立前端实现依赖。

## 2. 运行管理、准入与状态控制

- [x] 2.1 GEN-005 将 GEN-004 的受理/执行拆为可组合步骤，保持原 CLI/内核行为；新增具体活动运行管理，统一 Controller、执行 Promise、所属连接和一次性最终化。验证：真实临时数据库测试相同请求只受理/调用一次、不同载荷冲突、受理失败不泄漏槽位、已结束请求可重放且不受新基线影响；GEN-004 原测试通过，更新 Development 的所有权和收尾规则。
- [x] 2.2 GEN-005 加入项目 1/会话 1/全局 2 的准入、独立接口限流及滚动 24 小时 20 次新受理配额，必要索引走已有迁移；不排队或提前释放取消中的名额。验证：并发测试覆盖 409/429/503 与 Retry-After、日配额跨重开保留、重复请求不重复扣配额、伪造转发头不能绕限、清理后容量恢复；同步 Development 的默认限制和部署前提。
- [x] 2.3 GEN-005 接入按 requestId 查询和取消接口，逐次校验会话、项目归属与 Origin；活动取消为 202 已请求，终态为 200，孤立 running 为 503 未确认。验证：A/B cookie 的 injection 测试覆盖 401/404、重复取消、不可访问资源同形、无模型副作用和元数据脱敏；存储失败不谎报终态，README 记录查询和取消的实际调用顺序。

## 3. POST 事件流与连接故障

- [x] 3.1 GEN-005 接入新生成 POST 和 Node Readable SSE，受理成功先发 accepted，再映射真实活动，持久结果确认后只发一个 terminal；每帧显式校验，JSON/SSE 分支清楚。验证：真实 listen 随机端口与受控 SDK 上游在 gate 未释放时已读到首帧，随后序号/关联/终态正确；确认 EOF/200 不是成功、开流后不混入 JSON、心跳不算进度、状态和流均无正文泄露；更新 Development 的事件语义。
- [x] 3.2 GEN-005 实现帧/总量/队列上限、背压等待、心跳与发送截止时间，传输故障显式中止未完成运行。验证：真实慢读网络和可缩小阈值的传输测试覆盖 8 KiB 帧、积压、写入失败、超限及终态发送等待，断言缓冲有界、监听/计时器清理、其他运行不受影响；已保存结果不被传输失败改写，更新 Development 的传输边界。
- [x] 3.3 GEN-005 绑定最初 SSE 响应的提前关闭并传播 CLIENT_DISCONNECTED，统一显式取消、超时和成功提交竞争。验证：真实 fetch abort/socket 销毁、重复 POST 连接关闭、取消前后提交、成功后丢末帧，以及迟到上游响应；同时检查上游中止、候选数量、查询终态和槽位，确保没有第二终态或新模型步骤；README 与 Lifecycle 说明断线查询及不保证后台续跑。

## 4. 单服务所有权、恢复与关闭

- [x] 4.1 GEN-005 将固定 proper-lockfile 声明为后端运行依赖，增加必要类型与唯一 lockfile 更新；在规范数据路径上取得所有权后才迁移/恢复，失败和丢失所有权都走安全清理。验证：frozen install、独立后端构建、两个不同端口同库子进程竞争、独立数据库互不干扰及失败释放；不截断数据或删除未知锁，更新 Monorepo 与 Lifecycle 的依赖/30 秒 stale 前提。
- [x] 4.2 GEN-005 在取得所有权后、监听前把遗留 running 原子标为 interrupted，不自动调用模型；恢复失败拒绝启动。验证：实际 SIGKILL 后按 stale 规则重启，查询中断记录、消息和当前版本保持，既有成功候选不变、上游计数不增加；受控恢复写入失败不监听，更新 Lifecycle 的重启状态和数据保留规则。
- [x] 4.3 GEN-005 在 preClose 停止准入、中止请求并按 5 秒收尾预算结束流，使用最终化/写入许可阻止晚到写入，onClose 按 store→所有权顺序释放。验证：实际 SIGTERM、活动 SSE、迟到结果、监听失败及存储关闭故障；有限退出、无未处理拒绝或已关闭存储访问，终态不确定时可重启恢复；同步 Lifecycle 与 Verification 的适用关闭场景。

## 5. 浏览器与本地代理回归入口

- [x] 5.1 GEN-005 新增 `scripts/generation-stream-smoke.cjs`、测试专用构建应用启动器及 `pnpm smoke:generation-stream`，复用现有 Chrome/playwright-core；测试只注入本地受控模型传输，不增加生产开关。验证：浏览器经 dev/preview 相对 API 完成首帧、跨块 UTF-8、正常终态、取消、断流、按 requestId 确认及后端重启；比较当前版本未变，仅清理所属进程/数据，报告 fixture 并脱敏；README 与 Verification 记录命令、build 前提、证据目录和最终反代未验证边界。

## 6. 集成验收

- [x] 6.1 GEN-005 串行运行 frozen install、`pnpm check`、`pnpm test:manager`、`pnpm smoke`（含 build）、新增 `pnpm smoke:generation-stream` 和受影响的 GEN-003 项目恢复回归；相同源码已有有效结果时复用，不重复消耗真实模型额度。验证：记录命令/退出码、实际差异、首帧/中止/恢复观察，默认 check 与 CI 均无真实调用；执行 `pnpm openspec validate gen-005-generation-stream-control --strict --no-interactive`、链接检查和 `git diff --check`，区分已验证传输、未验证真实模型/预览/线上部署。

## Implementation evidence

2026-10-18，本轮完成公开生成/查询/取消、真实 SSE、准入及同库服务生命周期。实现位置：backend/src/contracts/generations.ts、routes/generations.ts、generation/manager.ts、generation/stream.ts、storage/ownership.ts，以及原 service/store/app/server 的组合接入；schema v2 仅增加查询索引。依赖固定 proper-lockfile 4.1.2 与开发类型 4.1.4。GEN-004 原 CLI/内核契约与候选不采用规则保留。

| 实际命令 | 结果 |
| --- | --- |
| pnpm install --frozen-lockfile | 0；唯一 lockfile 与后端运行依赖一致 |
| pnpm check | 0；最终 lint/typecheck 通过，160 项测试通过、0 失败、0 跳过 |
| pnpm test:manager | 0；13 项通过（含父项），约 180 秒；真实 bootstrap、同源配置、硬杀恢复及所属进程保护 |
| pnpm smoke | 0；含前后端独立构建，dev/preview 连接、错误恢复和既有布局通过 |
| pnpm smoke:generation-stream | 0；dev/preview 共 8 个浏览器场景通过，fixture 上游 10 次请求、4 次实际连接中止，真实模型调用 0 |
| pnpm smoke:projects | 0；6 个浏览器场景及 4 项控制测试通过，快照/消息/run/候选重开及信号清理正常 |
| pnpm --filter @atoms/backend exec tsx --test test/generation-stream.test.ts | 0；最终专项 17 项通过，包含构造/受理失败不占槽与迟到输出零存储访问 |

实际网络在上游 gate 未释放时读到 accepted；活动关联/seq 连续、终态至多一次，显式取消、fetch abort 与原始 socket 销毁均观察到上游中止。终态写入失败返回 unknown，孤立 running 返回安全 503；成功提交后丢末帧仍可查询 succeeded，不能再改为取消。慢读网络与缩小阈值覆盖帧、总量、队列、发送等待和清理；无正文或凭据进入状态/事件。

实际 SIGTERM 在活动 SSE 下有限退出；SIGKILL 后立即竞争失败，等待真实 31.1 秒后由 proper-lockfile stale 规则准许重启，运行恢复 interrupted/PROCESS_RESTARTED，当前版本、既有成功候选与消息保持，供应商请求数没有增加。恢复触发器拒绝写入时不监听并释放本次所有权；所有权丢失撤销写入许可，迟到传输不访问已关闭存储。Process Compose 后端 backoff 调为 32 秒以跨过锁窗口，manager 恢复断言允许 50 秒，未改变其进程归属协议。

浏览器报告：`test-results/generation-stream/77013f0d-241d-4698-8924-5a506029e768/report.json`。manager 报告：`test-results/manager/603c598a-554d-4a00-8553-98028f5ce93e/report.json`。项目恢复报告：`test-results/project-persistence/5a190d54-7e36-4c69-9251-95f8d4650418/report.json`。最终日志位于 `/tmp/atoms-gen005-{check-final,manager,smoke,browser-final,projects}.log`；综合报告为 `test-results/gen-005/22a16c61-0254-478e-b85c-37ccbd2c8600/report.json`，含 33 个实现/测试文件的 SHA-256，最终检查期间一致。本地报告和日志不进入版本控制，不上传数据库、cookie 或请求正文。

README、Development、Lifecycle、Monorepo、Verification 与工作入口同步了接口、限制、关闭/重启及验收前提。严格校验本 change、150 个本地文档目标、6 个新增 generation 锚点与 git diff --check 均通过。测试所属进程已关闭，3001/5173/4173 无监听；其他任务的未提交改动及并行工作保持原状，本轮未执行提交、推送、归档或发布。

边界：本轮 source=fixture；跨字节解码额外使用明确的中文/emoji SSE 注释夹具，不伪造产品活动。真实模型经公开接口、候选编译/交互、工作台 UI 和最终服务器反代未在本轮验收。GEN-004 既有真实模型证据独立保留，不重复消耗额度；GEN-005 完成不表示完整 Top 1 已完成。
