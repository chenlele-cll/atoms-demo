# Design

## Context

动机与范围见 [proposal.md](./proposal.md)，可观察行为见 [model-access](./specs/model-access/spec.md)。后端目前只有 Fastify 健康路由；`config.ts` 解析 HOST/PORT，`server.ts` 使用原生环境加载器读取后端 `.env`。已有 Node 测试器、tsx 和严格 TypeScript，尚无模型运行依赖。

用户已有 ChatGPT Pro，尚未确认独立 API 凭据或模型权限，并请求给出推荐。本提案建议首个组合为 OpenAI Responses API 与 `gpt-6.1-sol`。该建议不表示账户权限、网络、费用或实际调用已经验证；这些由实施时的真实探针确认。

实施追加决定：用户随后提供 ai.elegantyc.com 的 API 凭据及目录 URL，并明确要求在项目配置与测试。后端仍使用同一 OpenAI provider / Responses 协议，增加显式 OPENAI_BASE_URL 允许名单；默认官方 URL，另允许此次指定的 HTTPS /v1 URL。实际报告区分 openai 与 openai-compatible，并记录 baseURL。无自动切换、无任意浏览器上游地址、无第二套认证。

`GEN-002` 无须等待 `GEN-001` 完成：能力探针使用独立、公开的小型输入，不读取模板、项目或私有材料。后续 `GEN-004` 复用模型客户端，但项目工具和生成流程另行实现。

## Goals / Non-Goals

**Goals:**

- 交付单供应商、仅服务端的模型调用模块，明确控制配置、输出、重试、时限和错误。
- 在没有真实密钥的自动化环境中覆盖协议及失败行为，再通过单独的真实探针证明账户实际可用的能力。
- 保持既有后端启动、健康检查和默认测试无需模型服务。

**Non-Goals:**

- 不创建公开计费接口、项目或数据库，不运行生成代码，不提供真正的项目文件读写工具。
- 不实现产品事件流、Agent 任务循环、浏览器预览或完整生成闭环。
- 不实现 ChatGPT OAuth、Codex 子进程、多个供应商适配、自动切换模型或自动充值。

## Decisions

### 1 使用普通 API 接入作为首轮方案

沿用既有 AI SDK 与 Zod 选型，在后端安装精确版本的 `ai`、`@ai-sdk/openai` 和 `zod`，更新根 lockfile。使用 OpenAI provider 的 Responses 入口，显式设置 `store: false`，不依赖 Chat Completions 的隐式默认行为。兼容验证包含实际发往 `/v1/responses` 的协议与参数；本任务不增加供应商抽象层。

推荐模型标识为 `gpt-6.1-sol`，因为当前官方模型页列出工具调用和结构化输出支持，官方选型将 Sol 用于编码及日常专业工作。实际模型标识通过后端配置显式提供；如果 API 项目无权限，探针明确失败，不回退到另一个模型。

ChatGPT 登录可提供 Codex 的订阅访问，API 密钥访问则由 Platform 单独按量计费。官方套餐授权也支持合资格开源及本地应用，但需要 OAuth 客户端注册、授权和令牌刷新；远程托管应用需另行申请。当前预览还有参数和工具限制，因此首轮采用普通 API，避免在本子任务增加第二套认证。Pro 继续用于开发协作，API 项目凭据、额度和模型访问权限是实际调用的前置条件。

### 2 模型配置与现有监听配置分离

计划新增 `backend/src/model/config.ts`，在显式探针或未来生成请求进入时调用配置解析；不在构造 Fastify 或健康检查时初始化客户端。

| 后端变量 | 初始规则 |
| --- | --- |
| `OPENAI_API_KEY` | 必填非空，只在模型调用边界读取，错误不回显值 |
| `MODEL_ID` | 必填非空标识，环境模板建议 `gpt-6.1-sol`，不能以聊天订阅名称替代 |
| `OPENAI_BASE_URL` | 默认 https://api.openai.com/v1；仅另允许用户指定的 https://ai.elegantyc.com/v1；禁止其他地址、凭据、查询、片段及重定向 |
| `MODEL_TIMEOUT_MS` | 默认 60000，接受 1000–120000 的整数，覆盖一次完整能力样例及其工具往返 |
| `MODEL_MAX_OUTPUT_TOKENS` | 默认 4096，接受 256–8192 的整数，传递至每次模型请求 |

