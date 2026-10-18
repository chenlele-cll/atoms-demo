# Tasks

REV-003：历史工作台。当前仅规划，以下 13 项实施任务全未完成；用户授权限于 REV001～005 规划，不执行 apply、应用修改、提交或推送。接口、身份与验收边界见 [design.md](./design.md) 和 [spec.md](./specs/version-history-workspace/spec.md)。

命令均从仓库根目录执行。`pnpm check`、`pnpm build`、`pnpm smoke`、`pnpm smoke:template`、`pnpm smoke:projects` 已存在；`pnpm --filter @atoms/frontend test`（GEN006 计划）、`pnpm smoke:candidate`（GEN006 计划）、`pnpm smoke:workspace`（GEN007 计划）、`pnpm smoke:history`（本变更计划）目前尚未新增。下述引用这些命令均是未来验收要求，不表示已执行；应用测试不能用 OpenSpec validate 代替。组件/纯逻辑 fixture 可先开发，测试运行复用 GEN006 实际落地的 Node/tsx 入口，不另建产品工作台/预览或测试框架。

## 1. History Data And Presentation

- [ ] 1.1 实现历史列表消费客户端及边界测试，复用权威 schema 和既有超时/取消/安全错误规则，覆盖 limit=20/1..50、排他 beforeSequence、projectId/条目关联、未知字段规则、坏 JSON、超限响应、401/404/429/503；无自动重试或完整历史预取。依赖：REV001 列表契约、GEN006 共用契约/HTTP 边界。先行开发：用明确 fixture 定义客户端行为与传输适配测试。对接闸门：实际 schema、列表路由和 GEN006 客户端可用后方接生产 API，不复制 schema 或导入 backend。验收命令：`pnpm --filter @atoms/frontend test`（计划，尚未新增）、`pnpm check`；断言错误不泄露正文/会话，游标参数及取消符合契约。
- [ ] 1.2 实现历史分页与当前徽标的纯状态逻辑及测试：id/sequence 去重倒序、null 结束、加载更多失败不推进、刷新 epoch、跨页 current 校准、恢复确认后旧列表/详情 current 失效，保持阅读定位信息。依赖：1.1 的消费结果形状、GEN007 activation 约定。先行开发：纯 reducer/fixture 可独立编写并验证多页/并发新增/晚到读取。对接闸门：接入 GEN007 唯一项目状态容器和实际项目 GET，不能以各页 isCurrent 留下多个当前。验收命令：`pnpm --filter @atoms/frontend test`（计划，尚未新增）、`pnpm check`；覆盖超过 20/50 条及新版本追加，不按时间/序号大小猜 current。
- [ ] 1.3 实现历史展示组件/CSS Module 与展示 fixture，显示版本身份、时间、parent/run 关联、request=null/摘录 truncated、stored/fallback 摘要、修改路径和模板 []，支持加载/空/错误/重试、长文本展开和局部滚动；把实际新增展示规则写入 owning design skill（仅未来实施时）。依赖：1.2、atoms-frontend-design。先行开发：独立展示逻辑与 fixture，不注册临时产品页面，不使用假编译状态声称预览。对接闸门：GEN007 原工作台导航/视图实际可用后挂载，完整 fixture 渲染验证复用既有测试能力。验收命令：`pnpm --filter @atoms/frontend typecheck`、`pnpm --filter @atoms/frontend test`（计划，尚未新增）；集成后 `pnpm smoke:history`（计划，尚未新增）检查长中文/路径/纯文本呈现及阅读位置。

## 2. Workspace Selection And Preview

