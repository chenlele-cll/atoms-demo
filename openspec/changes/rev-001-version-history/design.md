# Design

## Context

动机见 [proposal.md](./proposal.md)，行为见 [version-history](./specs/version-history/spec.md)。GEN-003 已实现五张表及项目/消息 API；versions 有项目内唯一 sequence、parentVersionId、完整快照和不可变触发器。generation_runs 的 resultVersionId 与 messages.runId 能关联代码和消息，但没有曾采用日志；当前引用只在 projects.currentVersionId。`backend/test/project-store.test.ts` 已覆盖真实文件、内部 fixture 候选、不可变约束和关闭重开，可扩展相同模式。

工作树另有 GEN-004/005 的进行中生成代码，不将文件存在记为整项交付。GEN-006/007 的完整版本读取、共享契约、预览与工作台仍是对接依赖。长期 specs 当前为空，本 change 不修改其他 GEN/REV 工件或已有未提交代码。

## Goals / Non-Goals

**Goals:**

- 在现有持久关系上获得稳定分页与真实修改摘要，无需模型配置、工作台或新服务。
- 明确缺失旧关联、损坏数据和当前引用变化的不同语义，给 REV-003 提供单一可消费契约。
- 限制正文读取、响应大小与查询范围，避免一次加载全部历史和全部代码。

**Non-Goals:**

- 不实现单版本完整读取、adopt、restore、UI、Diff、全文检索、分支管理或已采用日志。
- 不新增依赖、模型摘要调用、可信 compiled/verified 标记或产品测试入口。
- 本轮只规划；应用实现与文档能力状态更新留到后续明确实施阶段。

## Decisions

### 1. Public Contract And Ownership

新增 `GET /api/projects/:projectId/versions?limit=20&beforeSequence=N`。projectId 为 UUID，query strict；limit 使用规范十进制整数字符串，默认 20、1..50；beforeSequence 为可选非负安全整数，排他 `<N`，0 合法且结果为空。拒绝重复、负数、小数、指数形式和额外参数，不复用项目按时间编码的 cursor。

| 字段 | 语义 |
| --- | --- |
| projectId / currentVersionId | 本次一致读取时的项目与当前引用 |
| items | sequence 倒序的轻量条目，最多 limit 项 |
| nextBeforeSequence | 有剩余项时为最后返回项的 sequence，否则 null |
| item.id / sequence / parentVersionId / kind / createdAt / isCurrent | 版本身份、代码来源、时间及本响应当前标记 |
| item.runId | 唯一合格的同项目 succeeded 结果运行，缺少时 null |
| item.request | `{messageId,excerpt,truncated}` 或 null，仅该运行的需求 |
| item.summary | `{source:'stored'|'fallback',text}`，不代表编译或业务结论 |
| item.changedFiles | 相对自身父快照的排序路径数组，模板 [] |

GET 默认 60 次/分钟/IP，429 含 Retry-After，不计模型配额；复用有效会话、owner、安全错误与 no-store。缺会话 401、不可访问/不存在项目同形 404、参数 400、存储 503、损坏 500。查询不初始化会话，不改变 updatedAt。成功 JSON 编码后上限 1 MiB，超限以安全数据错误终止，不静默截断路径或返回部分页。REV-003 客户端沿用同一上限。

权威 schema 按实施时实际位置扩展：若 GEN-006 已提取 `@atoms/contracts` 则在那里维护，否则沿用现有后端来源；后续提取移动同一来源而非复制兼容层。GEN-006 保持 `GET .../versions/:versionId` 与 adopt，REV-002 独占 restore；历史列表不提供 adoptionAvailability 或 restoreAvailability，实际写入必须重新校验。

### 2. Keyset Pagination And Consistent Reads

先鉴权，在同步只读事务中读取项目当前引用、按 project_id 和 sequence 查 limit+1 个轻量版本头，再对本页 limit 项组装元数据。事务内不包含网络、模型、代码执行或写入；同次读取的 current 和 isCurrent 一致。版本唯一序号使新追加项不会造成旧页重复/遗漏，相比 offset 不受新增影响，相比 createdAt 不需要同毫秒的额外排序键。

分页只约束已存在且更旧的不可变版本，不提供跨 HTTP 请求的数据库快照租约。新版本需刷新第一页可见；每页返回当下 current，消费方收到新响应后须重新计算已有项的当前徽标，不能累积各页 isCurrent。模板 always sequence=0，合法项目至少包含模板；游标可使页为空，不代表项目无历史。

### 3. Run And Message Attribution

对 generated 版本只接受 project/result/base/status 相符的唯一 succeeded run：result=版本、base=parent、项目相同，使用现有 runSchema 检查终态。无合格关联的旧数据仍列出，runId/request=null、fallback 摘要；存在指向目标但终态或 base 矛盾、多重合格关联则视为 DATA_CORRUPT，不能随意选一个。模板不关联生成 run。

关联消息按 sequence 确定：最早 user 提供 request，最后 assistant 提供 stored summary。消息缺失或内容无法通过既有消息契约校验时，前者缺失可返回 null，实际存在但损坏则整页安全错误；不能把其他 run 或最新项目消息冒充对应需求。摘录与摘要各取前 240 个 Unicode 码点，保留有效字符，不在半个代理对截断；request.truncated 表示原文是否更长，不附加会消耗预算的自动省略号。完整需求可由已有对话读取能力查看，列表不额外返回整段正文。

