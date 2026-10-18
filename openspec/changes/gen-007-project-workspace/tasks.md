# Tasks

范围见 [proposal.md](./proposal.md)，方案见 [design.md](./design.md)，验收见 [project-workspace](./specs/project-workspace/spec.md)。实施状态以以下勾选和本页实际证据为准；依赖 GEN-001～006 的实际功能，规划通过不算模型/预览/工作台通过。保留其他 change 的修改，优先完成 Top 1 用户路径；历史恢复、分享和真实模型最终验收不在本项扩展。

## 1. 工作台共用契约与数据客户端

- [x] 1.1 GEN-007 将实际新消费的会话/目录/项目/消息/run/SSE schema 提入已有 @atoms/contracts，并兼容新增 backward 最新/更早消息页和恢复所需 latestRun 字段。验证：后端真实临时数据库与 injection 覆盖归属、最新/更早页顺序、游标互斥/限额、摘要不含私有正文，以及原 afterSequence 请求/响应保持；两应用类型通过，更新 Development 与 README 的兼容读取规则。
- [x] 1.2 GEN-007 实现会话 single-flight、目录/项目列表/创建、消息/状态/取消 JSON 客户端，复用 GEN-006 的超时、响应体和 schema 边界。验证：前端 Node 测试覆盖并发初始化仅一次、401/404、空目录、网络/JSON/体积失败、取消、分页与原始错误脱敏，不自动重试创建/生成；更新 Development 的客户端和会话恢复范围。

## 2. SSE 消费与请求生命周期

- [x] 2.1 GEN-007 加入固定 eventsource-parser，完成有界 POST SSE 消费及 200/202 JSON 分支，协议游标在本流中同步校验。验证：frozen install、浏览器构建和前端 Node 测试覆盖 UTF-8/CRLF 跨块、同块多帧、心跳、截断、超限、非法顺序/关联、双终态、reader/计时器清理及安全错误，不自动重连 POST；同步 Monorepo 依赖理由和 Development 的流限制。
- [x] 2.2 GEN-007 实现应用拥有的项目/请求控制器、固定 requestId/payload、显式取消、原请求有界查询、待确认信封及重新打开恢复，区分新尝试和同请求手动重试。验证：纯状态/客户端测试覆盖 StrictMode 订阅清理不误取消、真正离页清理、202 取消与成功竞争、丢末帧、404/503 未确认、跨标签 latestRun 不替换原请求、存储不可用/到期/会话清理；更新 Development 的本地辅助与服务端事实边界。

## 3. 创建、导航与对话入口

- [x] 3.1 GEN-007 接入首页/项目/现有候选/模板/诊断路由、导航及 activation 隔离，迁移原连接检查组件并保持其局部样式；更新原 smoke 去诊断页执行原场景。验证：路由状态测试与现有浏览器回归覆盖直达、前进/后退、新标签、未知路径、A→B 晚到更新和真实连接错误恢复，不能移除旧断言；README 与必要设计规则记录实际入口。
- [x] 3.2 GEN-007 实现真实创建页、模板/项目列表、示例仅填入、名称/需求校验和一次性创建并生成命令；结果未知仅刷新真实列表，不自动猜项目或重发。建立 `scripts/workspace-smoke.cjs` 与计划命令 `pnpm smoke:workspace` 的初始表单/计数回归。验证：可见输入/点击、StrictMode 重挂载、快速重复点击、创建丢响应、模型未配置和创建完成后离页，均保留正确项目/需求且无额外生成；更新 README 与 Verification。
- [x] 3.3 GEN-007 实现真实对话、最新页/加载更早、受理消息校准和本次活动归组，以及输入/取消/查询控件。验证：前端状态与浏览器用例覆盖无双气泡、有序合并和阅读位置、Enter 换行/中文组合输入/Ctrl或Cmd+Enter、真实活动在结束前可见、失败卡不冒充回答、不补历史事件；同步设计 skill 的输入与状态约定。

## 4. 工作台预览、源码与可访问布局

