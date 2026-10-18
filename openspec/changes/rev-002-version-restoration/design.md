# Design

## Context

动机见 [proposal.md](./proposal.md)，可观察行为见 [version-restoration](./specs/version-restoration/spec.md)。本设计依据读取时的工作树：GEN-003 已完成；GEN-004 正在实施，已有 `acceptGeneration/completeGeneration` 和 `saveCandidate`，候选保存不改变 currentVersionId；GEN-005/006/007 仍是规划。GEN-005/006 旧设计的“只有健康接口、所有前置待实施”描述不代表当前事实，本任务不改写这些文件。

`backend/src/storage/migrations.ts` 已有 sessions/projects/versions/messages/generation_runs、同项目组合外键、项目内唯一 sequence 及快照 UPDATE 禁止触发器。`store.ts` 采用同步短事务与参数绑定，快照读取经 `versionSchema/snapshotSchema` 验证，重算 SHA-256，按历史自身身份验证而非今日目录。现有 `version()` 对缺失行尚未区分 404 与损坏，新增恢复查找须先明确存在性，再解析，不能将正常缺失误报 500。当前没有采用日志，也没有可信编译记录。

项目路由已有有效会话、精确 Origin/JSON、no-store、安全错误投影与限流基础；公开版本读取、adopt、restore 以及 GEN-005 活动 Map 尚未实现。现有测试使用 Node 测试器、临时 SQLite 与 Fastify injection，已有故障触发器、跨会话、跨项目及重开比对模式。前端目前只有健康 HTTP 客户端，不在本任务新增 UI。

## Goals / Non-Goals

**Goals:**

- 用现有不可变版本与条件更新完成恢复，明确重试、竞争及生成中的写入边界。
- 分开可先行的数据库实现与必须等待的活动管理对接，以具体证据判定完成。
- 在恢复请求与后续查询之间保持事实语义，使 REV-003/004/005 能消费稳定契约。

**Non-Goals:**

- 不实现历史列表、单版本读取、adopt、UI 门槛、继续生成上下文或跨任务浏览器验收。
- 不新增采用/恢复事件表、快照复制、编译证明、模型调用或代码执行；不把 fixture 当真实生成。
- 本轮仅写规划工件，不修改实现、其他 changes 或文档，也不执行 apply。

## Decisions

### Contract Ownership

REV-002 只新增 `POST /api/projects/:projectId/versions/:versionId/restore`，strict `{expectedCurrentVersionId}`，三个标识均 UUID，query 为严格空对象、bodyLimit=1024。成功 200 返回 `{projectId,currentVersionId,updatedAt,alreadyCurrent}`，时间沿用毫秒精度 ISO schema。拒绝 files、compiled、verified、runId、目标正文等额外输入。复用已有 JSON/Origin/no-store/安全错误与 IP 限流，默认恢复 10 次/分钟/IP、429 含 Retry-After，不消耗模型配额且保持 trustProxy=false。

权威定义先落在实际项目契约所在位置；若 GEN-006 已将公开定义提取到 `@atoms/contracts`，沿用该单一来源。不能为抢先开发复制 schema 或创建另一个共享包，不增加依赖。不同于把恢复复用成 adopt 别名，单独动作保留 adopt 的父基线规则，也避免 UI 将历史选择误判为新候选采用。

接口分工固定如下，均不由本任务扩展：

| Owner | Contract |
| --- | --- |
| REV-001 | `GET /api/projects/:projectId/versions?limit=20&beforeSequence=N`；limit 1..50，beforeSequence 为可选非负安全整数，sequence 倒序且排他 `<N`；响应 `projectId/currentVersionId/items/nextBeforeSequence`，无代码正文 |
| REV-001 | item 为 `id/sequence/parentVersionId/kind/createdAt/isCurrent/runId|null/request{messageId,excerpt,truncated}|null/summary{source:'stored'|'fallback',text}/changedFiles`；template changedFiles=[]，generated 比较自身父版本；不表达曾采用或已验证 |
| GEN-006 | `GET /api/projects/:projectId/versions/:versionId` 完整读取和 `POST .../adopt`；其 adoptionAvailability 只描述采用，不代表恢复资格 |
| REV-003 | 恢复选择、预览门槛、按钮状态及未知结果查询展示；本地编译不成为服务端证明 |
| REV-004 | 恢复成功后续改，消费新的 currentVersionId；本任务不更改历史选取或生成上下文 |
| REV-005 | 跨任务集成和浏览器验收；本任务提供后端证据，不代勾其任务 |

