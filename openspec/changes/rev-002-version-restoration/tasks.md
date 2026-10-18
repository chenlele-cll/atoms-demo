# Tasks

REV-002：版本恢复。按用户「实现 REV-002」完成后端实施，复选框依据真实测试与回归，不将工件存在或严格校验通过记成产品验收。行为依据为 [spec.md](./specs/version-restoration/spec.md)，实现依据为 [design.md](./design.md)；实际证据见文末。

## 1. Contracts And Storage

本组复用 GEN-003 持久化和 GEN-006/REV-001 的完整版本读取/关联检查，所有活动检查依赖显式传入，测试替身只用于隔离测试。生产恢复路由已接入第二组的真实管理器保护。

- [x] 1.1 增加 restore 路径、strict expected 请求、严格空 query、成功 DTO 和安全错误 schema；验证 UUID、缺字段、额外 compiled/verified/files、错误投影及响应无代码的聚焦契约测试，复用实际权威 schema 所在模块。
- [x] 1.2 增加带有效会话与项目归属的目标查找、模板和 generated 完整性/摘要自校验、父关联与唯一有效 succeeded 结果检查；用真实临时 SQLite 验证不存在/跨项目 404、无合格关联 409、矛盾关联/损坏 500，历史读取不依赖今日目录且从未采用的 generated 可恢复。
- [x] 1.3 实现同步短事务的合法 alreadyCurrent、CAS、显式活动检查依赖和事务内全部 running 检查及条件更新；聚焦 store 测试验证目标父版本不等于 expected 仍可恢复、旧 expected 冲突、幂等先于活动检查且不更新时间、检查器缺失不能默认为空闲。
- [x] 1.4 增加实际切换、同目标和不同目标竞争、恢复后被切走再重试、DB running、事务故障回滚与数据文件重开测试；比对 currentVersionId/updatedAt、完整快照正文/digest、序号、父关联、messages/runs，证明只允许两个项目字段变化且零模型/代码执行。
- [x] 1.5 在本任务记录先行阶段实际差异、聚焦后端测试命令/退出码及内部契约完成证据；逐项区分已实现 store 与等待 GEN-005 的生产注册，不将隔离测试结果写成真实 HTTP、编译或业务验收完成。

## 2. Execution And HTTP Integration

本组已对接 GEN-005 的真实活动执行者、所有权撤销与关闭状态；复用 GEN-006 单版本 GET/adopt 和公开契约，保持其父基线采用条件。正常生产组装注册 restore，缺少真实管理器拒绝注册版本路由。

- [x] 2.1 将显式恢复检查依赖对接 GEN-005 真实项目执行者及服务可写状态，与同步事务间不留异步窗口且保留 DB running；用真实执行者和受控上游 gate 测试活动/取消收尾为 PROJECT_BUSY、孤立 running 为 RUN_STATE_UNCONFIRMED、关闭/所有权失效拒绝切换，不添加默认空检查或环境后门。
- [x] 2.2 注册受保护的 restore POST 和生产组装依赖，复用 Origin/JSON/归属/no-store、安全错误、1 KiB 体积与 10 次/分钟/IP 限流；Fastify injection 验证 200/400/401/403/404/409/413/415/429/500/503、Retry-After 及敏感哨兵不泄露，并验证缺真实检查依赖不开放生产恢复。
- [x] 2.3 增加真实 HTTP 网络竞争测试，覆盖生成先受理则恢复 busy、恢复先提交则旧基线生成拒绝、adopt 与 restore 共享当前引用 CAS、同目标幂等和不同目标冲突；以真实临时库及生产相同组装路径验证最终引用和历史，自动化标记 fixture，端口/连接只清理本次所属资源。
- [x] 2.4 增加提交后丢失 HTTP 响应、查询不可用、查询发生于提交前、目标随后被切走及相同合法载荷重试的网络测试；验证查询只报告当下事实、无自动更改 expected、原时间不被重试覆盖，重启所属服务后当前选择及全部内容一致，不编写 REV-003 UI。
- [x] 2.5 在实际 HTTP 对接完成时更新其所需的既有 Development/Verification 规则与接口可用范围，核对文档和真实路由/命令一致；记录真实活动检查与 DB 双重保护证据，不修改其他 changes 的工件，不提前声称 REV-003/004/005 完成。本次规划阶段不执行这些未来文档修改。

