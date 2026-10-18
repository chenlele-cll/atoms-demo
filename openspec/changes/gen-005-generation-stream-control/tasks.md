# Tasks

范围见 [proposal.md](./proposal.md)，方案见 [design.md](./design.md)，验收见 [generation-execution](./specs/generation-execution/spec.md)。以下均待实施；规划校验不代表功能或运行验证完成。先具备 GEN-001～004 的实际模板、客户端、存储和生成内核，保留其他 change 的并行修改。此项以 fixture 验证传输和生命周期，真实模型与最终部署分别在 GEN-010、GEN-009 验收。

## 1. 公开输入、状态与事件契约

- [ ] 1.1 GEN-005 定义三个公开接口和 accepted/activity/terminal 的权威 Zod schema，复用 GEN-004 输入规则，明确 200 SSE、重复请求 JSON、202 取消请求及 unknown 的区别。验证：后端测试覆盖路径、额外字段、32 KiB 体积、Accept、关联/序号、安全错误与内部字段排除；更新 Development 的契约归属及 README 的接口说明，不建立前端实现依赖。

## 2. 运行管理、准入与状态控制

- [ ] 2.1 GEN-005 将 GEN-004 的受理/执行拆为可组合步骤，保持原 CLI/内核行为；新增具体活动运行管理，统一 Controller、执行 Promise、所属连接和一次性最终化。验证：真实临时数据库测试相同请求只受理/调用一次、不同载荷冲突、受理失败不泄漏槽位、已结束请求可重放且不受新基线影响；GEN-004 原测试通过，更新 Development 的所有权和收尾规则。
- [ ] 2.2 GEN-005 加入项目 1/会话 1/全局 2 的准入、独立接口限流及滚动 24 小时 20 次新受理配额，必要索引走已有迁移；不排队或提前释放取消中的名额。验证：并发测试覆盖 409/429/503 与 Retry-After、日配额跨重开保留、重复请求不重复扣配额、伪造转发头不能绕限、清理后容量恢复；同步 Development 的默认限制和部署前提。
- [ ] 2.3 GEN-005 接入按 requestId 查询和取消接口，逐次校验会话、项目归属与 Origin；活动取消为 202 已请求，终态为 200，孤立 running 为 503 未确认。验证：A/B cookie 的 injection 测试覆盖 401/404、重复取消、不可访问资源同形、无模型副作用和元数据脱敏；存储失败不谎报终态，README 记录查询和取消的实际调用顺序。

## 3. POST 事件流与连接故障

- [ ] 3.1 GEN-005 接入新生成 POST 和 Node Readable SSE，受理成功先发 accepted，再映射真实活动，持久结果确认后只发一个 terminal；每帧显式校验，JSON/SSE 分支清楚。验证：真实 listen 随机端口与受控 SDK 上游在 gate 未释放时已读到首帧，随后序号/关联/终态正确；确认 EOF/200 不是成功、开流后不混入 JSON、心跳不算进度、状态和流均无正文泄露；更新 Development 的事件语义。
- [ ] 3.2 GEN-005 实现帧/总量/队列上限、背压等待、心跳与发送截止时间，传输故障显式中止未完成运行。验证：真实慢读网络和可缩小阈值的传输测试覆盖 8 KiB 帧、积压、写入失败、超限及终态发送等待，断言缓冲有界、监听/计时器清理、其他运行不受影响；已保存结果不被传输失败改写，更新 Development 的传输边界。
- [ ] 3.3 GEN-005 绑定最初 SSE 响应的提前关闭并传播 CLIENT_DISCONNECTED，统一显式取消、超时和成功提交竞争。验证：真实 fetch abort/socket 销毁、重复 POST 连接关闭、取消前后提交、成功后丢末帧，以及迟到上游响应；同时检查上游中止、候选数量、查询终态和槽位，确保没有第二终态或新模型步骤；README 与 Lifecycle 说明断线查询及不保证后台续跑。

## 4. 单服务所有权、恢复与关闭

- [ ] 4.1 GEN-005 将固定 proper-lockfile 声明为后端运行依赖，增加必要类型与唯一 lockfile 更新；在规范数据路径上取得所有权后才迁移/恢复，失败和丢失所有权都走安全清理。验证：frozen install、独立后端构建、两个不同端口同库子进程竞争、独立数据库互不干扰及失败释放；不截断数据或删除未知锁，更新 Monorepo 与 Lifecycle 的依赖/30 秒 stale 前提。
- [ ] 4.2 GEN-005 在取得所有权后、监听前把遗留 running 原子标为 interrupted，不自动调用模型；恢复失败拒绝启动。验证：实际 SIGKILL 后按 stale 规则重启，查询中断记录、消息和当前版本保持，既有成功候选不变、上游计数不增加；受控恢复写入失败不监听，更新 Lifecycle 的重启状态和数据保留规则。
- [ ] 4.3 GEN-005 在 preClose 停止准入、中止请求并按 5 秒收尾预算结束流，使用最终化/写入许可阻止晚到写入，onClose 按 store→所有权顺序释放。验证：实际 SIGTERM、活动 SSE、迟到结果、监听失败及存储关闭故障；有限退出、无未处理拒绝或已关闭存储访问，终态不确定时可重启恢复；同步 Lifecycle 与 Verification 的适用关闭场景。

## 5. 浏览器与本地代理回归入口

- [ ] 5.1 GEN-005 新增 `scripts/generation-stream-smoke.cjs`、测试专用构建应用启动器及 `pnpm smoke:generation-stream`，复用现有 Chrome/playwright-core；测试只注入本地受控模型传输，不增加生产开关。验证：浏览器经 dev/preview 相对 API 完成首帧、跨块 UTF-8、正常终态、取消、断流、按 requestId 确认及后端重启；比较当前版本未变，仅清理所属进程/数据，报告 fixture 并脱敏；README 与 Verification 记录命令、build 前提、证据目录和最终反代未验证边界。

## 6. 集成验收

- [ ] 6.1 GEN-005 串行运行 frozen install、`pnpm check`、`pnpm test:manager`、`pnpm smoke`（含 build）、新增 `pnpm smoke:generation-stream` 和受影响的 GEN-003 项目恢复回归；相同源码已有有效结果时复用，不重复消耗真实模型额度。验证：记录命令/退出码、实际差异、首帧/中止/恢复观察，默认 check 与 CI 均无真实调用；执行 `pnpm openspec validate gen-005-generation-stream-control --strict --no-interactive`、链接检查和 `git diff --check`，区分已验证传输、未验证真实模型/预览/线上部署。