- [x] 4.1 GEN-007 组合项目壳与 GEN-006 预览/采用控制，保留当前/候选双重身份、等待时旧结果、成功后候选加载、采用确认和新需求当前基线。验证：状态及浏览器回归覆盖未采用候选禁止误基线、切回当前、采用成功后的下一请求基线、编译失败、冲突/丢响应确认，不复制另一套采用逻辑或自动采用；更新 README 的实际用户路径。
- [x] 4.2 GEN-007 实现所选版本的只读文件列表与源码视图，切换版本同步文件选择，源码只作文本且长行局部滚动。验证：浏览器对比 API/预览文件内容，包含 HTML/脚本的源码不执行，旧版本/其他项目文件不残留，切换视图不重复生成或取消任务；更新 Development 的只读与隔离规则。
- [x] 4.3 GEN-007 完成桌面导航/对话/主预览、中屏折叠及手机聊天/预览/代码视图，按项目保留页面内草稿和阅读状态，补齐焦点、标签、live region 和错误可达性。验证：1280、768/1024、320/375px 与键盘操作，长标题/路径/源码不撑宽宿主、内部视图切换不误取消、不同项目草稿互不覆盖；只在 owning design skill 更新实际新增规则，保留诊断页原契约。

## 5. 工作台跨模块浏览器回归

- [x] 5.1 GEN-007 扩展 workspace smoke，真实 UI 发起创建/生成，穿过实际 SDK 受控上游、工具、SQLite 和真实 Sandpack；覆盖新增报价控件操作、采用、刷新、构建后端重启，以及取消/断流/会话/跨项目竞争。验证：比较请求次数、持久消息/候选/当前引用与摘要，dev/preview 均通过；fixture 报告和脱敏证据写入忽略目录，不添加生产开关、不用注入 ready/page.evaluate 代替主路径、不调用真实模型；更新 Verification 的前提和未验证边界。

## 6. 集成验收

- [x] 6.1 GEN-007 串行执行 frozen install、`pnpm check`、调整后的 `pnpm smoke`（含 build）、新增 `pnpm smoke:workspace` 及受影响的 GEN-006 候选/GEN-005 事件流/项目恢复回归；实际影响启动或准备时再补 manager 回归，未变源码已有结果可复用。验证：记录命令、退出码、实际差异和表单→候选→采用→重开证据，执行 `pnpm openspec validate gen-007-project-workspace --strict --no-interactive`、链接检查和 `git diff --check`，明确 fixture、真实模型与最终部署的不同状态。

## Implementation evidence

2026-10-18，GEN-007 已接入创建首页、项目导航、服务端对话、真实本次活动、取消/原请求查询、当前/候选预览和采用，以及所选完整快照的只读源码。原连接检查迁至 `/diagnostics/connection`，局部配色和既有错误/恢复断言保留。候选页与工作台共用 `useCandidateReview`，没有第二套采用状态机；README、Development、Monorepo、Verification、两应用指南和 owning design skill 同步实际行为。

公开会话/目录/项目/消息/run/SSE 契约归入已有 @atoms/contracts；新增 backward 消息读取，原 afterSequence 请求/响应保持。控制器按 activation/request 隔离，StrictMode 订阅重放不取消任务，不从挂载或恢复自动生成。sessionStorage 只放有界待确认请求，页面内草稿、已加载消息和阅读位置分项目保留；401 清理私有内容。状态测试还核对最多 75 次实际 GET，以及隐藏/恢复不能缩短 Retry-After。

