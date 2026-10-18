# Proposal

## Why

恢复历史版本后，下一条需求应修改已确认的服务端当前快照。现有生成内核从整个项目取最近消息，会把已离开的未来分支需求重新当作现状，必须在构造模型上下文前按版本血缘过滤，不能只靠提示词警告。

## What Changes

- REV-004 复用 GEN-004 内核，以及 GEN-005 规划的 `POST /api/projects/:projectId/generations {requestId,baseVersionId,prompt}`；恢复确认后仅由用户明确提交新需求，不增加生成入口或引擎。
- 基于本轮冻结基线自身及其 parent 链，筛选关联成功生成 run 的 user/assistant 历史，再应用既有最近 10 条、16 KiB 与序号规则。排除其他分支、失败/取消/中断、无 run 关联及无关未采用候选的消息，保留全部持久历史；模板基线不带祖先生成历史。
- 工具读取冻结数据库代码；新候选 parent 指向恢复版本，sequence 使用项目全体版本 `max+1`。保存仍不采用，继续通过 GEN-006 明确 adopt。
- 保持原 requestId 重放、失败明确重试、费用未知、短事务、失败不改 current 的语义。恢复与生成竞争必须拒绝，不自动换基线。
- 先交付无需 GEN-007 的内核上下文与真实临时 SQLite 行为测试；HTTP/UI 集成等待 GEN-005/006/007 与 REV-002/003 实现，REV-005 负责整个真实验收。

本次仅创建规划工件，所有实施任务未完成。观察到 GEN-003 已实现，GEN-004 正在实施且已有内部生成入口；GEN-005/006/007 仅规划。其旧工件中“尚无数据库”等历史表述不能作为当前事实，本 change 不修改这些工件。

## Capabilities

### New Capabilities

- `restored-version-continuation`: 已确认恢复版本上的明确续写、按基线血缘隔离模型历史、不可变分支保存及安全竞争/重放。

### Modified Capabilities

无。当前 `pnpm openspec list --specs` 无长期规格；本能力细化恢复后的生成行为，不修改旧 GEN-004 规范工件。

## Impact

未来实施涉及 `backend/src/storage/store.ts` 的受理历史查询、`backend/src/generation/context.ts` 与 `service.ts` 的上下文接入，以及既有 `backend/test/generation-integration.test.ts` 和受控 SDK fixture。无需新依赖、生成 API、数据库表或历史删除。

跨 change 约定：REV-001 只提供历史列表元数据，不记录曾采用或可信验证；REV-002 的 `POST /api/projects/:projectId/versions/:versionId/restore {expectedCurrentVersionId}` 只切换当前引用，目标为模板或关联 succeeded run 的生成版本，使用 CAS、busy/unconfirmed，且不要求 target.parent 等于 expected；不创建快照或删除消息。REV-003 负责先预览后明确恢复并复用 GEN-006/007；REV-004 只消费确认后的当前 ID 和原生成/候选采用链路；REV-005 收口真实模型、浏览器及重开验收。相关 REV 规划可能由其他任务并行创建，此处仅记录消费契约，不编辑其目录。
