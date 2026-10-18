# Design

## Context

动机见 [proposal.md](./proposal.md)，行为见 [restored-version-continuation](./specs/restored-version-continuation/spec.md)。本次仅规划，观察基于当前工作树，保留他人正在进行的 GEN-004 改动。

| 已检查位置 | 当前事实及本次接入点 |
| --- | --- |
| `backend/src/generation/service.ts` | `generateProject` 先 inspectGeneration 重放，再检查 current/config，acceptGeneration 返回冻结基线与历史；工具闭包持有该快照，completeGeneration 保存候选 |
| `backend/src/generation/context.ts` | 固定规则、快照身份元数据、历史、当前 prompt；历史按 sequence 倒序，最多 10 条/16 KiB，再升序；累计上下文 256 KiB |
| `backend/src/generation/contracts.ts` | 已有 sessionId/projectId/baseVersionId/requestId/prompt；三个工具、最多 6 次请求，不需要恢复专属生成输入 |
| `backend/src/storage/store.ts` | acceptGeneration 的 SQL 取同项目最近 10 条，未检查 run 或 parent；受理前 totalHistory 不含本轮消息；saveCandidate 已用全项目 max(sequence)+1 与 run.baseVersionId 作 parent |
| `backend/src/storage/migrations.ts`、`contracts/projects.ts` | versions 的 parent、messages.runId、generation_runs 的 base/result/status 已具备；同项目外键、不可变版本触发器与递增序号可复用 |
| `backend/src/routes/projects.ts` | 只有会话、模板、项目及消息 API；公开生成、版本 adopt/restore 尚不存在 |
| `frontend/src/App.tsx`、`api/health.ts`、`template-baseline/` | 实际前端是连接检查及模板预览；尚无项目工作台、版本客户端或恢复控制器 |
| `backend/test/generation-integration.test.ts`、`test/helpers/generation.ts` | 已穿过实际 SDK 与本地受控 Responses、真实临时 SQLite；覆盖工具回传、重放、事务失败和基线改变，可扩展 |

GEN-003 已完成；GEN-004 正在实施，已有内部入口和候选保存证据；GEN-005/006/007 只有规划。已阅读其 design/spec；这些旧工件的初始状态陈述过时，本设计以源码和本次状态为准且不修改旧工件。Development 当前“同项目最近完整历史”的规则需要在未来实施时由本能力细化为“同基线血缘的相关历史”，文档更新归其原维护入口，本规划只写独占目录。

## Goals / Non-Goals

**Goals:**

- 用现有版本/run/message 关系明确模型历史资格，规则可通过实际 SDK 请求内容验证。
- 冻结文件与历史来自同一受理基线；恢复后产生新分支，旧数据和原 requestId 语义保持。
- 分开无需 UI 的内核测试与等待公开接口/工作台的集成测试，提供 REV-005 可直接消费的断言。

**Non-Goals:**

- 不另建生成引擎、恢复后生成 API、队列、历史压缩器、语义摘要或自动修复；不新增依赖。
- 不实现 REV-001 列表、REV-002 restore 事务、REV-003 历史 UI 或 REV-005 真实验收；仅定义接入约定。
- 不删持久消息，不建立曾采用、浏览器可信验证或分支事件表；不将成功 run 当作预览通过。

## Decisions

### 1 在受理事务按基线血缘筛选历史

最小改动放在 `ProjectStore.acceptGeneration` 的现有历史查询：从本次已验证的 baseVersionId 开始，沿同项目 parentVersionId 包含基线自身直至模板，得到版本集合。对链内 generated 版本，仅选择同项目 `status=succeeded`、`resultVersionId=该版本.id`、`baseVersionId=该版本.parentVersionId` 的 run，再按 messages.runId 取得 user/assistant 消息。模板节点没有生成 run；模板基线结果为空。无 run 消息不携带可证明的基线关系，排除但不删除。

优先使用现有 SQLite 的递归查询与绑定参数完成链查询/关联，避免加载全项目正文到内存。链必须同项目、无环且终止于合法模板；损坏、缺失或循环应返回现有安全 DATA_CORRUPT 分类，在受理写入与 SDK 调用前失败，不退回全项目历史或当前 catalog。实现可在同一同步短事务内用有限节点的链完整性核对，不新增通用图模块。不得先 LIMIT 全项目消息再过滤，否则未来分支会挤掉有效祖先消息。

