# Proposal

## Why

REV-002 为项目所有者提供受保护的历史版本恢复：将当前引用切回本项目已存模板或生成快照，同时保留全部历史。现有 GEN-003 已实现不可变快照持久化，GEN-004 正在实施且已有候选保存代码，但尚无恢复入口；GEN-006 的规划采用接口仅处理符合父基线的候选，不能替代历史恢复。

## What Changes

- 新增 `POST /api/projects/:projectId/versions/:versionId/restore`，strict JSON 仅含 `expectedCurrentVersionId`，返回 `projectId/currentVersionId/updatedAt/alreadyCurrent`；通过会话、归属、结构与摘要自校验、成功运行关联、CAS 和生成活动检查后原子切换当前引用。
- 支持模板和本项目已存 generated 版本；generated 必须关联有效 succeeded 结果，不要求曾被采用，也不要求目标父版本等于 expected。当前没有采用日志，MUST 不创造“曾采用”或“已验证”的历史事实。
- 规定同目标合法重试幂等且不更新时间，竞争只允许符合 CAS 的操作成功，响应未知时查询当前事实，不自动换 expected 重发。
- 与 REV-001 列表元数据契约和 GEN-006 单版本 GET、adopt 保持边界；UI 恢复门槛由 REV-003，恢复后继续修改由 REV-004，跨任务验收由 REV-005。
- 允许先行开发 store 事务及隔离测试；生产 HTTP 注册 MUST 等待接入 GEN-005 活动执行者检查并同时检查数据库 running，不添加默认空检查后门。
- 本轮仅创建本 change 的规划工件。未来实现不执行模型或代码、不新增快照、不删除历史、不扩展 UI 或生成上下文，也不新增可信 compiled/verified 字段。

## Capabilities

### New Capabilities

- `version-restoration`：所有者在并发、运行状态未确认和响应未知情况下安全恢复已存版本，保留不可变历史与真实状态。

### Modified Capabilities

无。当前 `pnpm openspec list --specs` 无长期规格；本任务不修改其他 change 的规格，GEN-006 采用条件保持原义。

## Impact

未来实现涉及 `backend/src/contracts/projects.ts` 的权威请求/响应 schema、`backend/src/storage/store.ts` 的短事务、`backend/src/projects/errors.ts`、项目路由与生产服务组装，以及现有 Node 测试器和临时 SQLite 测试。若 GEN-006 已提取 `@atoms/contracts`，复用其权威定义，不复制规则或让浏览器导入后端实现；本任务不提前建设该包或增加依赖。

REV-001 拥有 `GET /api/projects/:projectId/versions?limit=20&beforeSequence=N`：limit 1..50、序号非负、按 sequence 倒序，返回 `projectId/currentVersionId/items/nextBeforeSequence`，无代码正文；item 为 `id/sequence/parentVersionId/kind/createdAt/isCurrent/runId|null/request{messageId,excerpt,truncated}|null/summary{source:'stored'|'fallback',text}/changedFiles`。template 的 changedFiles 为 `[]`，generated 与自身父版本比较，不声明曾采用或已验证。本任务只消费该约定，不实现列表。GEN-006 继续拥有单版本 GET 与 adopt；GEN-005 的活动执行者和数据库 running 双重保护是恢复 HTTP 上线前置依赖。