- [ ] 2.1 在 GEN007 原项目容器/导航中接入历史视图与 current/viewed/candidate 独立身份，选择历史只 GET，不更改 current、不丢候选；新候选保存不抢占主动历史查看，生成/采用/恢复遵循同一项目操作互斥。同步 README 的实际历史入口说明（仅未来实施时）。依赖：1.1～1.3、GEN007 壳/任务控制器与 GEN006 版本客户端。先行开发：选择 reducer、候选到达/切换 fixture 测试可先行。对接闸门：GEN007 实际路由/activation 与 REV001 实际列表可用，不做第二个工作台。验收命令：`pnpm --filter @atoms/frontend test`（计划，尚未新增）、`pnpm check`、`pnpm smoke:history`（计划，尚未新增）；仅查看时持久引用不变、零 POST/模型调用，内部视图不重启任务。
- [ ] 2.2 接入 GEN006 单版本完整 GET 与 GEN007 只读源码，详情/源码/来源/修改文件/预览始终使用同一版本和摘要，文件消失回 entry；覆盖读取/校验失败及转义显示。依赖：2.1、GEN006 完整版本读取与 GEN007 源码组件。先行开发：详情 key、文件选择、错误和转义输入 fixture 测试可先行。对接闸门：真实完整快照读取和源码组件可用，列表不能替代完整快照，不能从当前模板补齐。验收命令：`pnpm --filter @atoms/frontend test`（计划，尚未新增）、`pnpm check`、`pnpm smoke:history`（计划，尚未新增）；比较实际文件/摘要，HTML 只显示文本，错误时不能恢复。
- [ ] 2.3 将历史选择绑定唯一 GEN006 SnapshotPreview，接入 project/activation/version/digest/attempt 隔离和恢复门槛，覆盖 A→B→A、abort 后晚到、旧 done、其他窗口消息、load/connected、60 秒超时、编译/运行错误、重试/导航失效及输入重置提示；补充相应逻辑测试。依赖：2.2、GEN006 实际预览状态与清理。先行开发：预览状态消费和过期反馈 fixture 可先行，不实现 SDK 第二套监听。对接闸门：SnapshotPreview 真实编译及受限 iframe 验证通过，未满足则不能完成 UI 任务。验收命令：`pnpm --filter @atoms/frontend test`（计划，尚未新增）、`pnpm smoke:history`（计划，尚未新增）、`pnpm smoke:template`；真实错误不能启用恢复，同一时间仅一个活动预览，旧成功不能开启新目标操作。

## 3. Restore Confirmation And Recovery

- [ ] 3.1 实现恢复确认状态与可访问对话框，固定目标/expected/digest/attempt，只有本轮真实 compiled 无已知错误后可确认；目标已当前不发写入，取消/身份变化/当前变化/预览错误撤销确认，提示其他历史保留及业务临时输入可能重置。依赖：2.1～2.3、REV002 目标规则。先行开发：确认 reducer/展示 fixture 和重复点击测试可先行。对接闸门：GEN006 实际预览及 GEN007 壳可用后绑定真实门槛，不把本地 compiled 当后端可信验证。验收命令：`pnpm --filter @atoms/frontend test`（计划，尚未新增）、`pnpm check`、`pnpm smoke:history`（计划，尚未新增）；确认恰好一次、Escape/取消无 POST、焦点返回触发器。
- [ ] 3.2 实现 REV002 restore 消费客户端/控制器及协议测试，strict 仅发送 `{expectedCurrentVersionId}`，验证 projectId/currentVersionId/updatedAt/alreadyCurrent，独立处理 CURRENT_VERSION_CONFLICT、PROJECT_BUSY、RUN_STATE_UNCONFIRMED、安全存储失败；恢复模板/祖先/分支不使用 adopt parent/availability 门槛。依赖：3.1、REV002 权威 schema/事务及 GEN005 活动状态。先行开发：固定载荷和响应分支 fixture 测试可先行。对接闸门：REV002 实际路由/CAS/幂等/busy 检查可运行；不得自行实现恢复 API、强行取消任务或换 expected 自动重发。验收命令：`pnpm --filter @atoms/frontend test`（计划，尚未新增）、`pnpm check`、`pnpm smoke:history`（计划，尚未新增）；parent 不等 expected 的合法恢复可成功，其他历史保留且零模型调用。
- [ ] 3.3 实现未知恢复结果的单次 GET 项目确认和手动查询入口：断线/超时/坏响应不假定回滚，目标已当前确认事实，不同当前显示实际引用及未确认，查询失败保持 unknown；按 activation/operation/事实 epoch 拒绝迟到回调。依赖：3.2、GEN006/007 项目客户端。先行开发：丢响应/查询失败/迟到和双标签状态 fixture 测试可先行。对接闸门：真实 GET 项目与 restore 可用后验证持久事实；unknown 阶段不得自动重发写入或提交新生成，明确再操作需新鲜预览和确认。验收命令：`pnpm --filter @atoms/frontend test`（计划，尚未新增）、`pnpm smoke:history`（计划，尚未新增）；捕获请求证明无自动 POST，GET 不同目标不能被解释为原写入永不会发生。
- [ ] 3.4 接通恢复成功后的工作台校准/当前徽标/源码预览身份及草稿保留，覆盖有效 POST 后 GET 失败与 GET 发现其他当前、401 失效清理、404 失效目标和刷新/直达无自动认领；同步 README/Development 中实际 UI 确认与未知语义（仅未来实施时），向 REV004 提供已确认 current 基线但不实现续写。依赖：3.3、1.2、GEN007 当前项目状态。先行开发：校准/权限/草稿隔离 fixture 可先行。对接闸门：GEN007 实际会话边界及真实项目/恢复 API 可用；不得把单纯编译或本地点击显示成已恢复。验收命令：`pnpm --filter @atoms/frontend test`（计划，尚未新增）、`pnpm check`、`pnpm smoke:history`（计划，尚未新增）；刷新从服务端重建引用，未知/401 无缓存冒充、无生成或恢复自动重放。

