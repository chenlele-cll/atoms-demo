# Tasks

REV-001：历史版本查询与变更摘要。以下任务仅在实际完成并取得对应验证后勾选；尚未接通的跨 REV 验收保留未完成。完整契约见 [design.md](./design.md) 与 [version-history](./specs/version-history/spec.md)。实施与验证证据见文末。

## 1. Contract And Pagination

- [x] 1.1 在实施时的单一权威来源定义 strict query、历史 item/response 和上限 schema，覆盖 UUID、limit 默认/1..50、非负安全 beforeSequence、null/fallback 和字段投影；同步 Development 的实际 HTTP 契约。先行：GEN-003 可用即可；GEN-006 已提取则沿用其中立包。验证：现有后端 Node 测试覆盖非法、重复、额外参数与未知响应，`pnpm --filter @atoms/backend typecheck` 通过；无重复 schema。
- [x] 1.2 实现 store 的归属只读分页与同次 current 标记，按 sequence DESC 和排他游标取 limit+1 版本头；同步添加真实临时 SQLite 测试。先行：不依赖模型和执行者。验证：同毫秒、空末页、模板序号 0、超过 50 项、同父兄弟、较旧 current，以及页间第二连接新增/切换，已有更旧项不重不漏且每页标记一致。
- [x] 1.3 验证并完成关联查询所需的索引；仅有真实需要时通过接续当前版本的新迁移增加，不重写旧迁移。先行：与其他任务当前迁移核对后即可。验证：真实长历史库的 EXPLAIN/查询结果、有界单页、已有数据库升级/关闭重开与迁移幂等；若无需迁移，记录实际复用索引的证据，不创建空迁移。

## 2. Attribution And Changed Files

- [x] 2.1 组装唯一 succeeded run、最早 user 摘录及最后 assistant 摘要，缺关联或缺消息按 null/fallback 返回，实际矛盾/损坏安全失败；添加 Unicode 240 码点、truncated、多消息、无关运行和损坏样本测试。先行：现有 GEN-003 fixture 足够。验证：对应 Node 行为测试检查精确消息 ID/运行关联和省略边界，不调用模型、不写回摘要，不以模板/其他运行冒充需求。
- [x] 2.2 实现或复用实际版本读取中的纯 changedFiles 比较，逐项校验自身/父快照，稳定排序新增/删除/内容修改路径，模板 []；不依赖当前模板/current 或生成编排。先行：可使用已有 snapshot 规则；对接：与 GEN-006 实际比较函数统一。验证：父与 current 不同、兄弟分支、文件增删改、身份/摘要/父引用损坏和正常模板的临时库用例，与单版本读取结果一致。
- [x] 2.3 将关联/比较接入单页读取，保证逐项处理和最终 1 MiB JSON 上限，避免全项目快照常驻内存或静默截断。先行：1.2、2.1～2.2 后。验证：最大页/大快照样本检查条目/文件路径完整、超限明确安全失败、不会读取页外历史全部正文；聚焦测试经现有 `pnpm --filter @atoms/backend test` 运行。
- [x] 2.4 完成只读/重开/故障保护行为测试，并在 Verification 记录本阶段实际覆盖。先行：2.3 后。验证：重复查询前后项目 updatedAt/current、完整版本/消息/run 内容一致，关闭重开历史一致；自己的损坏库和失败注入返回安全错误且无秘密哨兵泄露，模型请求增量为零。

## 3. HTTP And Consumer Integration

- [x] 3.1 在现有项目路由接入 GET 历史，复用会话/owner/no-store/安全错误，添加 60 次/分钟/IP 独立限流；更新 README 的实际 API 范围，不宣称完整 Top 2。先行：不依赖 GEN-005 活动管理。验证：Fastify injection 通过真实 cookie 覆盖 A/B 会话、缺会话、未知项目同形 404、strict query、响应投影、Retry-After、存储故障和 1 MiB 上限，捕获输出无代码/完整对话/owner/token/SQL。
- [x] 3.2 对齐 GEN-006 最终权威 schema 和单版本读取的修改比较，向 REV-003 交付 DTO、1 MiB 上限、分页/current、null/fallback 与错误语义，保持列表和详情接口分工。对接：GEN-006 实际公开来源/完整版本读取存在后核对；先行代码只维护一个来源，不复制浏览器类型。验证：实际共享契约 typecheck/build、相同版本两接口 changedFiles 一致；依赖未就绪时只记录先行阶段通过，不能勾选对接完成。
- [ ] 3.3 验证列表能消费旧 current 与恢复后新分支并补齐相应 HTTP 测试，不实现 REV-002/004。先行：自有内部 fixture 可验证数据形状；对接：REV-002/004 可用后复核其真实结果。验证：恢复不加版本，新增分支 sequence 继续递增而 parent 指向恢复目标，列表 current/关联正确，查询无额外模型调用；不以内部指针 fixture 声称 restore/续改已交付。

## 4. Integration And Handoff