stored 只说明摘自已存 assistant 消息。缺少时模板使用「模板起点」，generated 使用「已保存生成快照；预览状态以实际预览为准」的 fallback；无需新增消息或调用模型，不能把这种说明标为模型业务摘要。GEN-004 已存事实摘要照常作为 stored，不将其内容重新解释为可信验证。

### 4. Snapshot Comparison And Bounded Work

一次仅读取、解析一项自身快照及父快照，复用现有 64 文件/2 MiB、路径、历史身份和摘要验证；完整结果中不携带这些正文。不用 SELECT 全部 snapshot_json 后常驻内存，不跨全项目逐个加载。页内最多处理 50 项，读取历史自身内容，不依赖当前 catalog 或当前引用。

修改路径是父/子文件键并集内正文不同的项，包括未来历史可能已有的新增、删除，排序使用明确的稳定字典序。当前生成工具禁止删除并不意味着历史比较可以忽略缺失文件。模板 []，不将模板全文件列为用户改动。优先复用 GEN-006 最终实现的纯比较规则；如其尚未落地，只在具体版本读取模块提供实际需要的纯函数，后续共用，不让 storage 导入生成编排/模型客户端，也不另建通用 Diff 框架。

父版本不存在、跨项目、序号关系或快照不合法为 DATA_CORRUPT；缺成功 run 与坏关联分开处理。若后续 GEN-006 对同一快照得出不同 changedFiles，应修正共享实现，不能靠两套规则兼容差异。查询计划使用已有 `UNIQUE(project_id,sequence)`，关联 run/message 的 result/run 条件若需索引，通过真实长历史样本与 EXPLAIN 核实后增加新迁移，版本号实施时接续当前最大值，不重写已有迁移或假定并行任务尚未加版本。

### 5. Early Work And Integration Gates

GEN-003 足以完成后端 schema、store、route 和行为测试，不依赖生成活动 Map；只读查询不会与恢复/生成争夺当前写入准入。先行阶段复用既有内部 fixture 方法建立明确测试快照和运行，不向生产加入假模型配置或公开写入版本接口。

REV-003 消费列表前，确认 GEN-006 的公开 schema 实际归属、完整版本读取及修改比较已接通。REV-002 恢复改变 current 后列表自然读到新事实，不新增恢复副本。REV-004 创建的新分支按全项目递增序号排列，同时 parent 保留真实代码来源；列表顺序不等于版本祖先顺序。REV-005 再验证真实 UI/模型闭环，本任务不代勾它们。

### 6. Verification And Documentation

复用现有 Node 测试器与临时真 SQLite：模板、成功/缺消息/无关联候选、同父兄弟、恢复后旧 current、同毫秒、超过 50 项、页间真实第二连接新增/切换、Unicode 截断、损坏/矛盾关系、比较新增/删除/修改，以及关闭重开；检查持久数据和模型调用不变。损坏样本只用自己的隔离库，不能操作开发数据。

Fastify injection 覆盖真实 cookie、A/B 会话、严格 query、输出投影、no-store、限流、存储故障和安全错误；断言响应没有 files/snapshot/owner/token/全文。计数和持久快照比较证明无写入，不用固定 UI 文案测试替代行为。最大页样本验证有界响应/内存策略，不引入无依据的毫秒性能承诺。

实施后运行聚焦后端测试、`pnpm check`、`pnpm smoke`（含 build）和受影响 `pnpm smoke:projects`，端口套件顺序执行。没有前端改动不增加本任务的浏览器历史页面验收，REV-003/005 另负责。未来更新 README 的实际 API 可用范围及 Development/Verification，不将 Top 2 整体标成已完成。规划阶段仅严格校验与差异/链接检查。

## Risks / Trade-offs

- 计算一页修改文件需要读取多份快照 → 50 项上限、逐项处理、复用严格体积验证和响应上限；不预取全历史。
- 历史无 run 或缺消息 → 明确 null/fallback，不伪造需求，不影响其他有效条目；矛盾和损坏仍失败。
- current 跨页改变 → 每页给同次事实，REV-003 统一校准徽标，不把序号最大者当当前。
- GEN-005/006 与迁移仍在变化 → 实施前重读具体来源，接续新迁移与单一 schema，保留并行工作，不复制类型或改旧工件。
- 摘要文字可能包含未验证主张 → stored 是来源标识，界面不能据此展示可信编译/业务验收徽标。

## Migration Plan

1. 后续获得实施指令后先完成权威契约、只读 store 查询、文件比较和真实数据库测试；必要索引以新迁移增加，不回填或改写历史。
2. 接入现有项目路由和 injection 测试，不更改既有接口；验证不依赖模型配置、catalog 补齐或 GEN-005 执行者。
3. 对齐 GEN-006 公开来源与单版本比较，向 REV-003 提供 DTO、分页及缺失/错误语义，再按任务运行相关检查并记录实际证据。
4. 回退仅停用新增列表路由并撤回应用产物，保留版本、对话、当前引用和索引数据；不删库或将当前切回模板。
