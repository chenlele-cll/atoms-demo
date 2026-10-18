# Tasks

本清单跟踪 GEN-010 的实现与实际验收，未完成项保持未勾选。依赖 GEN-001～009 的实际能力和匹配产物；范围见 [proposal.md](./proposal.md)，执行与验收标准见 [design.md](./design.md)。没有真实模型与完整证据时不勾选 live 验收完成。

## 1. 固定需求与调用边界

- [x] 1.1 GEN-010 建立 studio/schedule 两个版本化公开需求、可访问控件契约和独立业务 oracle，不提供业务组件实现。验证：无模型的 Node 测试检查报价 2300/3200/6200、非法页数、案例集合和活动 AND 筛选/空状态；与真实基线核对新增交互，Verification 记录两个需求的范围及不能事后放宽断言。
- [x] 1.2 GEN-010 实现 smoke:live 的固定参数、显式 --live、模型配置预检、两例各一次计划和失败即停，不嵌套付费探针。验证：控制测试覆盖无参数/帮助/非法输入/缺配置零调用、每例最多六步和两例计划最多十二次、未知结果只查询原 requestId、前序失败不发第二例、无自动重试/换模型/扩预算；README 给出命令、配置与用量边界。

## 2. 安全调用事实

- [x] 2.1 GEN-010 核对已有模型/生成观察能力，仅补齐缺失的真实 dispatch/步骤完成元数据及 run/step 关联，保留原请求/响应/取消语义。验证：受控 SDK 测试核对传输调用次数、signal、原样响应、x-request-id/模型/usage 的可空提取与关联，观察不增加请求或消费正文；缺字段不伪造为零，Development/Verification 记录允许字段，无新产品接口或迁移。
- [x] 2.2 GEN-010 完成日志/报告的字段白名单、长度约束、部分用量和真实/fixture/not-run 来源控制测试，并纳入 pnpm check。验证：含密钥/headers/原始错误/提示词/工具正文的哨兵不泄露；网络发起与供应商确认分开，生成 run 和 provider request ID 不混用，缺/重复/矛盾观测导致失败；Verification 说明调用证据不能代替业务通过。

## 3. 发布产物与真实 UI 主路径

- [x] 3.1 GEN-010 接入 GEN-009 的产物搬迁、报告摘要绑定、独立 DB/Nginx/生产入口和同一验收互斥，记录 harnessDigest。验证：控制测试拒绝旧/空部署报告、篡改包、不同 releaseDigest/ABI、端口占用和未知进程；实际运行无 Vite/tsx/fixture 注入，不读取开发 DB/.env，原发布包只读；README/Lifecycle 维护本次布局与起停边界。
- [ ] 3.2 GEN-010 复用工作台具体交互辅助，通过可见表单为两例各创建原模板项目并生成一次，接入真实候选编译、业务 oracle、只读源码与显式采用断言。验证：受控控制测试先覆盖失败/重复提交/不自动采用/预种候选拒绝，live 时逐例核对模型与工具→run→候选→文件/digest→计算/筛选→采用关联；不修改候选或替换 iframe，Verification 明确实际业务通过条件。

## 4. 重开、质量与报告

- [ ] 4.1 GEN-010 接入刷新/离开再开/生产后端重启、另一会话拒绝、桌面和 320/375px 宿主/iframe 宽度与交互检查。验证：同一 cookie/DB 下两个项目均恢复相同 current/files/digest/消息并能再次操作，源码/刷新/采用/切宽度/重启零新增模型调用；保留实际 iframe 尺寸和观察，Verification 区分平台快照与浏览器内临时状态。
- [x] 4.2 GEN-010 完成 automation/visualReview/acceptance 分别记录、实际复核记录校验合并、有限清理及白名单导出。验证：控制测试拒绝空/旧/不匹配或缺项复核，自动化退出 0 但视觉未查时最终 acceptance 仍 not-run；无双用例/业务/质量/清理全通过不能标 passed。敏感哨兵、越界证据、SIGINT/TERM/清理失败按实际非零结果记录，Verification 写明只读产物和私有数据保留规则。

