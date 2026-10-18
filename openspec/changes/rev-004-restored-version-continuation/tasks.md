# Tasks

REV-004：恢复确认后的版本续写。2026-10-18 已实施并完成受控 SDK、SQLite 和浏览器验证；实际命令、失败尝试及 REV-005 交接见 [evidence.md](./evidence.md)。依据 [design.md](./design.md) 和 [spec.md](./specs/restored-version-continuation/spec.md)；不修改 GEN-004 旧规范工件。

## 1. Baseline History

本组依赖可运行的 GEN-004 内核及 GEN-003 存储，不需要 GEN-007、公开 restore 或真实模型凭据。

- [x] 1.1 在既有受理短事务中按冻结基线自身及 parent 链筛选同项目 succeeded run 的 user/assistant 消息，校对 result/base 与版本 parent；用真实临时 DB 的 T→A→B、兄弟 C、无 run、failed/cancelled/interrupted/running、跨项目哨兵验证资格，模板基线为空，直接恢复成功但此前未采用版本也能选入自身历史。
- [x] 1.2 在血缘筛选后取最近 10 条，再沿用 UTF-8 16 KiB 整条选择、升序及受理前 totalHistory 省略数；以超过 10 条无关新消息、多字节边界、不从第 11 条补位和独特当前 prompt 验证实际 SDK 初始请求内容及需求一次，保持累计 256 KiB 检查。
- [x] 1.3 对同项目 parent 链的缺失、循环或非法终点安全失败，不回退全项目历史；用自有损坏及长链临时 DB fixture 验证有限结束、零 SDK 调用及无受理部分写入，运行 `pnpm --filter @atoms/backend test`。
- [x] 1.4 在实施阶段更新 Development 的历史资格规则及 Verification 对应内核覆盖，说明无关联/其他分支消息仅从模型历史排除而不删除；核对文档与实际请求行为一致，运行 `pnpm check` 和 `pnpm build`，不修改旧 GEN-004 工件。

## 2. Frozen Continuation

本组复用原生成入口、工具闭包和候选事务，仍无需完整 UI。

- [x] 2.1 用真实 SDK 的受控 list/read/submit 验证恢复 A 后读取 A 的独特文件正文并进入后续请求，候选 D.parent=A、sequence=全项目 max+1、current=A、previewStatus=unverified；比较旧版本完整快照/digest/parent/sequence、旧 run 与消息在生成前后及 SQLite 关闭重开后不变。
- [x] 2.2 保留 inspectGeneration 优先重放顺序，以恢复后重放 B 原请求验证原 run/候选、零新增请求/消息/版本及未知指标 null；改变原 requestId 的 base 或 prompt 验证 REQUEST_CONFLICT，明确失败后的新 ID 可独立受理且没有自动重试。
- [x] 2.3 扩展恢复基线下的模型拒绝/截断、文件校验、取消/超时、提交阶段 current 改变、候选/摘要/终态存储故障用例；验证失败不回写 current、不留部分成功、终态未确认如实返回，第二连接在模型等待期间可写，运行后端测试及 `pnpm check`。

## 3. Confirmed Submission

本组等待 GEN-005/006/007 和 REV-002/003 的实际入口；不得为提前实施新增替代 API、恢复 UI 或生成引擎。

- [x] 3.1 将 REV-003 恢复确认接到 GEN-007 原需求控制器，查询服务端 currentVersionId 后仅在用户明确提交时走原 `POST generations {requestId,baseVersionId,prompt}`；用客户端状态测试和实际浏览器请求计数验证恢复/预览/刷新零生成、未知恢复禁提交、当前变化保留草稿且不自动换基线，查看候选沿用原限制。
- [x] 3.2 与 GEN-005/REV-002 共用项目活动及持久 running 检查，保留受理和保存事务基线校验；以真实网络和临时 DB gate 验证恢复先完成时旧 base 拒绝、生成先受理时 restore busy、无执行者 running 为 unconfirmed、两标签竞争不会静默改基线或产生第二次计费。
- [x] 3.3 复用 GEN-006/007 候选预览与明确 adopt/unknown 查询，在续写保存后保持 current 为恢复版本；以实际浏览器验证明确 adopt 后才切换、断流仅查询原 requestId、未知不分配新 ID 或重新计费、刷新重开一致，更新 Verification 与实际使用说明中的依赖和限制。

## 4. Integration Handoff

- [x] 4.1 依赖就绪后串行运行 `pnpm smoke`（含 build）及届时已实现的 generation-stream/candidate/workspace 相关专项，覆盖恢复→确认→明确续写→实际预览交互→明确采用→重开，并记录 fixture、实际命令/结果和未通过项；仅在触及生命周期时增加对应回归。
- [x] 4.2 向 REV-005 交付实际 SDK 历史/工具请求、parent/max+1、immutable old 数据、失败不改 current、恢复零生成和未知零新增计费的证据矩阵，以及真实模型待验范围；执行 scoped `pnpm openspec validate rev-004-restored-version-continuation --strict --no-interactive` 与 status，完整真实验收只由 REV-005 收口，不把规划/fixture 标为 live。

## Frozen Frontend Selection Scope

Prepared from fe75e5d on main. This second batch depends on the first history UI/API/controller batch, which includes the inherent REV-004 confirmed-GET continuation guards and frontend/test/restored-continuation.test.ts. The first batch must be committed before this batch is staged. With both batches committed, frontend integration is included rather than deferred; this note does not claim they have already been committed during preparation. Browser fixtures, smoke:history and scoped documentation are included in this second batch.

All historical evidence and checked REV-004 tasks above are retained from the full mixed working tree on 2026-10-18, not accepted as results for this frozen selection. No tests, build, install, lint, typecheck, smoke, OpenSpec validation or other verification commands were run during preparation. REV-003 tasks remain unchecked; no live or deployment acceptance is asserted. The backend-only scope at fe75e5d remains in Git history; this note supersedes its frontend deferral only when both prepared batches are committed.
