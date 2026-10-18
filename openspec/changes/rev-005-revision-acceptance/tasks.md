# Tasks

本清单仅规划 REV-005，以下 12 项全部待实施，完成实际工作及所列验证后才勾选。范围与技术依据见 [proposal.md](./proposal.md)、[design.md](./design.md) 和 [revision-acceptance](./specs/revision-acceptance/spec.md)。命令 `smoke:revision`、`smoke:revision:live` 均为未来新增；本轮不实现、不 apply、不执行模型请求、不编辑其他文件。

## 1. Cases And Dependencies

- [ ] 1.1 REV-005 准备版本化 V1 报价/案例筛选、V2 加急、恢复后 V3 维护费的公开需求与独立业务 oracle，区分 template、候选和已采用版本。验证：无模型 Node 测试核对 2300/3200/6200、加急 640/3840、维护费 3700/6700、行业筛选和非法输入；基线无新增控件，live 输入不含预写实现；在 Verification 记录需求、业务通过与编译成功的区别。
- [ ] 1.2 REV-005 对接实际 GEN-005～007 与 REV-001～004 的 DTO、错误和 UI 入口，建立历史列表/单版本读取/restore/current/parent/sequence 的具体验收映射，复用实际可用的 GEN-008/010 辅助。验证：聚焦契约测试确认倒序游标、列表无代码、恢复请求体及 busy/unknown/CAS 语义，缺依赖明确 blocked；文档记录现有与未来命令，不创建生产接口或修改其他 change 清单。

## 2. Fixture Runner

- [ ] 2.1 REV-005 实现未来无凭据 `pnpm smoke:revision` runner 与测试专用受控 SDK 传输，以工作台可见表单驱动三次生成，使用真实临时 SQLite、Chrome/playwright-core 和真实 Sandpack，不自行 build。验证：隔离环境哨兵证明不继承真实 `.env`/模型凭据/开发 DATABASE_PATH，工具往返确实发生、无外部模型调用、无预种候选或假 ready；README/Verification 说明先 build、网络与端口前置及生产无假模型配置。
- [ ] 2.2 REV-005 接入唯一 runId、输入/构建/harness 摘要、阶段/请求计数与 private/export/runtime 隔离报告。验证：控制测试拒绝旧/空/缺项/身份不符报告，缺计数为 null 而非零，fixture/live/not-run 不混淆；敏感哨兵、路径越界与截图遮罩检查通过，数据库/会话/原始日志不进入 export，Verification 记录实际证据范围。

## 3. Revision Main Path

- [ ] 3.1 REV-005 实现 V1 生成/业务检查/采用、V2 加急生成/业务检查/采用、历史倒序分页和 V1 独立预览，再取消一次恢复确认。验证：真实编译后实际操作导航、报价、筛选和加急；候选保存未自动采用，取消不发恢复，current 仍 V2；列表 current/parent/需求摘录/摘要/changedFiles 与快照关联一致、跨页不重不漏且无代码，查询/预览阶段模型请求增量为零；补齐 Verification 场景说明。
- [ ] 3.2 REV-005 实现明确恢复 V1、刷新/同库同会话后端重启、V3 需求生成和显式采用的连续场景。验证：恢复前后 V1/V2 哈希、历史数量不变，无恢复新版本且零模型调用；V3 base/parent=V1、sequence=全项目 max+1，受控 SDK 各轮上下文只含 current parent 链且排除 V2 独有分支记录，V3 维护费正确且加急不复活、旧 V2 仍可读取/预览；记录版本图和请求增量证据及临时输入重置边界。

## 4. Failure And Access Coverage

- [ ] 4.1 REV-005 在独立负向项目实现失败/取消/unknown、无效恢复目标、真实预览故障、恢复写入失败、CAS 与恢复/生成受理竞争场景。验证：真实服务/数据库触发各故障，template 或有效 succeeded 目标按契约处理，无效目标拒绝，current/历史/输入保护成立；两标签页竞争至多一个切换，失败不新增模型调用或自动换基线重发；Verification 逐项区分保护通过与业务成功。
- [ ] 4.2 REV-005 实现提交后恢复响应丢失、确认查询也失败、缓存基线过期、跨会话/跨项目拒绝及桌面/320/375px/键盘场景。验证：未知时仅查询 current/run、不自动重发恢复/生成，恢复查询可确认真实选择；他人和不存在资源响应符合所属契约，无私有泄露；实测宿主/iframe 宽度、焦点/确认取消/错误入口和导航报价筛选可用，截图结合实际观察记录，更新 Verification。

## 5. Lifecycle And Explicit Live Entry

- [ ] 5.1 REV-005 完成端口 bind 预检、专项串行、所属进程/浏览器登记、有界关闭及真实 runner 控制测试。验证：真实外部占用者保持可用；Chrome/后端已启动时分别 SIGINT/SIGTERM，十秒内停止新场景、取消在途、只清理本次资源并释放端口/临时目录，最终 cancelled 报告与 130/143 一致，清理失败不可整体通过；Lifecycle/Verification 记录归属与保留 private 数据规则。
- [ ] 5.2 REV-005 实现未来独立 `pnpm smoke:revision:live --live`，复用现有后端模型配置、正常构建入口/工作台与安全调用事实，三条新需求各由一次明确提交驱动。验证：无凭据控制测试覆盖无参数/帮助/缺 --live/非法参数/缺前置零请求，三轮最多十八次供应商请求、零自动重试/修复/探针、首错停止，恢复/查询/重开计数增量为零；默认 check/verify/CI 不触发 live，README/Verification 分开说明本地 fixture/live 与线上，GEN-009 部署范围保持。

## 6. Integrated Acceptance

- [ ] 6.1 REV-005 前置就绪后实际执行 `pnpm check` → `pnpm smoke`（已含 build）→ `pnpm smoke:projects` → 未来 `pnpm smoke:revision`，所有占端口专项串行，不重复 build；核对本次源码/构建/报告并完成桌面和窄屏实际复核。验证：主路径、负向和 runner 控制用例全部执行且清理通过，记录命令/退出码/哈希/请求数和未运行范围；执行本 change 的严格校验、相对链接检查和 scoped `git diff --check`，缺依赖或网络阻塞不勾选完成。
- [ ] 6.2 REV-005 在 6.1 通过且同构建/现有模型配置就绪后，单独显式执行一次未来 `pnpm smoke:revision:live --live`，经正常工作台完成 V1→V2→预览/恢复 V1→刷新/重启→V3，并实际复核桌面/窄屏页面。验证：业务、采用、current/parent/maxsequence、旧 V2、内容哈希、实际请求/用量和零调用阶段证据齐全；失败/取消/未知停止后续且不自动补跑，完成才确认本地 Top 2 范围并更新相应文档；线上单列未验证，GEN-009 和 Top 3 不被本地通过覆盖，再次 scoped strict validate/status 核对工件与任务的真实状态。