## 5. 演示交接

- [ ] 5.1 GEN-010 新增 docs/product/demo-guide.md 并接入 docs 索引/README，维护 3–5 分钟主演示、第二例、会话保留和实际失败处理。验证：逐条对应已实现控件与已核验行为，区分现场新生成/既有真实成果/历史记录，不宣传未实现的历史恢复/分享；用本次实际观察填写范围和日期，core-paths 只在最终验收通过后更新 Top 1 状态，相对链接有效且无秘密/私有题目材料。

## 6. 实际集成与最终验收

- [ ] 6.1 GEN-010 前置就绪后运行 frozen install、pnpm check、pnpm verify:product；若发布字节改变，执行 release:build 和匹配的 smoke:deployment，再显式执行一轮 pnpm smoke:live --live --release <产物目录> --deployment-report <部署摘要>。验证：真实两例、采用/重开/生产重启/窄屏与调用事实有对应证据，使用仓库 Playwright skill 实际复核桌面和窄屏并合并完整记录，全部通过才确认 Top 1；缺配置/失败保持未完成，记录实际耗时/用量与未运行的公网/Top 2/3 范围，执行相对链接检查、git diff --check 及 pnpm openspec validate gen-010-live-generation-acceptance --strict --no-interactive，不自动补跑真实请求或发布到服务器。

## 7. 用户修订：长任务默认无累计截止

- [x] 7.1 GEN-010 将模型配置默认改为 0（无累计期限），取消服务和模型客户端在 0 时的截止检查/定时器，保留显式正值、取消和提交前栅栏；更新本地私有配置与公开说明。验证：默认/0/长正值配置、跨旧 60 秒多步骤真实 SDK fixture 成功、0 下取消和显式正值超时仍正确，迟到内容不能保存。
- [x] 7.2 GEN-010 移除前端 150 秒和 live 10 分钟的默认累计截止，0 时 Playwright 等待无累计期限，保留心跳/首部/状态/预览/起停故障检测与清理。验证：有心跳的流跨旧 150 秒仍成功，用户取消及显式有限测试期限正常，live 帮助/报告清晰表示无总期限。
- [ ] 7.3 GEN-010 完成修改后的工程和 Playwright 回归，重新构建发布包并验证匹配部署，在 0 总期限、原输出/步骤预算下执行用户授权的新一轮双用例真实验收；保留旧失败，首错停止，不自动扩预算，逐项记录实际结果及原产物完整性。

## Implementation evidence

- 2026-10-18：已固定 studio/schedule v1 公开自然语言需求、可访问控件契约和独立 oracle，包含报价/非法输入、案例集合、活动 AND/空状态；未提供业务组件给模型，未修改模板预种目标控件。
- 已实现显式 smoke:live、一次两例计划/最多十二次、生成 POST 准入门（先核对新模板/零调用，批准后才放行）、重复/第三提交拒绝、未知结果仅查原 requestId、失败停止第二例及只读产物/同包部署报告/ABI 前检。15 个无 live 控制测试与 5 个实际 SDK fixture 观察测试通过；帮助/非法输入/缺产物以网络守卫确认零调用，原始敏感字段和无效 PNG/复核记录拒绝。
- 生产边界增加白名单 modelObservation：dispatch、响应元数据和 SDK 结束分别计数，attempt UUID/step 与 run/project/request 关联；原样传输 signal/响应，不消费正文、不重试。可空 request ID/响应模型/用量与安全错误保留事实，观察者抛错不影响产品行为；未新增接口/迁移。SDK fixture 实测请求 1:1、真实取消、三步骤生成与 SQLite 关联均通过。
- 调用配置已仅以非秘密字段核对：gpt-6.1-sol，用户批准的兼容 endpoint，60000ms/4096 输出 token；真实双用例计划沿用这些现有值，不提高预算。此前配置检查未发网络请求，钥值不进入日志/工件。
- 按既有批准的 GEN-009 冻结基线建立 .runtime/gen010-acceptance/workspace，仅叠加 GEN-010 代码/控制/文档和等价 shared primitive 提取，保留原工作区正在进行的 REV/DEP 改动；不将并行未完成历史恢复/分享能力纳入本轮 Top 1。后端构建已通过，根差异保留；该阶段尚未发起本轮真实生成，后续实际结果见下方恢复验收记录。

