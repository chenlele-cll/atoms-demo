# Proposal

## Why

REV-001 为 Top 2「对话修改与版本恢复」提供可检查的历史入口：用户需要知道每个已存版本来自哪次需求、修改了哪些文件，以及哪个版本当前生效。现有 GEN-003 已保存不可变快照、父版本、消息与生成结果关联，但尚无历史列表；可先利用这些真实数据开发查询，再对接仍在推进的 Top 1 预览与工作台。

## What Changes

- 新增有归属的 `GET /api/projects/:projectId/versions`，按项目内 sequence 倒序分页，返回当前引用和轻量版本元数据，不返回代码正文。
- 为每项提供父版本、时间、类型、成功运行关联、对应需求摘录、标明来源的简短摘要及相对父快照计算的修改文件路径。
- 明确模板、无关联旧数据、分页期间新增版本/切换当前引用、损坏数据与访问隔离的行为；查询不调用模型、不执行代码、不改变项目。
- 保留 GEN-006 对单版本完整读取、预览和 adopt 的所有权；REV-002 负责 restore，REV-003 消费列表，REV-004 负责恢复后续改，REV-005 负责跨任务验收。
- 本轮只创建规划，所有实施与运行验收留在 tasks；不实现恢复、UI、逐行 Diff、采用日志或可信验证状态。

## Capabilities

### New Capabilities

- `version-history`：有归属、稳定分页、可追溯至需求与实际文件变更的版本历史查询。

### Modified Capabilities

无。当前 `pnpm openspec list --specs` 未发现长期规格；在途 GEN-003/006 的职责仍保持，不另建完整版本读取能力。

## Impact

- 后端：项目权威契约、`storage/store.ts`、`routes/projects.ts`、错误投影与对应 Node/SQLite/HTTP 测试。
- 契约：优先扩展实际权威来源；GEN-006 提取 `@atoms/contracts` 后沿用其定义，不复制 schema 或抢先另建共享包。
- 数据：复用 versions、generation_runs、messages、projects；如关联查询确需索引，仅通过新的有序迁移增加，不改写既有迁移和历史数据。不增加运行依赖或模型调用。
- 对接：查询不依赖 GEN-005 的模型执行者，可先行完成后端；GEN-006 的快照比较规则及最终公开契约须对齐，浏览器接入交给 REV-003。
- 验证：临时真实 SQLite、Fastify injection、关闭重开与相邻分页期间的真实第二连接写入；实施时更新 Development/Verification 的实际契约与覆盖。规划校验不代表产品已实现。
