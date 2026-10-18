# Tasks

范围见 [proposal.md](./proposal.md)，方案与覆盖矩阵见 [design.md](./design.md)。本项仅整合工程验收，使用 skip_specs 复用既有产品规格；实施状态以以下复选框及本页证据为准，不勾选上游 GEN 任务。依赖 GEN-001～007 的实际入口与断言，真实模型和最终服务器仍由 GEN-010/009 验收。

## 1. 固定执行计划与隔离输入

- [x] 1.1 GEN-008 建立 product/full 的固定套件登记、必要前置条件和覆盖标签，保留独立入口且不提供任意命令/跳过必需项开关。验证：Node 控制测试断言两种范围、缺脚本拒绝、check/build 顺序、full 不嵌套 product、live 探针永不入默认计划；在 Verification 记录实际范围及 NOT_SELECTED 含义，不新增平行任务清单。
- [x] 1.2 GEN-008 实现本次源副本、白名单环境、offline frozen install、SQLite 绑定检查及 source/build 身份记录，不复制用户环境、数据库或 node_modules。验证：自有 Git/文件 fixture 覆盖未提交输入、排除/越界 symlink、复制期间变化、缺缓存/native 失败和原文件不变，隔离应用无需读取真实 .env；更新 README 与 Verification 的工具/缓存/原生前提。

## 2. 串行执行与有限清理

- [x] 2.1 GEN-008 实现调度器的逐步执行、20/40 分钟初始总预算、单步上限、首错停止和非零状态，正常应用构建每次只做一次。验证：真实控制子进程覆盖非零退出、启动失败、普通超时、总预算耗尽、后续 NOT_RUN 与无自动重试，替身结果标 control-test；同步 Verification 的失败和退出语义。
- [x] 2.2 GEN-008 复用锁库保护同仓库验收，完善真实 bind 预检及 suite 启动器的进程/浏览器归属、信号、关闭与父级收尾。验证：占用非 HTTP 端口、并发 product/full、SIGINT/TERM、detached 子进程、清理超时和未知身份场景，确认只结束所属进程、失败不继续抢端口；更新 Lifecycle 与 Verification 的实际清理边界。

## 3. 子报告、输入一致性与导出

- [x] 3.1 GEN-008 为现有浏览器 suites 接入单一最小报告辅助，随真实断言产出 run/suite/source/build/case 结果；check/build 等命令按真实退出记录，不伪造数量。验证：缺/空/旧/身份错误/全跳过/退出矛盾报告均不能通过，负向业务结果只有预期断言成立才算 case 通过；独立 smoke 仍可运行，更新 Verification 的报告归属和示例。
- [x] 3.2 GEN-008 完成逐步原子 summary、源码/构建变化拒绝、白名单证据导出和截图遮罩。验证：控制测试覆盖 STALE_INPUT、被改坏构建、路径穿越/符号链接、旧 runId 复用拒绝、未确认脱敏截图拒绝导出及敏感哨兵；实际检查导出摘要/截图不含凭据、输入/源码正文或私有目录，README/Verification 说明本地与可分享证据区别。

## 4. 主路径缺口与公开入口接入

- [x] 4.1 GEN-008 按覆盖矩阵核对原 suites，缺失的创建→SDK 工具→SQLite→真实编译/控件→采用→重开连接补在相应拥有者，避免复制专项用例。验证：真实 UI 回归同时核对模型替身调用次数、版本/消息/文件和当前引用，取消/未知/归属/窄屏行为保持；不得用预种项目或假 ready 替代主路径，补充 Verification 的具体覆盖。
- [x] 4.2 GEN-008 接入 `pnpm verify:product` 和既有 `pnpm verify`，将必要控制测试纳入 check，保留 pnpm smoke 自带构建和各专项的独立语义。验证：CLI 帮助/非法 profile 不启动验收，真实计划只选择规定入口，主输出与最终状态一致，默认无真实模型调用；README、Verification 更新实际命令、时间预算与缺前置时的行为。

## 5. CI 入口与安全产物

- [x] 5.1 GEN-008 修改既有 CI job 使用 product/full，保留 job 名称、固定 Action SHA、只读权限、无应用 secrets 和七天保留；按唯一合法 runId 上传本次 export，并设置初始 25/45 分钟 job 上限。验证：使用既有 YAML/表达式校验方式与固定输入核对，测试 artifact 路径和失败导出不掩盖非零结果，记录本地等价证据；更新 Verification，未执行的 hosted run 明确未验证，不自动提交/推送或触发远端。

## 6. 实际集成验收

- [x] 6.1 GEN-008 在前置能力就绪后执行一次完整 `pnpm verify`，再用不同 runId 执行 `pnpm verify:product`，验证两个入口及新副本/DB/cookie 不依赖旧状态。验证：两次各只完整构建一次，所有所选必需检查/清理通过并有对应源/构建摘要、真实浏览器断言和脱敏报告；环境阻塞不勾选通过，记录实际耗时与未运行范围，执行 `pnpm openspec validate gen-008-integrated-regression --strict --no-interactive`、链接检查和 `git diff --check`，保持真实模型/部署/hosted CI 的独立状态。

## Implementation evidence

2026-10-18，在 macOS arm64、Node 22.22.2、pnpm 12.11.2 实施。新增 scripts/verify.mjs 和 verification 下的固定登记、隔离输入、调度、进程身份、模型网络守卫及唯一子报告辅助；必要控制测试纳入 pnpm check。保留所有独立 smoke 原断言和自带 build 的 pnpm smoke，full/product 消费本次正常副本的一次完整构建，不嵌套 product 或默认执行 live/部署命令。