- [ ] 4.1 完成相关整体检查：`pnpm check`、`pnpm smoke`（含 build）、`pnpm smoke:projects` 顺序执行，不重复 build、不停止已有实例；按 Verification 记录实际差异/命令/退出码和未验证边界。依赖：1～3 的实现/测试与必要对接完成；正常查询不需真实凭据。验证：工程/既有项目回归通过，本任务不增加历史 UI 或付费模型验收，未变化的其他专项证据按规则复用。
- [ ] 4.2 核对实际 API/覆盖文档和交接材料，向 REV-003/005 提供分页、归属、版本关联/变更路径及无副作用证据，运行 `pnpm openspec validate rev-001-version-history --strict --no-interactive`、`pnpm openspec status --change rev-001-version-history`、相对链接及 scoped 差异检查。依赖：4.1 和 GEN-006 对接证据；全部实施完成后才勾选，不代勾其他任务、不自动归档或提交。

## Implementation Evidence

2026-10-18：按用户「实现 REV-001」实施先行能力，未提交或归档。复用进行中的 GEN-006 `@atoms/contracts` 和 store.candidate，不复制快照校验/比较或创建另一个公开读取入口。实现 `ProjectStore.listVersions` 和已有项目路由下的 GET 历史；新增 v3 两个索引，旧数据无回填。列表 JSON 体积和条目关联在共享 schema 中验证；两份最多 64 文件快照的变化路径联合上限为 128，已用真实 118 路径样本验证列表和单版本 GET 一致。

新增 `backend/test/version-history.test.ts` 的 16 项主测试及 11 项损坏子场景，包含 55 个同时间版本分页/第二连接追加、旧 current/兄弟关系、240 码点 emoji 边界、真实 HTTP 超限拒绝、页外损坏、父结构矛盾、succeeded 关联/消息损坏、60/min/IP、全表只读/重开、v2→v3 数据不变及实际 EXPLAIN 索引使用。source=fixture，临时真库和注入模型传输计数均证明历史读取零模型调用；未读取开发者 .env、未使用生产数据或进行付费调用。

| 已执行命令 | 实际结果 |
| --- | --- |
| Node v22.22.2 下 `pnpm --filter @atoms/backend typecheck` | 通过；修复过一次新测试 verbose 参数 unknown 类型错误 |
| Node v22.22.2 下 `pnpm typecheck` | 前端、后端、共享契约通过 |
| `pnpm --filter @atoms/backend test` | 196 项测试通过，0 失败；含 GEN-006 候选/采用回归和历史新增用例 |
| `pnpm --filter @atoms/frontend test` | 10 项通过，0 失败，验证共享契约消费未回归 |
| 本次修改代码的 scoped ESLint | 通过，无 warning |
| `pnpm check` | 未通过：当时并行新增 `scripts/candidate-smoke.cjs:157` 的两处 requestAnimationFrame 被全库 ESLint 报 no-undef；未修改该任务文件，后续步骤改为分别执行并如上记录 |
| `pnpm smoke` | 前端/后端/共享契约生产构建通过；浏览器 suite 启动前发现 3001 已被另一进程占用，退出 1，未停止占用者，不能记 smoke 通过 |
| `pnpm smoke:projects` | 端口仍被其他任务占用时未启动；等待可用后串行补跑 |
| `pnpm openspec validate rev-001-version-history --strict --no-interactive` | 通过；仅证明工件结构 |
| scoped `git diff --check` | 已修改的跟踪文件通过；新增测试与本 tasks 的 no-index 空白检查通过 |

验证所对应的源码 Git blob 摘要（`git hash-object`，不是提交）：共享契约 `0234278766f132056c5ec238c27dba8bec283e05`，store `4001eea255f87b22344c4cb6d1088a563d7e2aea`，项目路由 `b9bdbb435e403f273cebc095b2c6497d5181fa11`，迁移 `bf650c138598ae35e97a7f06d46d9655b9d497e0`，历史测试 `d8050e45a9828669545b1ac5d2b7e8a0de08d1b6`。并行任务仍可改动工作树；后续影响这些边界时重跑相关检查。

接口交接：`versionHistoryQuerySchema`、`versionHistorySchema`、`VERSION_HISTORY_MAX_BYTES` 和 `VersionHistory` 均从 `@atoms/contracts` 导出，后端重导出同一来源。REV-003 消费列表时限 1 MiB，不使用详情的 16 MiB 上限；每页 current 仅代表该次读取，跨页合并统一计算徽标。缺历史消息为 null/fallback，损坏/矛盾数据为安全错误，不依据摘要展示可信验证。README、Development 与 Verification 已同步本次实际能力和覆盖。

未完成项保留：3.3 的真实 REV-002 restore/REV-004 续改对接尚不可用，当前兄弟分支、旧 current 与第二连接样本仅证明查询行为；4.1 仍需解决全库检查/端口前提并补齐真实对接后的回归；4.2 的最终收口依赖 4.1，已有 schema/HTTP/SQLite 交接证据不能代替整项完成。完整 Top 2、历史 UI、恢复/续改、真实模型和线上均未在本任务宣称通过。