## Acceptance attempt — 2026-10-18

- 冻结验收基线：沿用用户已批准的 GEN-009 快照，只叠加 GEN-010；原工作区并行 REV/DEP 改动、默认检查和原始文件均保留。此结果不代表后续持续改写的整个工作区已经合并验收。
- 工程：offline frozen install、SQLite 原生加载、ESLint/类型检查与 `pnpm check` 通过；本次 check 共 289 项（live 15、release 16、verification 23、contracts 1、backend 202、frontend 32），其中包含 5 项真实 SDK loopback 观察测试；真实计费请求为零。
- 产品：`ATOMS_VERIFY_RUN_ID=gen010-product-exclusive pnpm verify:product` 通过，耗时 167903ms、cleanup=passed。Playwright 自动化实际覆盖诊断 3 项、工作台 26 项（含可见创建、真实 SDK fixture 工具、SQLite、Sandpack 报价交互、明确采用、重开、取消、归属和手机路径），合计 29 项；source=fixture，不能替代 studio/schedule 的真实供应商验证。
- 构建：`pnpm release:build --json` 通过，耗时 20797ms、cleanup=passed；releaseId=`983bd1e7-cdf8-46dd-8fd7-e18621347afb`，releaseDigest=`3fcf71bb9a1d7c9017ab0538caaa5729468e0a7300d67db1f27a5990f43a8908`，buildDigest=`e55dd59530cbc07fff62734ae7ec9cb4950b00ff1337b0cd4489456b285e5048`。本地产物已复制到 `.runtime/releases/<releaseId>` 并重新校验一致。
- 部署尚未通过：`smoke:deployment` 的 `45146f26-9f6d-48a4-9e5c-2bf7ee8d8a85` 在前检被 PORT_BUSY 阻塞；`ab62d7cc-8bae-4ebd-99fa-e047c8d8d734` 与 `dcf9c5f0-5ec5-4920-acc7-382240eafe2c` 的产物完整性通过，随后另一会话又在 3001 启动独立 workspace/history-workspace 回归，启动归属检查以 PORT_OWNER_CHANGED 拒绝，均 cleanup=passed。保留失败，不标记成部署通过，也不停止对方进程。
- 用户已授权暂时独占端口，但外部会话仍连续新启专项；本轮曾额外持有原仓库标准验收锁，独立专项未使用该锁。已请求在另一会话暂停新回归；收尾已释放本轮持有的标准锁，无所属 Node/Nginx/Chrome 服务需要继续运行。
- `pnpm smoke:live --live ...` 尚未执行：缺少同 releaseDigest 的完整通过部署报告，真实模型调用数为 0；studio/schedule、生产重启、三宽度真实业务与 Playwright CLI 视觉复核均为 not-run，最终 acceptance=not-run。严格遵守先部署、后唯一一轮真实计划；没有预写候选、放宽 oracle、自动重试或扩大模型预算。
- 交接：安全摘要见 `test-results/gen-010/accepted/product/`、`release-build.json`、`deployment-attempts/` 与 `test-results/gen-010/status.json`；原始诊断仍留独立快照。源码/文档 23 个相关文件检查未发现实际凭据；149 个相对链接检查通过，`git diff --check` 和本 change OpenSpec 严格校验通过。Top 1 状态未更新为最终完成，公网/远端部署/hosted CI/Top 2/3 未运行。