### Target Integrity

先以 projectId+versionId 明确查找并验证归属，再解析持久版本。模板须满足 sequence=0、parentVersionId=null 和模板快照规则；generated 须为正序号、父版本属于本项目，并存在唯一合格 succeeded 结果关联：run.projectId 匹配、resultVersionId=目标、baseVersionId=目标 parentVersionId，且 runSchema 的 finishedAt/errorCode 等终态一致。检查父版本存在、结构与身份/入口/依赖相容，不能接受跨项目或矛盾引用。

目标快照沿用完整结构、规范路径、固定依赖、64 文件/2 MiB 与 digest 重算校验，不 import 或执行快照。缺少成功结果关联为 409 VERSION_NOT_RESTORABLE；已有记录损坏、关联矛盾或多个结果关联为 500 DATA_CORRUPT。不存在/跨项目仍为 404。MUST 不以曾采用为条件：当前模型没有可证明它的日志，generated 从未成为当前也可恢复。结构和 digest 自校验不等于浏览器编译，更不等于业务验收。

相较重新从模板目录构造目标，读取已存完整快照可保留历史依赖与正文；相较新增“已采用”布尔值或日志，这一方案不伪造过去事实，也不需要数据迁移。

### Transaction And Retry Order

恢复是同步 `BEGIN IMMEDIATE` 短事务，参数绑定；同服务生成准入与事务之间没有 await。执行顺序固定：

1. 重新校验持久会话有效性、项目归属、路径/expected 输入和目标存在性，并完成目标结构、digest、父关联与 succeeded 关联检查。expected 只是一项 UUID 比较前置条件，不据此查询或泄露其他项目版本。
2. 若目标已经是 currentVersionId，返回现有 updatedAt、alreadyCurrent=true，不写数据库。即使原 expected 已过期或后来出现活动/孤立 running，也保留这一合法无写入重试；目标不合法则不得走此捷径。
3. 若当前不等于 expected，返回 409 CURRENT_VERSION_CONFLICT，不自动换 expected；不要求 target.parentVersionId=expected。
4. 查询 GEN-005 当前项目执行者（含取消/最终化收尾），有执行者返回 409 PROJECT_BUSY；再检查数据库所有本项目 running，无执行者但有 running 返回 503 RUN_STATE_UNCONFIRMED。活动检查失败、关闭或失去服务所有权则拒绝实际切换，不当作 idle。
5. 带项目、owner 和 `current_version_id=expected` 条件更新 current_version_id、updated_at，确认恰好一行后提交；updatedAt 仅在实际切换产生新的持久值，已有值与当前时钟相同时以至少增加 1ms 保持可区分。返回 alreadyCurrent=false。任何故障整体回滚。

重试返回的是请求时现有 updatedAt，不能拿第一次恢复时间覆盖后续生成活动带来的项目更新时间。相同目标并发中先提交者实际切换，后者重新验证后得到 alreadyCurrent；不同目标共享旧 expected 时最多一个成功。A 恢复后又被切到 B，旧载荷恢复 A 必须重新过 CAS，不能借幂等规则覆盖 B；CAS 只比较当前标识，不声称防止 A→B→A 的 ABA 历史变化，这需要当前未规划的修订号或操作日志。

### Generation Coordination

数据库 running 与内存执行者是两个必要事实，不能仅查 latestRun，也不能只看 Map。GEN-005 的活动检查与同步事务共享单服务所有权和准入边界：生成先受理则恢复 busy；恢复先提交则新生成旧 baseVersionId 校验失败。运行完成写库后尚未释放 Map 的收尾仍为 busy。数据库有 running 而无 Map 执行者必须未确认，由 GEN-005 启动恢复处理，恢复入口不自作主张标记 interrupted。

先行 store 开发可用明确注入的测试检查器覆盖活动/关闭等情况，但检查器依赖必须显式，不提供默认 `() => false`、可选缺失即空闲或生产环境开关。生产服务组装必须接入真实 GEN-005 执行者状态、服务所有权/关闭状态，并保留事务内 DB running 检查；对接未完成时不注册生产恢复端点，不能把 store 测试通过记成 HTTP 已可用。无写入幂等分支本身不依赖活动准入，但不能借此注册缺少真实检查器的生产接口。

