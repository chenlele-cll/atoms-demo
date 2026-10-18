# Tasks

范围见 [proposal.md](./proposal.md)，方案与覆盖矩阵见 [design.md](./design.md)。本项仅整合工程验收，使用 skip_specs 复用既有产品规格；以下全部待实施，不勾选上游 GEN 任务。依赖 GEN-001～007 的实际入口与断言，真实模型和最终服务器仍由 GEN-010/009 验收。

## 1. 固定执行计划与隔离输入

- [ ] 1.1 GEN-008 建立 product/full 的固定套件登记、必要前置条件和覆盖标签，保留独立入口且不提供任意命令/跳过必需项开关。验证：Node 控制测试断言两种范围、缺脚本拒绝、check/build 顺序、full 不嵌套 product、live 探针永不入默认计划；在 Verification 记录实际范围及 NOT_SELECTED 含义，不新增平行任务清单。
- [ ] 1.2 GEN-008 实现本次源副本、白名单环境、offline frozen install、SQLite 绑定检查及 source/build 身份记录，不复制用户环境、数据库或 node_modules。验证：自有 Git/文件 fixture 覆盖未提交输入、排除/越界 symlink、复制期间变化、缺缓存/native 失败和原文件不变，隔离应用无需读取真实 .env；更新 README 与 Verification 的工具/缓存/原生前提。

## 2. 串行执行与有限清理

- [ ] 2.1 GEN-008 实现调度器的逐步执行、20/40 分钟初始总预算、单步上限、首错停止和非零状态，正常应用构建每次只做一次。验证：真实控制子进程覆盖非零退出、启动失败、普通超时、总预算耗尽、后续 NOT_RUN 与无自动重试，替身结果标 control-test；同步 Verification 的失败和退出语义。
- [ ] 2.2 GEN-008 复用锁库保护同仓库验收，完善真实 bind 预检及 suite 启动器的进程/浏览器归属、信号、关闭与父级收尾。验证：占用非 HTTP 端口、并发 product/full、SIGINT/TERM、detached 子进程、清理超时和未知身份场景，确认只结束所属进程、失败不继续抢端口；更新 Lifecycle 与 Verification 的实际清理边界。

## 3. 子报告、输入一致性与导出

- [ ] 3.1 GEN-008 为现有浏览器 suites 接入单一最小报告辅助，随真实断言产出 run/suite/source/build/case 结果；check/build 等命令按真实退出记录，不伪造数量。验证：缺/空/旧/身份错误/全跳过/退出矛盾报告均不能通过，负向业务结果只有预期断言成立才算 case 通过；独立 smoke 仍可运行，更新 Verification 的报告归属和示例。
- [ ] 3.2 GEN-008 完成逐步原子 summary、源码/构建变化拒绝、白名单证据导出和截图遮罩。验证：控制测试覆盖 STALE_INPUT、被改坏构建、路径穿越/符号链接、旧 runId 复用拒绝、未确认脱敏截图拒绝导出及敏感哨兵；实际检查导出摘要/截图不含凭据、输入/源码正文或私有目录，README/Verification 说明本地与可分享证据区别。

## 4. 主路径缺口与公开入口接入

- [ ] 4.1 GEN-008 按覆盖矩阵核对原 suites，缺失的创建→SDK 工具→SQLite→真实编译/控件→采用→重开连接补在相应拥有者，避免复制专项用例。验证：真实 UI 回归同时核对模型替身调用次数、版本/消息/文件和当前引用，取消/未知/归属/窄屏行为保持；不得用预种项目或假 ready 替代主路径，补充 Verification 的具体覆盖。
- [ ] 4.2 GEN-008 接入 `pnpm verify:product` 和既有 `pnpm verify`，将必要控制测试纳入 check，保留 pnpm smoke 自带构建和各专项的独立语义。验证：CLI 帮助/非法 profile 不启动验收，真实计划只选择规定入口，主输出与最终状态一致，默认无真实模型调用；README、Verification 更新实际命令、时间预算与缺前置时的行为。

## 5. CI 入口与安全产物

- [ ] 5.1 GEN-008 修改既有 CI job 使用 product/full，保留 job 名称、固定 Action SHA、只读权限、无应用 secrets 和七天保留；按唯一合法 runId 上传本次 export，并设置初始 25/45 分钟 job 上限。验证：使用既有 YAML/表达式校验方式与固定输入核对，测试 artifact 路径和失败导出不掩盖非零结果，记录本地等价证据；更新 Verification，未执行的 hosted run 明确未验证，不自动提交/推送或触发远端。

## 6. 实际集成验收

- [ ] 6.1 GEN-008 在前置能力就绪后执行一次完整 `pnpm verify`，再用不同 runId 执行 `pnpm verify:product`，验证两个入口及新副本/DB/cookie 不依赖旧状态。验证：两次各只完整构建一次，所有所选必需检查/清理通过并有对应源/构建摘要、真实浏览器断言和脱敏报告；环境阻塞不勾选通过，记录实际耗时与未运行范围，执行 `pnpm openspec validate gen-008-integrated-regression --strict --no-interactive`、链接检查和 `git diff --check`，保持真实模型/部署/hosted CI 的独立状态。