该规则对所有新生成一致适用，不能依赖“最近发生过 restore”内存标记。直接恢复一个此前未采用的成功候选后，该版本已经是当前基线，其成功 run 有资格；无关候选无资格。parent 链表达代码来源，不表达曾采用或可信验证，不需要 adoption 日志。

备选方案：只清空所有历史最小但丢失当前基线的有效需求；按时间截断不能排除早期兄弟/失败 run；仅增加“忽略未来”提示仍把污染数据送给模型。选择已有关系过滤，既可验证又无需扩表。

### 2 保留现有预算的准确顺序与省略统计

血缘资格筛选后 SQL 取 sequence 倒序最多 10 条，再交 `buildContext` 保持原算法：从近到远累计 UTF-8 正文字节，不超过 16 KiB 的整条选入；超预算条目跳过，最多在这 10 条内继续，不从第 11 条补位；最终按 sequence 升序。不把消息改为必须成对，也不增加摘要、截断或 token 估算。

`totalHistory` 保持受理前同项目全部消息数量，`historyOmitted=totalHistory-selected.length` 同时覆盖分支排除和预算排除，不引入第二套公开计数。历史查询与计数发生在 createRun 保存本轮 user 之前；当前 prompt 仅在 buildContext 末尾加入一次。若历史恰好有相同文本，不按文本去重，因为那是另一真实旧需求；断言应比较新增消息位置/身份和独特 prompt。

所有工具 schema 与消息的 256 KiB 累计计量、6 步、完整文件和输出预算、maxRetries=0、SDK response.messages 续接均沿用原逻辑。规则变动局限历史资格，不能顺便重写模型编排。

### 3 恢复确认和新生成是两个明确动作

REV-002 的 `POST /api/projects/:projectId/versions/:versionId/restore` 只接受 `{expectedCurrentVersionId}`，目标为模板或有 succeeded run 关联的生成版本。它以 CAS 更新当前引用（以及该操作约定的更新时间），不新建快照、不删消息、不调用模型；不要求目标 parent 等于 expected。该区别保留 GEN-006 adopt 的“候选 parent 必须等于 expected”保护。

REV-003 先预览、明确确认恢复，并负责恢复 unknown 的查询收口；REV-004 续写消费有效恢复确认后重新读取的项目 currentVersionId。读取结果若仍等于目标 R，输入区显示 R，用户下一次明确提交才创建新 requestId，走 GEN-007 原生成控制器和 GEN-005 原 POST。若已是别的版本，显示冲突并保留草稿，不自动把下一条需求提交到它。刷新、预览完成或恢复成功回调只能读取/更新状态，不能触发生成。

未确认恢复或未确认旧生成时禁止新尝试，按原请求查询。浏览器不得从历史列表最高 sequence、latestRun、当前预览选择或本地 restore 目标推断当前基线。查看未采用候选仍遵守 GEN-007 原限制。

### 4 原冻结工具和保存事务即可产生新分支

acceptGeneration 返回的 baseVersion 同时确定历史链和工具闭包；list/read 从该快照读取，不重新取“最新”或 catalog。保存由 completeGeneration 再检查 current 与 run.base，saveCandidate 继续用 run.base 作 parent，全项目 max(sequence)+1 分配序号。

例：T(0)→A(1)→B(2)，A 另有 C(3)。恢复 A 后生成 D，D.parent=A、D.sequence=4，current=A。预览后用户明确 adopt D 才使 current=D。T/A/B/C 的 ID、parent、sequence、快照/digest、已有 run 和消息均保持；消息 sequence 继续递增。恢复到 T 后同理产生 parent=T 的新序号，不回到 1。

受理的 running+user 原子写入、完成的候选+assistant+succeeded 原子写入及失败收尾保持；模型等待始终在事务外。模型拒绝/截断、文件校验、超限、取消、超时及事务失败不改变 current；终态写入失败仍返回未确认。候选仍 unverified，不增加自动采用。

### 5 原请求重放优先于新基线检查，竞争共用准入

保持 service 现有顺序：输入/有效会话归属→inspectGeneration 同载荷重放→仅新请求检查 current/config→受理。恢复后重放 B 的原请求仍返回 B，不以 A 重算历史、不调用模型；同 ID 改 base/prompt 仍 REQUEST_CONFLICT。新尝试只在原终态已知且用户明确操作时分配新 ID，未知状态只查询原 requestId，未知指标 null，不新增费用估计或自动重试。