输入包含当前 Git 可见未提交实现，排除用户环境、私有题目、数据库、依赖和旧构建；两次均独立 offline frozen install，保留 allowBuilds 并实际 SQLite 文件读写。原目录与源副本同时核对，浏览器前后核对构建；OpenSpec 工件身份另记。环境白名单不继承模型凭据/数据库/生产代理或任意 NODE_OPTIONS，Node fetch 守卫拒绝远端模型路径。共享报告只有最小安全字段，不能以退出 0、旧截图、缺报告或全跳过通过。

| 实际检查 | 退出码与观察 |
| --- | --- |
| pnpm install --frozen-lockfile | 0；4 个 workspace，lockfile 无更新，无新增依赖或测试框架 |
| pnpm test:verification | 0；23 项控制测试，含固定范围/单次构建、Git 未提交输入/排除/链接/复制变动、副本变动、真实离线安装/native 失败、环境、超时/预算、端口/锁、SIGINT/TERM、detached/未知身份/清理超期、报告、遮罩/路径/摘要/旧 ID、模型外联和 CI 白名单 |
| pnpm check | 0；23 调度控制 + 1 契约准备 + 197 后端 + 32 前端，共 253 项，0 失败/跳过；最终 full/product 的隔离 check 也各自实际执行 |
| pnpm lint 与前置诊断 smoke | 均 0；真实独立 dev/生产后端、代理、原诊断错误/恢复及新首页保持 |
| ATOMS_VERIFY_RUN_ID=gen008-full-complete pnpm verify | 0；15/15 登记步骤、77 个浏览器场景，542760ms（约 9 分 3 秒），正常生产构建 1 次，cleanup=passed |
| ATOMS_VERIFY_RUN_ID=gen008-product-complete pnpm verify:product | 0；9 个所选步骤、29 个浏览器场景，122333ms（约 2 分 2 秒），独立新副本/DB/cookie，正常生产构建 1 次，cleanup=passed |
| actionlint 1.7.12 | 0；YAML/表达式及四个固定 SHA 的 action.yml 输入核对；原 job 名称、runner、只读权限、七天保留不变，超时为 25/45 分钟，仅上传当前合法 runId 的 export |

full 的浏览器结果为 diagnostics 3、template 13、projects 6、generation-stream 8、candidate 21、workspace 26；模板/项目入口的各 4 项控制测试也随原命令实际通过。manager 13 项真实进程测试本轮重新运行并通过，不复用为未执行命令。product 的 browser 为 diagnostics 3 + workspace 26；doctor、manager、template/projects/generation-stream/candidate 专项明确 not-run/NOT_SELECTED，没有当作通过。

本轮完整运行定位到一个拥有者测试时序缺口：会话重建时旧模板选项仍可见，不能据此推断已允许创建；手机快捷键在确认前被产品正确拒绝。修正位于 workspace smoke，增加实际延迟会话响应、确认前快捷键零创建的断言，再等原生提交按钮可用后提交；保留真实 UI→SDK list/read/submit→SQLite→Sandpack 报价→采用→重开，不通过修改产品行为或 fake ready 使测试通过。修正后的 26 场景先独立通过，再在最终 full 和 product 各通过。

工作台主路径每次实际 SDK fixture 请求 32 次，真实模型调用 0；full 还重新验证事件流、采用竞争/未知、真实编译/运行失败及重启。进程辅助对 PID/启动时间/命令/父子关系核对，macOS 退出瞬间只剩命令占位时仅限时等待，不向不完整身份发信号。旧的实施中源变动运行保持 failed/STALE_INPUT；外部 gen007-submit/gen006-review 副本占用端口时保持 blocked/PORT_BUSY，未停止对方。一次手机测试失败保持 failed 且 product 未运行；修正后另用新 runId 完整执行，没有 runner 自动重试或复用失败结果。

最终两个源摘要相同：`3709cf3b9f79739f9c773ef6314ae99ef52ed6112eb79194230086e0e7bbb499`；构建摘要相同：`29674dd793de3bd08b9384d2fff88a278241ba0677a2a842b55b77d853ae5caa`。两次源副本和运行数据目录不同，当前原目录仍匹配已验收源摘要。详细源/构建清单与日志只在各自 private；两次 export 都恰为 summary.json、summary.md 和两张明确遮罩的 PNG，文字哨兵/私有路径扫描、PNG 摘要及 1280×900/320×900 视觉复查通过。

可分享证据：`test-results/gen-regression/gen008-full-complete/export/` 和 `test-results/gen-regression/gen008-product-complete/export/`。综合本地记录：`test-results/gen-008/report.json`。命令日志为 `/tmp/atoms-gen008-*.log`，业务子报告留在各自 source/test-results 中，不上传整个 source/private 或原图、cookie、SQLite、提示词/源码正文。README、Verification、Lifecycle 和 Monorepo 已同步；没有新增平行任务清单或修改上游 GEN 完成状态。

边界：source=fixture，实际 SDK/工具/SQLite/外部 Sandpack/进程验证已运行，不能推断任意真实模型质量。真实模型、最终部署及 hosted CI 均为 not-run；本轮没有提交、推送、归档、发布或触发 GitHub Actions。

最终选定 change 严格校验、全仓 28 项结构校验、112 个本地文档目标、2 个入口锚点及 git diff --check 均通过。两个运行均已确认所属清理成功，3001/5173/4173 已释放。OpenSpec apply 为 all_done，10/10 完成。