相较“先做 HTTP 再补检查”，这一顺序允许独立验证现有数据库能力，同时不会发布可在真实生成中切换引用的后门。无需建设通用调度器；复用 GEN-005 的项目状态和既有单库单服务所有权。

### Unknown Results And Errors

错误投影沿用 `{error:{code,message},requestId}`。400/401/403/404/413/415/429 复用现有边界，409 增加 CURRENT_VERSION_CONFLICT、PROJECT_BUSY、VERSION_NOT_RESTORABLE，503 增加 RUN_STATE_UNCONFIRMED；存储失败为 STORAGE_UNAVAILABLE，损坏为 DATA_CORRUPT。任何错误不得包含 SQL、cookie、绝对路径、提示词或文件正文，成功与错误均 no-store。

调用方未得到可验证成功响应时结果未知，可使用已有项目 GET 确认 currentVersionId，REV-001 列表也只呈现当下 currentVersionId/isCurrent，不能反推采用历史。GET 读到目标可确认当前生效；查询失败保持未知。读到旧版本可能是 POST 尚未提交，读到其他版本可能是竞争或目标曾生效后被切走，都不能据此声明原请求从未或不会提交。不自动重发 POST 或更新 expected；所有者可明确查询或以同一合法载荷手动重试，服务端幂等/CAS 约束仍生效。不增加 requestId 操作日志，因此不承诺还原某次恢复的历史结果。

### Evidence And Scope

先行 store 测试复用 `backend/test/project-store.test.ts` 的临时真实数据库、故障触发器和重开比对，覆盖模板、从未采用的 generated、其他分支、异常关联、摘要篡改、合法幂等、CAS、DB running 与回滚。对比版本完整文件与摘要、父关联、序号、messages、runs；真实切换只允许项目两个字段变化。测试不需要模型凭据，模型与代码执行调用为零。

待 GEN-005 接入后，Fastify injection 验证 strict/Origin/归属/错误/no-store/限流；真实 listen 随机端口及明确 fixture 执行者验证生成与恢复争用、取消收尾、孤立 running、丢失 HTTP 响应后查询、关闭重开。测试必须走生产相同的服务组装依赖，不能仅以空检查器证明并发安全；可用受控上游 gate 等待真实执行阶段，无需真实计费请求。不得把 injection 当流取消的网络证据。

未来实现按 verification 规则运行聚焦后端测试、`pnpm check`、`pnpm build`；涉及生产注册后顺序执行受影响的 `pnpm smoke:projects` 及 GEN-005 届时实际存在的事件流回归，不能声称尚不存在的命令已通过。纯规划阶段只运行本 change strict validate、status 和范围差异检查。完整 UI/实际预览/跨任务恢复后生成由 REV-003/004/005 验收。

## Risks / Trade-offs

- GEN-005 仍在规划，具体检查 API 名称未落地 → 固定语义与强制依赖，对接前只完成内部事务测试，不提前开放 HTTP。
- 损坏或无成功关联的快照可能仍出现在历史中 → 恢复重新验证，列表可见不等于恢复合格，不能按页面传来的标记信任。
- 当前指针无法证明历史是否曾采用或某次 POST 的过程 → 仅声明当前事实与可重试条件，不增加无需求的事件表。
- 文件摘要与关联检查在同步事务内占用写锁 → 沿用 64 文件/2 MiB 边界，无模型、网络或代码执行，针对上限样本验证有界行为。
- 当前 ID 的 CAS 不检测 ABA → 明确当前指针语义，不能将它宣传成完整编辑修订锁。

## Migration Plan

1. 获得后续实现授权后，先实现权威 schema、目标自校验和 store 条件事务及隔离测试，不改表结构或历史数据。
2. 等待 GEN-005 的真实活动执行者、单服务所有权与关闭检查接入，复用已落地的 GEN-006 单版本读取与公开契约位置；不修改 adopt 父基线语义。
3. 接入生产恢复路由及真实网络/竞争测试；缺少检查器时拒绝注册，完成证据区分内部与生产对接阶段。
4. 按任务完成实际验证并记录差异、命令、退出码、fixture 来源及未验证范围，向 REV-003/004/005 交付契约和结果。本次规划不修改这些任务或其文档。
5. 回退先停止新增恢复请求并按 GEN-005 收尾，再撤回路由/应用产物；保留数据库及当前引用，不删历史、不自动恢复某个旧版本。
