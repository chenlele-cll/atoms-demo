# Tasks

本清单只规划 GEN-010，全部待实施。依赖 GEN-001～009 的实际能力和匹配产物；范围见 [proposal.md](./proposal.md)，执行与验收标准见 [design.md](./design.md)。没有真实模型与完整证据时不勾选 live 验收完成。

## 1. 固定需求与调用边界

- [ ] 1.1 GEN-010 建立 studio/schedule 两个版本化公开需求、可访问控件契约和独立业务 oracle，不提供业务组件实现。验证：无模型的 Node 测试检查报价 2300/3200/6200、非法页数、案例集合和活动 AND 筛选/空状态；与真实基线核对新增交互，Verification 记录两个需求的范围及不能事后放宽断言。
- [ ] 1.2 GEN-010 实现 smoke:live 的固定参数、显式 --live、模型配置预检、两例各一次计划和失败即停，不嵌套付费探针。验证：控制测试覆盖无参数/帮助/非法输入/缺配置零调用、每例最多六步和两例计划最多十二次、未知结果只查询原 requestId、前序失败不发第二例、无自动重试/换模型/扩预算；README 给出命令、配置与用量边界。

## 2. 安全调用事实

- [ ] 2.1 GEN-010 核对已有模型/生成观察能力，仅补齐缺失的真实 dispatch/步骤完成元数据及 run/step 关联，保留原请求/响应/取消语义。验证：受控 SDK 测试核对传输调用次数、signal、原样响应、x-request-id/模型/usage 的可空提取与关联，观察不增加请求或消费正文；缺字段不伪造为零，Development/Verification 记录允许字段，无新产品接口或迁移。
- [ ] 2.2 GEN-010 完成日志/报告的字段白名单、长度约束、部分用量和真实/fixture/not-run 来源控制测试，并纳入 pnpm check。验证：含密钥/headers/原始错误/提示词/工具正文的哨兵不泄露；网络发起与供应商确认分开，生成 run 和 provider request ID 不混用，缺/重复/矛盾观测导致失败；Verification 说明调用证据不能代替业务通过。

## 3. 发布产物与真实 UI 主路径

- [ ] 3.1 GEN-010 接入 GEN-009 的产物搬迁、报告摘要绑定、独立 DB/Nginx/生产入口和同一验收互斥，记录 harnessDigest。验证：控制测试拒绝旧/空部署报告、篡改包、不同 releaseDigest/ABI、端口占用和未知进程；实际运行无 Vite/tsx/fixture 注入，不读取开发 DB/.env，原发布包只读；README/Lifecycle 维护本次布局与起停边界。
- [ ] 3.2 GEN-010 复用工作台具体交互辅助，通过可见表单为两例各创建原模板项目并生成一次，接入真实候选编译、业务 oracle、只读源码与显式采用断言。验证：受控控制测试先覆盖失败/重复提交/不自动采用/预种候选拒绝，live 时逐例核对模型与工具→run→候选→文件/digest→计算/筛选→采用关联；不修改候选或替换 iframe，Verification 明确实际业务通过条件。

## 4. 重开、质量与报告

- [ ] 4.1 GEN-010 接入刷新/离开再开/生产后端重启、另一会话拒绝、桌面和 320/375px 宿主/iframe 宽度与交互检查。验证：同一 cookie/DB 下两个项目均恢复相同 current/files/digest/消息并能再次操作，源码/刷新/采用/切宽度/重启零新增模型调用；保留实际 iframe 尺寸和观察，Verification 区分平台快照与浏览器内临时状态。
- [ ] 4.2 GEN-010 完成 automation/visualReview/acceptance 分别记录、实际复核记录校验合并、有限清理及白名单导出。验证：控制测试拒绝空/旧/不匹配或缺项复核，自动化退出 0 但视觉未查时最终 acceptance 仍 not-run；无双用例/业务/质量/清理全通过不能标 passed。敏感哨兵、越界证据、SIGINT/TERM/清理失败按实际非零结果记录，Verification 写明只读产物和私有数据保留规则。

## 5. 演示交接

- [ ] 5.1 GEN-010 新增 docs/product/demo-guide.md 并接入 docs 索引/README，维护 3–5 分钟主演示、第二例、会话保留和实际失败处理。验证：逐条对应已实现控件与已核验行为，区分现场新生成/既有真实成果/历史记录，不宣传未实现的历史恢复/分享；用本次实际观察填写范围和日期，core-paths 只在最终验收通过后更新 Top 1 状态，相对链接有效且无秘密/私有题目材料。

## 6. 实际集成与最终验收

- [ ] 6.1 GEN-010 前置就绪后运行 frozen install、pnpm check、pnpm verify:product；若发布字节改变，执行 release:build 和匹配的 smoke:deployment，再显式执行一轮 pnpm smoke:live --live --release <产物目录> --deployment-report <部署摘要>。验证：真实两例、采用/重开/生产重启/窄屏与调用事实有对应证据，使用仓库 Playwright skill 实际复核桌面和窄屏并合并完整记录，全部通过才确认 Top 1；缺配置/失败保持未完成，记录实际耗时/用量与未运行的公网/Top 2/3 范围，执行相对链接检查、git diff --check 及 pnpm openspec validate gen-010-live-generation-acceptance --strict --no-interactive，不自动补跑真实请求或发布到服务器。