## Resumed acceptance — 2026-10-18

- 用户确认其他会话暂停新回归后，等待既有进程正常结束，使用原样同一发布包执行 `smoke:deployment`。run=`f531b170-d281-4b9d-8e3f-5424f758e1ab` 全部 16 项通过，耗时 80946ms、cleanup=passed，releaseDigest 仍为 `3fcf71bb9a1d7c9017ab0538caaa5729468e0a7300d67db1f27a5990f43a8908`。本地生产入口/Nginx/独立 SQLite、心跳/取消/断流、SIGTERM/SIGKILL 恢复、采用结果重开、备份恢复及原包完整性均有本次匹配证据。
- 首次 live 入口 run=`8e7db5ad-7ad2-4cae-9a08-16cef0eea450` 在创建前过早查询项目列表，匿名会话尚未就绪时返回 401，脚本读取空字段失败；source=not-run、cleanup=passed。以只读 SQLite 确认 projects=0、generation_runs=0，观察事件=0，未发起供应商调用。修正为先通过可见输入等待提交按钮启用，再校验列表 HTTP 200/空集合；新增等待顺序和未授权/畸形响应测试，不更改公开需求或业务 oracle，不重建未变化的产品包。
- 校正后的唯一真实生成 run=`46001e49-c464-4581-9ce6-8e4e9ff4568b`，harnessDigest=`4d70d91e3660dc13b065cb25fda104667174d6ff5fe1e56e075d485f7922f42d`。真实 UI 创建 studio 项目，从原模板 v0 提交一次需求；实际 list_files/read_files 活动已显示，4 次 dispatch、3 次 HTTP 200/SDK 步骤结束，第四次在 60000ms 生成总期限到达时没有取得响应。生成 run 以 `GENERATION_TIMEOUT` 失败，自动化总耗时 72936ms、cleanup=passed；没有更换模型、提高 4096 输出预算、重试、修补候选或发起 schedule。
- 用量：前三次已知 input=23036、output=400、total=23436 token；第四次用量未知，整轮 totals 保持 null，不把已知部分当作完整用量或金额账单。网络发起次数不等于供应商确认完成次数。
- 失败保护只读核对：1 个项目，1 条 failed run，current 仍为原 template 版本，候选为 0，用户消息 1/助手消息 0，SQLite quick_check=ok。实际失败截图显示 GENERATION_TIMEOUT、工具活动和原 v0；未做候选质量或完整视觉复核。作者会话只在完整自动化成功时导出，本轮没有成功成果可据此重开演示。
- 追加无模型中断专项：使用实际发布包/匹配报告，在白名单且无模型凭据的预检子进程上验证 SIGINT=130、SIGTERM=143、cancelled/SIGNAL、not-run 来源和正常清理；网络守卫未观察到请求。17 项控制在空闲的独立快照上全部通过，根工作区默认 16 项通过/专项 1 skipped。首次误在已持有原仓库验收锁时运行专项产生失败，记录保留；专项已显式要求锁空闲，未将该失败作为通过证据。
- 当前跟踪 6/10 完成；3.2、4.1、5.1、6.1 仍未勾选：缺少双用例真实候选、业务/采用/重开/窄屏和最终视觉通过证据。演示指引已补充实际失败范围，core-paths 的 Top 1 未标记最终完成。部署通过消除了原端口阻塞，当前实际未通过原因是首例真实生成超时。
- 安全交接位于 `test-results/gen-010/accepted/deployment/`、`live/` 和 `live-pre-generation-failure/`，实际模型调用 4 次，第二例未运行。原始 DB、源码、provider IDs、会话相关信息与截图均留在独立快照的 private/shared，导出仅安全字段。无提交/推送、公网/TLS、远端发布或 hosted CI 操作。