CLI 沿用后端原生 `.env` 加载与进程环境优先规则，工作目录通过 workspace 命令固定为 backend。环境模板只写变量名称、说明和安全示例；实际秘密不进入前端、报告或提交。本轮不接受由网页或探针参数传入任意上游地址。

### 3 客户端只负责受控调用及安全结果

计划新增 `backend/src/model/client.ts`，创建配置已校验的单供应商客户端。设置 `maxRetries: 0`，提供文本、结构化结果及工具探针需要的 SDK 调用能力；业务模块不直接拼接供应商 HTTP 响应。

调用前检查外部 AbortSignal，组合外部取消和能力样例的截止时间，将信号传到底层请求，并清理监听。工具样例的两次模型请求共享同一截止时间，不为第二步重新开始计时。超时或取消后拒绝晚到结果并停止剩余步骤。

以安全的内部错误分类返回配置缺失、认证失败、模型无权限、额度/限流、供应商故障、网络、拒绝/输出无效、超时和取消。仅暴露允许的分类、状态码、可重试提示及安全说明；可重试提示不触发实际重试。日志和报告不传递原始错误体、SDK 异常 cause、请求头或请求/结果正文。

### 4 三项独立能力探针

计划新增 `backend/src/model/probe-cases.ts`，每次执行产生新的本地运行标识，并按以下顺序执行：

| 样例 | 输入与通过条件 | 请求上限 |
| --- | --- | --- |
| `text` | 简短公开输入，取得实际非空最终文本；拒绝或截断不是成功 | 1 次 |
| `files` | 要求返回一个小型组件文件；用 Zod 检查固定 schema、唯一允许的 `/App.tsx` 路径、非空正文和 16 KiB 内容上限 | 1 次 |
| `tools` | 要求调用唯一的 `inspect_fixture`，在内存中返回本次运行标识；将结果交回模型，检查其最终确认包含实际工具结果 | 2 次模型请求、1 次工具执行 |

`inspect_fixture` 只返回公开内存数据，不读取目录、不写文件、不请求网络；未知工具或非法参数直接失败。使用有界的两步工具往返，不创建通用 Agent。结构化文件只解析并返回摘要，既不写入项目，也不执行；schema 通过不意味着代码编译或业务交互通过。

`all` 最多发起四次模型请求；每个请求没有自动重试，每项样例有自己的完整时限。认证、模型访问、额度、上游网络/服务故障、超时或取消结束后续样例，剩余标记 `not-run`；单项输出格式失败可继续检查其他独立能力。只在三项均通过时整体通过。

### 5 CLI 与验证结果

计划新增 `backend/src/model/probe.ts`，通过 backend 的 `model:probe` 源码命令和 `model:probe:built` 构建产物命令执行；根目录提供 `pnpm model:probe` 的 workspace 转发。新命令当前不存在，实施时加入并文档化。

无参数或 `--help` 只显示使用说明，不发请求；真实验证显式使用 `--case text|files|tools|all`。默认检查、健康检查、manager 和本地总验收不自动调用真实探针。CLI 不监听 HTTP 端口。

报告包含本地运行标识、结果来源、实际请求次数、供应商、配置模型标识、时间、各项 `passed/failed/not-run`、耗时、安全错误分类和已观测的用量。实际发出供应商请求时来源为 `live`，前置检查失败且未调用时为 `not-run`，受控测试为 `fixture`。供应商未返回用量时记为 `null`；不计算未经核对的费用或将用量当成账单。默认输出脱敏 JSON，可选 `--report` 保存到忽略的 `test-results/model-probe/`。

供应商字段由已校验的地址确定：官方为 openai，用户指定兼容服务为 openai-compatible；无合法配置时 provider/baseURL 为 null。读取指定 /models 目录只作一次接入前核对，不加入默认测试或后台轮询，也不自动改选模型。兼容服务的模型、用量和能力结果只代表该服务本次实际返回，不推断官方账号权限。

配置错误时明确报告尚未发起调用；缺少凭据不是通过。命令成功仅用于全部请求的能力通过，其他结果返回非零，取消遵循终端中断语义。接收 SIGINT/SIGTERM 时先中止活动请求再完成有限清理，不再启动下一项样例。