公开集成使用 GEN-005 的项目活动 Map 与持久 running 判定，REV-002/GEN-006 的当前引用切换检查也消费相同边界。同步准入和受理/恢复 CAS 之间没有异步窗口；恢复先提交使旧 base 被拒绝，生成先受理使恢复 busy；无执行者 running 为 RUN_STATE_UNCONFIRMED。完整检查分别在受理和完成短事务内再次执行。异常外部写入改变 current 时沿用 BASE_VERSION_CHANGED 拒绝候选，不静默换代码/历史。内核测试可以用自有第二 SQLite 连接构造指针变化，但不能宣称这验证了尚不存在的 restore API。

### 6 验证分为可先行与待依赖两阶段

先行使用既有 Node 测试器、`generationFixture`、`startFixture` 和真实 SDK，不新增框架。建立 T→A→B、A 的兄弟 C 和失败/取消/中断/无 run/其他项目消息，用自有临时 DB 指针设置模拟已确认 A 基线。捕获首个实际 Responses 请求验证 A 自身与祖先历史存在、其余哨兵不存在；加入超过 10 条无关新消息，证明过滤早于 LIMIT；多字节历史验证最近 10 条、16 KiB、顺序与省略数，模板基线为空。用缺失/循环等损坏 fixture 验证安全失败，不访问真实数据。

受控模型实际 list/read/submit：A、B 的同一路径使用不同哨兵，后续请求的 read_files 结果必须为 A；生成 D 后核对 parent、max+1、current=A、immutable old 数据及关闭重开。第二连接在模型 gate 等待期间能写入，确认没有长写事务。复用并扩展原重放/冲突/取消/超时/失败回滚测试，包含恢复后原 B 请求重放零新增调用与终态未确认不自动新尝试。

HTTP/UI 阶段等待 GEN-005/006/007、REV-002/003：实际 restore→GET 确认→显式提交原 generations→候选预览→明确 adopt→重开。使用真实网络验证 busy/unconfirmed、两标签 CAS、断流/查询，不以 injection 代替流式行为。测试归既有 generation/workspace/candidate 覆盖，不预先发明新公共入口或命令。REV-005 负责完整 live 验收，本 change 提供断言矩阵和 fixture 证据，不能把受控 SDK 当作真实供应商结果。

## Risks / Trade-offs

- parent 链仅能证明代码来源，不能证明曾采用或业务正确 → 只用于相关上下文资格，不添加 adoption/verified 标记；仍需明确预览/采用。
- 旧无 run 消息和失败需求可能包含有用信息 → 保留对话展示，但默认不作为当前代码现状；用户可在新 prompt 明确重述需求。
- 历史 10 条/16 KiB 可能只保留一半 run 的消息 → 保持既有逐消息预算，文件为实际基线权威，不引入成对回填或摘要。
- 链损坏或深链查询代价 → 同项目参数绑定、闭环/根检查，SQL 只返回有界正文；用长链临时 DB 用例观察查询，无模型期间长事务。
- GEN-004/005 正在变化的受理入口 → 实施时只重新核对已识别接入点，沿用最终入口，保留其他任务改动；不改旧 GEN-004 工件。
- 恢复或生成未知响应导致重复费用 → 先查询确认，保持原 requestId 与 payload；新 ID 只用于明确新尝试。

## Migration Plan

1. GEN-004 内核稳定后先修改已有受理历史查询和相应测试，无需 GEN-007；不增加表、依赖或历史数据迁移，不删除消息。
2. 用真实临时 DB/受控 SDK 完成血缘、预算、冻结文件、parent/max+1、重放及失败行为测试，运行 `pnpm check` 与 `pnpm build`；实际结果再记录，不能把本规划记作已通过。
3. GEN-005/006/007 与 REV-002/003 实现后接入原客户端/控制器，运行 `pnpm smoke`（含 build）及届时实际存在的事件流、候选、工作台相关专项，端口套件串行；未触及生命周期不扩大 manager 回归。
4. 实施时更新 Development 的历史资格规则和 Verification 的实际覆盖，保持原文档维护归属；将 SDK/SQLite/竞争/未知结果证据交给 REV-005 完成真实验收。
5. 回退应先停止相关活动、停用恢复续写 UI 并保留数据；若停用过滤，必须同时禁止恢复后续写，不能重新开放已知污染路径。保留所有版本/run/消息和当前引用，不自动恢复指针或重跑模型。