## 3. Integration Evidence

本组只做跨模块集成检查与交付，不代替前两组应落地的测试或文档。REV-003 负责 UI 门槛，REV-004 负责恢复后续改，REV-005 负责跨任务验收；本任务 SHALL 不扩展它们的 UI 或上下文。

- [x] 3.1 完成实现后运行 `pnpm check`、`pnpm build`，随后串行执行受影响的 `pnpm smoke:projects` 及 GEN-005 实际已提供的事件流回归；记录每条真实命令、退出码和代码差异，不把尚不存在或未执行的命令记为通过，后端测试不替代 UI/预览验证。
- [x] 3.2 对照 REV-001 列表字段、GEN-006 单版本 GET/adopt 及本任务 restore 做最终契约核对；提供给 REV-003/004/005 的交付记录，明确恢复不要求曾采用或 target.parent=expected、不接收可信 compiled/verified、不调用模型/执行代码/新建快照/删除历史，以及未完成的跨任务验收范围。
- [x] 3.3 运行 `pnpm openspec validate rev-002-version-restoration --strict --no-interactive`、`pnpm openspec status --change rev-002-version-restoration` 与范围 `git diff --check`，记录结果及完整证据索引；仅在实际实现和所需验证通过后勾选相应任务，等待对接项保持未勾，不自动 apply、归档、提交或推送。

## Implementation Evidence

2026-10-18：按明确实施指令交付后端恢复契约、短事务、生产路由、真实活动与可写保护。直接复用当前 `@atoms/contracts`，restore 的输入/输出结构与 adopt 相同并复用其 schema，导出独立 `Restoration` 类型；store 复用候选/父快照结构、digest 与成功运行关联校验，补充拒绝跨项目矛盾结果关联。没有新增依赖、表或迁移，不回填历史。

真正切换在同一 immediate 事务中完成 session/owner/target → alreadyCurrent → CAS → 显式 activity/全部 running → owner/current 条件更新。updatedAt 在实际切换时严格递增，合法重试返回现有值。生产 callback 同步调用本应用真实 `GenerationManager.assertWritable()` 与 `projectActivity()`，所有权撤销和 preClose 都拒绝实际切换；目标已当前的无写入重试仍可按规格返回。缺少真实 manager 不注册版本路由。

`version-restoration.test.ts` 为 17 个顶层 store/injection 测试及 14 个子场景；`version-restoration-network.test.ts` 为 12 个真实网络/manager 用例，共 43 项通过。fixture 使用临时真 SQLite、生产相同 buildApp 组装及随机 loopback 端口；只有显式生成竞争用例调用本地受控 SDK 上游，外部模型调用为零。SQL 全表前后比较证明恢复仅改 current/updatedAt，源代码哨兵不执行，正常恢复模型传输计数为零。损坏样本只在隔离库构造。

复核补齐了跨项目 result 关联损坏（含目标已当前）、真实 app.preClose 对已进入且延迟 body 的恢复请求拒绝；真实 SSE accepted、取消终态但 Map 未释放、孤立 running、adopt/restore 竞争与旧 base 拒绝分别由实际状态触发。提交后销毁 socket 仍能 GET 确认；POST body 尚未完成时先 GET 可见旧值，随后 POST 仍可提交，未把旧值当作永不提交证明。确认查询不可用不自动重放，目标切走后旧 CAS 拒绝；停止所属监听应用后用同库同会话再次 listen，逐项比较原快照与引用。