构建产物命令使用 `node dist/model/probe.js`，遵循现有 NodeNext `.js` 导入约定。源码命令复用 backend 已有 tsx。真实完整验收优先使用构建产物运行 `--case all`，证明发布侧依赖齐备；无需为重复证明同一逻辑默认再支付一轮源码探针请求。

### 6 分层自动化验证

新增测试放在 `backend/test/*.test.ts`，由现有 Node 测试器纳入 `pnpm test` 和 `pnpm check`，不增加测试框架。

| 层次 | 验证内容 |
| --- | --- |
| 配置与结果检查 | 缺少配置、空值、非法限制、schema、文件路径/体积、拒绝和截断；既有健康与 HOST/PORT 测试继续通过 |
| 受控模型测试 | 文本、文件、真实样例工具执行次数、工具结果再输入、缺少调用、未知工具、错误参数和未确认结果 |
| SDK/HTTP 集成 | 使用本地随机端口 HTTP 测试服务及显式测试 fetch 注入，真实穿过 SDK；检查 Responses 路径、模型、限制、工具结果、重试次数及服务错误分类 |
| 请求生命周期 | 本地服务延迟响应，在请求等待中取消或超时，观察底层请求结束并断言不再发起下一步；区分取消、超时和网络失败 |
| CLI 子进程 | 帮助不请求网络、缺凭据非零退出、构建入口可启动并安全失败、输出和日志不包含哨兵密钥及原始错误体 |
| 真实验证 | 单独显式运行构建后的 `--case all`，记录真实结果；未配置或失败时保留未验证/失败状态 |

自动化只使用假密钥，忽略开发者真实环境文件，受控测试的结果来源标记为 fixture。可注入传输仅用于模块测试，不增加生产环境的假模型开关或公共诊断路由。不能因为本地服务模拟了 Responses 协议就宣称已经连通 OpenAI。

## Risks / Trade-offs

- Pro 不等于 API 账户已准备好 → 文档明确区分认证与计费；真实验收以账户实际请求为准，未配置不伪造成功。
- 推荐模型的权限、网络或用量限制不符合当前账户 → 探针返回明确原因；显式调整配置或修订接入方案，不自动换模型或读取 Codex 登录缓存。
- SDK 版本变化影响结构化输出或工具协议 → 安装时固定兼容版本，SDK/HTTP 集成测试验证真实请求协议，再运行独立真实探针。
- 推理消耗输出预算或供应商返回拒绝 → 视为未完成/能力失败并记录，限制值只能在已定义范围内显式调整。
- 错误对象带出秘密 → 统一安全分类并用含哨兵秘密的错误体和子进程日志测试阻止泄露。
- 探针代码与真实项目工具混淆 → 固定无副作用样例且不依赖模板或项目；生成工具、持久化和浏览器验证仍由后续任务负责。

## Migration Plan

1. 固定后端运行依赖，增加调用边界配置与单元测试，保持现有监听配置和健康路由行为。
2. 完成客户端、三个探针样例及受控 SDK/HTTP 测试，更新安全环境模板和错误说明。
3. 接入独立源码/构建 CLI 和使用说明，执行 frozen install、`pnpm check`、`pnpm build` 及无秘密的构建入口检查。
4. API 凭据、额度及权限准备好后显式运行真实探针，记录结果；该真实验证未执行或未通过时不勾选对应任务，不把自动化结果作为替代。
5. 更新 owning 文档中的模型选择、配置与验证范围。无需数据库迁移；回退仅涉及本变更模块、依赖和命令。后续 GEN 任务复用客户端与能力记录，不由本 change 提前实现。

## References

- [OpenAI 认证与 API 计费方式](https://learn.chatgpt.com/docs/auth)。
- [GPT-6.1 Sol 模型能力](https://developers.openai.com/api/docs/models/gpt-6.1-sol)、[模型选型](https://developers.openai.com/api/docs/guides/model-selection)、[Responses 推荐与模型兼容](https://developers.openai.com/api/docs/guides/deployment-checklist)。
- [ChatGPT 套餐授权范围](https://developers.openai.com/siwc/token-sharing-open-source)、[该授权路线的预览限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)。
- [现有技术选型](../../../docs/architecture/stack-decisions.md)、[开发规则](../../../docs/engineering/development.md)、[验证规范](../../../docs/engineering/verification.md)。
