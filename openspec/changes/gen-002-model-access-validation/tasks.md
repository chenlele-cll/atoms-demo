# Tasks

任务：`GEN-002`。范围为单供应商模型接入、能力探针和对应自动化测试，不包含真实项目生成。收到实施请求后已实现代码与本地验证；用户明确 API 前提尚未准备，4.2 保留未完成。需求见 [model-access](./specs/model-access/spec.md)，边界、参数与测试矩阵见 [design.md](./design.md)。

## 1. Configuration and dependencies

- [x] 1.1 GEN-002 为 backend 固定 AI SDK、OpenAI provider 和 Zod 的兼容版本，更新唯一 lockfile；核对当前 Responses、结构化结果与工具接口并执行 frozen install，更新选型说明，前端不引入模型依赖。
- [x] 1.2 GEN-002 实现调用边界的模型配置解析和安全环境模板，覆盖缺少/空白凭据、模型标识、时限与 token 限制；添加 Node 配置测试，确认未配置模型时既有 HOST/PORT 和健康接口测试仍通过，文档区分 Pro 与 API 前提。

## 2. Model client and capability cases

- [x] 2.1 GEN-002 实现单 OpenAI Responses 客户端、文本及结构化文件样例，运行时检查拒绝、截断、schema、固定路径及体积；受控测试和本地 HTTP 集成验证实际请求模型、路径、`store: false`、输出限制及不执行/写入生成文件，并记录模块边界。
- [x] 2.2 GEN-002 实现仅操作内存数据的 `inspect_fixture` 工具往返样例，限制两次模型请求和一次工具执行；测试真实工具分派、结果再次输入、最终确认，以及未调用、未知工具、非法参数与未确认的失败，证明不依赖 GEN-001 模板或项目服务。
- [x] 2.3 GEN-002 加入零自动重试、完整样例截止时间、外部取消和统一安全错误分类；用延迟/失败的本地 HTTP 测试服务验证实际请求中止、晚到响应丢弃、后续步骤停止、认证/模型权限/限流/服务/网络错误，捕获日志验证哨兵密钥与原始错误体不泄露，更新错误说明。

## 3. Explicit probe commands

- [x] 3.1 GEN-002 实现显式 `--case` 的源码探针 CLI、独立能力状态及脱敏报告，配置缺失标记未调用，`all` 只在三项通过时通过；添加受控报告和 CLI 测试，覆盖帮助无网络、部分失败/未执行、未知用量及实际请求上限，并文档化新命令。
- [x] 3.2 GEN-002 加入构建产物探针入口和可选本地报告，处理 SIGINT/SIGTERM 及有限清理；子进程测试验证无凭据退出、帮助、信号处理及输出脱敏，检查 `node dist/model/probe.js` 的导入与运行依赖，并同步 README 和 Verification 的真实/替身验证边界。

## 4. Integration verification and handoff

- [x] 4.1 GEN-002 运行 frozen install、`pnpm check`、`pnpm build` 和构建产物的无网络入口检查；确认默认测试、健康检查及现有本地总验收不会调用真实模型，不访问开发者秘密文件，记录退出结果并清理测试 HTTP 服务及子进程。
- [ ] 4.2 GEN-002 在 API 凭据、额度和模型权限确实准备好后，显式运行构建产物的 `--case all`，记录指定模型的文本、文件与工具实际结果、耗时及可用用量；如前提未满足或任何能力失败，保留该项未完成并报告具体边界，不能以替身测试通过代替。
- [x] 4.3 GEN-002 核对配置、模型推荐、命令与实际实现一致，执行本 change 严格校验、链接和差异检查；在本清单记录实际能力与未验证范围供 GEN-004 使用，确认 GEN-001、manager、其他 change 和用户既有改动未被覆盖，不提交或推送。

## Workflow follow-up

- 已按用户实施请求使用仓库 `openspec-apply-change` 工作流；真实 API 验收待凭据、额度与模型权限准备后继续，不读取开发者登录缓存或秘密文件。
- 如选择改用 ChatGPT 套餐授权、Codex SDK 或其他供应商，先修订本提案中的认证、调用限制及验收，不静默更换路线。
- 验证、规格同步和归档按后续请求分别执行；模型能力探针通过不能作为真实模板修改、持久化、预览或完整 Top 1 已通过的证据。

## Implementation evidence

2026-10-18 按用户“实施 GEN-002”执行。用户随后明确“尚未准备，先完成代码和本地测试”，因此不运行真实 API 验收、不勾选 4.2。