## 4. Local Integration And Handoff

- [ ] 4.1 新增局部 `pnpm smoke:history` / `scripts/history-smoke.cjs`，并同步 Verification 的覆盖/前提/产物（均尚未新增，仅未来实施），复用 Chrome/playwright-core、真实临时 SQLite 和所属服务；覆盖可见历史分页→源码→真实编译/业务操作→明确恢复、合法分支/模板、并发 CAS/busy/unconfirmed、故障回滚、丢响应/查询失败与刷新/所属后端重启；不创建产品假模型开关或测试工作台。依赖：1～3 全部真实接入、REV001/002 与 GEN006/007 实际可用。先行开发：runner 归属/fixture 数据及场景代码可先写；真实 UI 正向断言不可先标通过。对接闸门：原工作台、外部 bundler/下载网络、实际恢复事务和隔离进程入口就绪。验收命令：`pnpm build`，随后 `pnpm smoke:history`（计划，尚未新增）；记录 fixture、实际编译/交互和持久化证据，零模型调用，仅清理本次进程/DB，端口冲突不停止占用者。
- [ ] 4.2 完成同一工作台的桌面 1280px、320/375px 与键盘局部验收，覆盖长文本/路径、分页滚动、加载/空/无权限/错误/超时、视图标签、44px 控件、焦点可见、确认焦点约束/恢复、业务临时输入重置告知，补充 4.1 的运行浏览器断言与设计规则证据。依赖：4.1、1.3、2.1～3.4。先行开发：布局组件 fixture 与断言可先写。对接闸门：原工作台和真实 SnapshotPreview 可运行，fixture 截图不能替代实际历史恢复流程。验收命令：`pnpm smoke:history`（计划，尚未新增）、`pnpm check`；实测宿主无横向溢出、源码局部滚动，键盘可确认/取消，重试与旧反馈不误启恢复。
- [ ] 4.3 串行执行局部整合及受影响回归并按实际差异记录交接，向 REV004 交确认基线/错误语义，向 REV005 交 fixture、编译/恢复/重开证据与未验证范围，不把真实模型续写或跨 REV 完整验收收进 REV-003。依赖：4.1～4.2 全部通过及上游回归入口真实存在。先行开发：证据字段与交接材料骨架可先准备，结果不得预填。对接闸门：GEN006/007 真实集成及本地网络/浏览器/空闲端口具备，否则准确记录阻塞。验收命令：`pnpm check`、`pnpm smoke`（含 build）、`pnpm smoke:template`、`pnpm smoke:projects`、`pnpm smoke:candidate`（计划，尚未新增）、`pnpm smoke:workspace`（计划，尚未新增）、`pnpm smoke:history`（计划，尚未新增），端口套件顺序运行；最后 `pnpm openspec validate rev-003-history-workspace --strict --no-interactive` 和 `pnpm openspec status --change rev-003-history-workspace`。已验证且源码未变的上游证据可按 Verification 复用；本任务不授权 apply、提交、推送或归档。

## Frozen Selection Scope

The planning statements above are retained as historical planning context. Prepared from fe75e5d on main: the first batch selects history UI/API/controller and all three frontend test files, including inherent REV-004 continuation guards. The dependent second batch selects browser fixture scripts, only the smoke:history root command, documentation and these artifacts. Once both batches are committed, these implementation files are in scope; preparation itself performs no staging, commit or push.

No tests, build, install, lint, typecheck, smoke, OpenSpec validation or other verification commands were run. All 13 REV-003 tasks remain unchecked; source inclusion is not acceptance or completion. Existing REV-004 results remain historical mixed-workspace evidence, with no new validation claimed. REV-005, real-model business quality and deployment acceptance remain separate.