### Verification Results

全部应用检查使用 Node v22.22.2 与 pnpm 12.11.2，从根目录执行；固定端口回归串行，仅清理本次所属资源，不读取真实模型配置或生产数据库。

| 命令 | 实际结果 |
| --- | --- |
| `pnpm --filter @atoms/backend typecheck` | 通过，完成共享契约与模板准备 |
| `pnpm --filter @atoms/backend exec tsx --test test/version-restoration.test.ts test/version-restoration-network.test.ts` | 最终 43 项通过、0 失败；实际从 backend 工作目录以等价 pnpm exec 调用 |
| `pnpm check` | 最终通过：全库 lint/types，release 16、verification 23、contract preparation 1、backend 240、frontend 32 项测试；初次因新测试 prefer-const 失败，修复后完整重跑通过 |
| `pnpm build` | 前端、后端、共享契约通过；Vite 既有大块提示不影响退出码 0 |
| `pnpm smoke:projects` | 6 个 dev/preview 场景通过，cleanup passed；随后 4 项端口/信号控制测试通过 |
| `pnpm smoke:generation-stream` | 8 个 dev/preview 场景通过，cleanup passed，realModelCalls=0 |
| `pnpm openspec validate rev-002-version-restoration --strict --no-interactive` | 通过，仅为结构校验 |
| scoped `git diff --check` | 修改的代码和文档通过；新测试和本工件的 no-index 空白检查通过 |

项目报告位于忽略的 `test-results/project-persistence/6146746d-af6a-43c9-86b8-336bb972d09f/report.json`；生成流报告位于忽略的 `test-results/generation-stream/5d0f1512-e9a4-44e2-bc51-1657ac36a63c/report.json`。前者 modelRequests=0，后者 upstreamRequests=10、upstreamAborts=4、realModelCalls=0；不上传数据库、cookie 或原始请求。

验证时的源码 Git blob 摘要（不是提交）：contracts `36b0ee254af0d68b9db7e48f901a928dbe3f43c9`、store `422b81e5cc2c7697e281e754d1961d7d37ee8959`、manager `d315458046d3226ae0bcc3630f5c4a027f17a84c`、version route `cbfd44fdd28e6064b0ded2017c9cb492d5d3de17`、errors `67835d0882384ab82cc1796c0984580896012bbd`、store/HTTP test `add939fa0db0ca16ed4125e624999a42352cca0e`、network test `a8906c58b755043b5e7c7a0708da7e1c39299676`。工作树有其他并行任务，后续影响这些边界时应重跑相关检查。

交接前其他任务继续修改了共享 store 的生成上下文查询和 manager 的审计透传；保留其改动。对当前树重新执行后端 typecheck 及两份恢复专项，43/43 再次通过，并重新完成 scoped 差异和 strict 校验；此时 store 为 `7c713cae0fc6347f240da94b1299ecbf921cb490`、manager 为 `6d64b6f0fef09100eab8a1967e33113300912f17`，其余上述摘要未变。完整 check/build/两个固定端口专项对应前一组摘要，不将本次聚焦复核冒充这些命令的整套重跑。

### Contract Handoff

REV-001 列表与 GEN-006 单版本 GET 保持原分工和字段；restore 只改变它们下一次读取时的 current，不新增版本。adopt 仍要求 parent=expected，restore 不要求目标父版本等于 expected 或曾采用；服务端不接收 compiled/verified。REV-003 使用 `restoreRequestSchema/restoreResponseSchema/Restoration` 与已有项目 GET 处理确认和 unknown，本地预览仍只是 UI 门槛；REV-004 在确认 current 后继续生成并负责相关上下文，REV-005 再完成整体真实业务验收。

本任务未实现历史 UI、恢复后上下文筛选、真实模型业务改造或线上部署，不修改其他 changes 的完成状态。README、Development、Verification 与 backend guide 已按本次实际接口更新；未提交、推送或归档。