| 实际检查 | 观察结果与退出码 |
| --- | --- |
| pnpm install --frozen-lockfile | 0；4 个 workspace，固定 eventsource-parser 4.1.2 与唯一 lockfile 一致 |
| pnpm check | 0；lint、共享包/两应用类型、准备器 1 项、后端 197 项、前端 32 项，0 失败/跳过；后端计数包含同工作区其他 change 的测试 |
| 最新前端 test / lint / build | 均 0；查询计数/隐藏恢复细化后 32 项通过，最终 UI 文案和 smoke 补充后 lint/build 通过 |
| pnpm smoke（含 build）与最终 node scripts/smoke.cjs | 均 0；独立 dev/生产后端、代理、诊断原错误/离线恢复、窄屏与新首页，无未捕获浏览器错误 |
| pnpm smoke:workspace | 0；最终 26 个 dev/preview 场景，实际受控 SDK 请求 32 次、真实模型调用 0，清理通过 |
| pnpm smoke:candidate | 0；21 个场景，含真实编译/运行失败、双标签 CAS、未知采用与丢响应确认 |
| pnpm smoke:projects | 0；6 个浏览器场景和 4 项控制测试，持久数据重开、归属与信号保护通过 |
| pnpm smoke:generation-stream | 0；8 个场景，受理首帧、真实取消/断流查询、所属后端重启通过 |
| pnpm smoke:template | 0；13 个浏览器场景和 4 项控制测试，原模板/诊断导航、真实编译故障、服务不可达期限和重试通过 |
| manager | 复用 GEN-006 的 13 项已通过结果；启动、所有权、准备入口及 runtime 副本脚本摘要未变，本轮未修改生产启动/准备逻辑；共享新契约由独立准备/构建专项重新覆盖 |

主路径通过可见表单发起，实际 SDK 依次执行 list_files/read_files/submit_files，真实 SQLite 保存候选；真实 Sandpack 报价从 5000 变为 7000、10000 元。采用前 current 不变，明确采用后比对完整快照/摘要/引用；刷新及构建后端重启读取相同数据，不额外 POST 或重演活动。下一次需求明确使用已采用基线；202 取消与持久终态区分，离页断流只影响原项目。

实际故障覆盖创建已落盘但响应丢失、创建回复晚于离页、模型未配置、上游限流/拒绝、丢 terminal 后 GET 恢复、采用成功但回复丢失、A/B 与过期会话。没有自动重复创建/模型调用，没有按名称猜项目，没有以失败卡冒充助手回答。73 条历史先取最新 50 条，再加载更早保持升序、无重复和阅读锚点；修复了 StrictMode 布局重放造成的阅读位置回底问题。

1280/1024/768/375/320px、长标题/源码、键盘焦点和文件局部滚动均实测；源码与 API 完整文件一致，脚本标签仅显示文字。内部视图切换保留任务和报价输入，切换当前时不存在候选专属文件残留。最终 320px 场景以 Ctrl+Enter 创建、操作报价并明确采用，dev/preview 都通过，截图已人工复查；没有用静态截图、注入 ready 或 evaluate 代替主路径。

最终工作台报告与截图：`test-results/workspace/48c3fc29-f602-4f49-bb81-c7ada8efff4c/`。候选报告：`test-results/candidate-review/b69608bd-668d-44f4-a116-d256e5b12e96/report.json`。项目报告：`test-results/project-persistence/bb8904b9-8c1b-4a8d-b15a-ae0cda4308f4/report.json`。事件流报告：`test-results/generation-stream/65a75d55-88c7-401c-94ce-497d0a19afb5/report.json`。模板报告：`test-results/template-baseline/439ffe65-64e7-41ec-8edf-780924e21cf5/report.json`。复用 manager：`test-results/manager/5eb0dc28-6098-4586-8505-4522c0e01f77/report.json`。

综合报告：`test-results/gen-007/7f29aacc-ade9-42e2-b0bb-088c626ca6e1/report.json`，记录实际命令、日志、56 个实现/测试/配置摘要及复用边界。日志为 `/tmp/atoms-gen007-*.log`；仅本地保留忽略产物，不上传数据库、cookie、完整代码或真实环境文件。其他任务的并行修改保留；本轮没有提交、推送、归档或发布。

最终选定 change 严格校验、153 个本地文档目标、3 个锚点及 git diff --check 均通过。56 个实现/测试/配置摘要与验收时一致，所属服务已退出，3001/5173/4173 端口已释放；OpenSpec apply 状态为 all_done，12/12 完成。

边界：以上端到端为 source=fixture，使用真实 SDK/工具/存储和外部真实预览验证明确测试输出；不承诺任意模型生成质量。既有真实模型记录独立保留，本轮未调用真实模型。默认 verify/CI 的整合、最终发布部署和真实模型业务验收分别继续由 GEN-008/009/010 完成，不能将本地工作台通过当作整个 Top 1 最终验收。