- 后端精确依赖：ai 7.0.143、@ai-sdk/openai 4.0.96、zod 4.6.7；使用项目 Node 22.22.2 / pnpm 12.11.2。安装时核对官方 Responses、Structured Outputs、Function Calling、AI SDK generateText 及固定包的实际实现，更新唯一 lockfile，前端未引入模型依赖。
- [配置](../../../backend/src/model/config.ts) 仅在调用边界解析；安全模板增加四个模型变量，既有 HOST/PORT 和健康行为不受缺少模型配置影响。不读取 ChatGPT/Codex 缓存，不接受任意上游地址；固定官方 API baseURL，阻止 SDK 环境覆盖及重定向重放。
- [客户端](../../../backend/src/model/client.ts) 使用 Responses、store=false、maxRetries=0、每次输出预算及单步调用；每次完整样例共用一个截止时间，信号传到实际 fetch。超时/取消拒绝晚到结果，作用域结束移除监听器并关闭，不允许后续请求。SDK warning 和原始异常先被过滤，只报告安全分类。
- [三个样例](../../../backend/src/model/probe-cases.ts) 分别检查非空最终文本、唯一 /App.tsx 文件的 Zod 结构和 UTF-8 16 KiB 上限，以及 inspect_fixture 的一次实际内存分派和第二次回答对随机 nonce 的确认。工具完整调用批次先验证；文件从不写入或执行，样例不依赖模板或项目服务。
- [runner](../../../backend/src/model/probe-runner.ts) / [CLI](../../../backend/src/model/probe-cli.ts) 分开处理能力、来源、用量和退出；支持根目录源码与构建入口、显式 --case、可选固定目录报告。账户/服务/网络/时限故障停止后续样例，格式失败可继续其他能力；只有所有必需能力通过才退出零。用量未知为 null，不推算费用。

实际验证：

| 执行项 | 观察结果 |
| --- | --- |
| pnpm install --frozen-lockfile | 退出 0；lockfile 与应用声明一致 |
| pnpm check | 退出 0；lint、两端严格类型检查和 Node 测试通过，共 60 项、零失败/跳过 |
| 本地 SDK/HTTP 集成 | all 恰好四次 /v1/responses；固定模型/store/output/schema、工具调用和结果回传均实际断言，结果标记 fixture |
| 失败与边界测试 | 文件格式/路径/字节、拒绝/截断、非法或重复工具、缺确认、HTTP 认证/权限/限流/故障、HTTP 200 内嵌 failed、网络、真实连接超时/取消、晚到结果、关闭作用域和零重试通过 |
| CLI 子进程 | 隔离目录和假配置；帮助零网络、缺配置非零、脱敏保存；SIGINT=130 / SIGTERM=143，实际连接结束、不启动后续样例，有限时间退出 |
| pnpm build | 退出 0；前后端产物生成，后端构建不包含测试。前端已有 Sandpack 大 chunk 提示，不影响构建 |
| pnpm model:probe --help / pnpm model:probe:built --help | 均退出 0；脚本转发与源码/构建入口可运行 |
| 实际 backend/dist/model/probe.js --case all --report | 在隔离目录、清空模型配置并拦截任何 fetch 的条件下退出 1；source=not-run、requestCount=0、configuration，报告落入根 test-results/model-probe |
| 实际 backend/dist/server.js | 同样无模型配置/无环境文件，真实 HTTP 健康响应 200；SIGTERM 后退出 0，所属随机端口释放，无上游请求 |
| change 严格校验、相对链接与差异检查 | 通过；最终执行结果与代码哈希见本地证据 |

本地证据：`test-results/gen-002/2c665f60-c758-4beb-b1a4-24d28dce12ed/report.json`、check.log、build.log，均被忽略；最终无配置构建探针报告为 `test-results/model-probe/ba3b4606-e13a-4628-8641-47300aa448c2.json`。本轮所有 fixture HTTP 服务、CLI 子进程、临时构建目录和生产健康检查进程均已清理。

GEN-001 模板内容标识仍为 `44e5ae3cc6ad1faf92e9000108279abe533b903dc7ea9b04124466690c2133e6`；未修改其源码/任务、manager 实现、其他 GEN change 或用户 .config/opencode 改动。README、两级指南、配置/选型/生命周期/验证文档只补充实际模型边界。现有默认 check/verify/CI 的命令链未加入真实探针；本轮未重复运行未受影响的完整 manager、浏览器和模板专项，沿用 GEN-001 对应记录。未提交、推送、归档、部署到服务器。

供 GEN-004：可复用 readModelConfig 与 createModelClient().run 中的有限 session.step；项目工具、权限、生成步骤和文件采用另行实现。真实 OpenAI 的三项能力、模型权限、额度、网络和用量均未验证；文件样例合法不证明代码能编译，模板预览也不构成真实项目生成或完整 Top 1 已完成。
