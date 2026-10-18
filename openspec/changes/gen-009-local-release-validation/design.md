# Design

## Context

动机见 [proposal.md](./proposal.md)。当前生产后端入口为 backend/dist/server.js，依赖后端工作目录加载可选 .env；前端 dist 由外部 Web 服务器提供。README 只有最小 Nginx 示例，尚无发布包、SSE 代理配置或部署验收命令。manager/Process Compose 负责开发环境，不承担生产监督。

前置规划均未实施：[GEN-003](../gen-003-project-persistence-api/design.md) 确定 SQLite、同源会话与后端模板资产，[GEN-005](../gen-005-generation-stream-control/design.md) 确定单库所有权、流和关闭，[GEN-006](../gen-006-candidate-preview-adoption/design.md) 引入共享契约，[GEN-007](../gen-007-project-workspace/design.md) 提供 UI 主路径，[GEN-008](../gen-008-integrated-regression/design.md) 提供隔离与报告辅助。本任务依赖实际可用的这些实现，不通过空脚本或预种项目冒充闭环。

已只读核对本机为 Darwin arm64，PATH 中未发现 nginx；这不是 Nginx 运行通过。根固定 pnpm 12.11.2 的 deploy 帮助支持 prod/frozen-lockfile，官方文档说明当前版本可部署 linked workspace；仍需用锁定版本实测共享契约和 SQLite 的完整性。

## Goals / Non-Goals

**Goals:**

- 交付一个能够搬迁后独立运行的生产产物，用真实 Nginx 和构建后端验证同源访问及代理行为。
- 将已编译文件、运行依赖、配置、持久数据和测试证据分清，防止依赖开发目录或覆盖数据。
- 为真实模型验收保留明确入口和可信产物身份。

**Non-Goals:**

- 不实现新的产品接口、数据库模型、后台任务、可信代理策略或生产模型替身模式。
- 不建立通用部署管理器、Docker/Kubernetes、多副本、零停机切换、自动 TLS 或 CI 自动发布。
- 本地 loopback HTTP 不构成公网 HTTPS/实际服务器验收；GEN-010 负责真实付费模型调用，已有服务器的接入需要对应环境事实。

## Decisions

### 1 两个独立命令，部署验收不隐式重建

新增 scripts/release.mjs 与 `pnpm release:build`；无参数构建新的 releaseId，可用 --json 返回最小产物定位信息，帮助/非法参数不构建。输出为忽略的 `.runtime/releases/<releaseId>/`，ID 使用 UUID，已有目录拒绝覆盖。暂存成功后才原子改名为最终目录；失败没有可用标记，保留本次私有诊断。

新增 scripts/deployment-smoke.cjs 与 `pnpm smoke:deployment --release <path>`，要求显式传入完整发布目录。它只验收指定产物，不 build、不补装依赖、不改写原包；与 GEN-008 的常规 product/full 分开运行，避免给普通 CI 增加 Nginx 或部署前置。发布脚本和测试控制测试纳入现有 check，业务产品回归仍由原拥有者维护。

实施后的最短顺序为 `pnpm verify:product` → `pnpm release:build` → `pnpm smoke:deployment --release <输出目录>`。前两个命令各有独立的构建身份；不能将前一次产品结果当成后一产物已验收，后一命令必须检查实际发布字节。

### 2 复用隔离源副本与 pnpm 生产部署

复用 GEN-008 的具体源副本/摘要辅助，补入本任务实际需要的 deploy 配置输入；不得将 .env、数据、个人认证、旧 dist/node_modules 或私有资料复制进去。原工作区只读，允许当前未提交实现进入指纹；构建开始/结束核对输入，变化标记 STALE_INPUT。

隔离副本 offline frozen install，使用 GEN-003 的显式原生构建许可，实际打开/读写临时 SQLite；缺缓存或原生构建前提报 blocked，不切换 ignore-scripts 或复制本机依赖。随后执行一次 `pnpm build`，生成共享契约、模板和两应用产物。

在该副本执行 `pnpm --filter @atoms/backend deploy --prod --frozen-lockfile <暂存目录/backend>`，采用固定版本默认实现，不额外开启全仓 injected workspace 或 legacy 分支。为 backend 和 @atoms/contracts 设置最小 files 白名单包含 dist；后端资产及模板许可证必须在 dist 内，契约包包含自己的 package.json、dist 和运行依赖。前端只复制 frontend/dist 为发布目录的 frontend/。不手工递归解析依赖或保留指向源工作区/store 的外链。

[pnpm 官方 deploy 文档](https://github.com/pnpm/pnpm/blob/main/pnpm/docs/cli/deploy.md) 说明生产依赖和 workspace 包会进入独立 node_modules，并支持通过 files 控制自有文件集合；实施以固定版本的实际产物为准。若发现缺包/原生绑定失败，修正声明、构建或 files 后重验，不静默改变打包模式。

发布布局仅含 frontend/、backend/、部署配置模板和 release.json；不携带本次源副本/测试启动器/测试模型传输/.env/数据库。第三方依赖自身的源码或 map 按依赖包正常保留，自有应用不携带 src、test 和开发工具；不通过全局禁止所有 src 文件损坏第三方运行包。

release.json 记录 schemaVersion、releaseId、源/lock 摘要、Node/pnpm 精确版本、platform/arch/Node modules ABI、模板 id/version/digest 和文件清单摘要；逐项覆盖普通文件内容、模式及符号链接目标，清单不递归包含自身。所有链接 realpath 必须在发布目录内。清单是完整性与可追溯依据，不宣称是签名或供应链认证。

better-sqlite3 为原生依赖，发布包只支持构建并验收过的系统、架构、ABI；目标平台不同就在目标平台 frozen install/build/deploy，不将 Darwin node_modules 上传 Linux。发布包外移后还要执行真实 SQLite 和后端模块加载，不只检查文件存在。

### 3 Nginx 配置对应产品的同源和流边界

新增 deploy/nginx.conf.template，渲染为本次私有前缀的完整配置，使用绝对静态根、独立 pid/log/temp 路径；验证用 `127.0.0.1:8080` 对外、后端 `127.0.0.1:3001`。先真实 bind 检查端口，再执行 nginx -t，实际启动的 bind 失败仍非零；不访问系统默认配置或使用 sudo。Nginx 从显式 NGINX_BIN 绝对可执行路径或 PATH 发现，记录实际版本和配置摘要，不自动安装/升级系统软件。

| 路径 | 处理与可观察要求 |
| --- | --- |
| 精确 /api 与 /api/ 前缀 | 原 URI/查询/方法转发后端；不加 proxy_pass 尾斜杠改写路径；API 404 和失败不进入 SPA |
| /assets/、/template-assets/ | 文件存在才返回；缺失为 404，不回 index.html |
| 平台其他路由 | 已知静态文件正常提供；其余回 index.html，由客户端处理项目深链接和未知路由 |
| 隐藏路径、.env、数据库等 | 拒绝读取；静态根只指向 frontend/，不能指到整个 release 或持久目录 |

固定 HTTP/1.1 上游，清除 Connection 头；传递原 Host（含非默认端口）、Origin、Cookie、Set-Cookie 和路径。trustProxy 继续 false，不把 X-Forwarded-For 当身份；清除客户端自带转发头并由 Nginx 设置真实一跳值。后端仍按自己看到的代理地址执行已有 IP 限流，公开单机 Demo 会共享配额；文档写清限制，本任务不改变 GEN-005 的安全模型。

API location 明确 proxy_buffering off、proxy_cache off、proxy_ignore_client_abort off、proxy_intercept_errors off、proxy_next_upstream off、gzip off，connect timeout 5s、read timeout 150s、send timeout 30s。read timeout 控制相邻读取间隔，不替代后端总期限；流每 10s 心跳，业务最长 120s。JSON 请求仍可正常缓冲，body 上限 32KiB 容纳 GEN-005 合法输入，细粒度大小限制继续由后端负责；超限请求不得被转成 HTML 成功。Nginx 的[缓冲/断线/超时语义](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)只是配置依据，是否正确仍以网络断言为准。

index.html 使用 no-cache，带 hash 的 /assets/ 可长期 immutable，模板资产使用可重新校验策略；API 保留后端 no-store。提供可验证的 MIME 映射，检查 JS/CSS Content-Type。SPA 的[路径回退依据](https://nginx.org/en/docs/http/ngx_http_core_module.html#try_files)及[独立前缀/配置检查命令](https://nginx.org/en/docs/switches.html)只使用官方已存在能力，不引入新服务器实现。

### 4 数据与配置不进入版本产物

本地验收布局为 `test-results/deployment/<runId>/{releases,shared,private,export}/`。原产物复制到 releases/<releaseId>，校验完整性后运行；shared/data/atoms.sqlite 为绝对 DATABASE_PATH，shared/config/ 为可选私有后端配置，private 保存受控测试传输和日志。运行 cwd 固定为搬迁后 backend/，使用项目 Node 的绝对路径执行 dist/server.js，NODE_ENV=production；清除继承的 NODE_PATH/NODE_OPTIONS，不需要 pnpm、tsx、Vite 或原工作区模块参与运行。原隔离源副本删除后再启动，不能改名/删除用户的原工作目录来制造隔离。

生产配置由外部监督器注入；本地测试也传入精简环境，不复制真实 .env，不改变 HOME 等系统含义。只有后端得到 DATABASE_PATH、HOST/PORT、APP_ORIGINS；模型凭据仅在后续明确 live 验收时注入，不写清单/前端/模板。frontend 没有 backend 的文件路径或密钥。

本地 APP_ORIGINS 精确为 http://127.0.0.1:8080，沿用 GEN-003 的 loopback 非 Secure Cookie；不能混用 localhost 导致来源/会话不一致。公网指引使用精确 https://实际域名，按既有配置产生 Secure Cookie；不伪造转发头绕过来源校验。没有实际 TLS 服务时仅能记录配置/已有规则检查，公网传输与 Secure Cookie 实测标 not-run。

数据目录需写入权限且位于产物外。启动不得自动退回空库/内存库；坏配置、只读目录、缺资产、过高 schema 或同库所有权冲突均应失败并保留原数据。验证停止后保留相同 cookie 再重开项目；丢失匿名 cookie 无法恢复归属的产品边界保持。

### 5 先验真实生产入口，再用测试传输验收生成

阶段 A 使用未修改发布包的 `node dist/server.js`，不提供模型配置。浏览器经 Nginx 创建会话/项目、操作真实模板预览、刷新深链接、查看持久快照并重启重开；健康和模板/存储无需模型即可工作。缺少模型时的生成请求只能诚实失败并保持当前版本，不能返回 fixture 成果。

阶段 B 停止 A 的所属后端并确认退出后，测试专用启动器从搬迁产物导入真实 dist 应用和配置/存储，复用 GEN-002/004 的本地受控 SDK 上游与假密钥。替身只在应用构造参数注入，启动器保留在 private 而不发布；继续使用同一 Nginx 配置。它证明真实 SDK/工具/SQLite/预览与代理集成，不能标记为真实生产入口访问真实模型。

提取 GEN-007 主路径中真正重复的浏览器断言为可传入 origin 的具体辅助，原 smoke:workspace 保留自己的生命周期。部署 runner 管理本次服务，只复用交互步骤和报告，不嵌套启动另一个 Vite/后端；不复制整个产品测试套件。

| 必需用例 | 实际断言与来源 |
| --- | --- |
| 产物独立性 | 搬迁后不可访问原源副本；无外链和开发依赖仍启动，原生 SQLite、契约导入、前后端模板资产实际可用 |
| 静态与路由 | 首页、带 hash 的 JS/CSS MIME、项目深链接刷新正确；缺资源/API 未知路由非 HTML 200，私有配置/数据无法静态下载 |
| 同源与归属 | 经代理创建 cookie/项目并重开；POST 缺/错 Origin 被拒，另一浏览器无法读取项目，后端断开时前端诚实显示失败 |
| 阶段 A 持久化 | 无真实模型仍可模板创建/预览；生产入口停启后同会话读到相同 current/version/文件，未换成新库 |
| 阶段 B 主路径 | 可见 UI 输入→受控 SDK 工具→候选真实编译→报价/筛选交互→采用→刷新/重启重开，核对同一 current/digest 和调用次数 |
| 代理流 | 上游暂停完成，浏览器在放行前已收到 accepted 和至少一次真实 10s 心跳；分别验证完成、取消、读流 abort 的最终状态，不将整段返回当首帧 |
| 中断恢复 | 活动受控生成时对所属后端 SIGKILL，按锁库 stale 规则重新启动后原 run=interrupted/PROCESS_RESTARTED，当前快照不变、无自动新模型调用；SIGTERM 单独核对 GEN-005 的有界取消与释放，不混淆为崩溃恢复 |
| 冷备份与失败切回 | 停服备份副本通过 quick_check；仅在隔离数据副本做恢复演练；启动错误配置失败后，用原产物/原数据重新启动仍能重开项目 |

阶段 B 正向预览必须实际操作新增控件，Sandpack 网络不通是阻塞/失败，不能改用假 ready。正常进程、故障进程和阶段来源写入每个 case 的报告；阶段 B 后再次启动原生产入口检查已采用快照，避免只验收可注入构造器而遗漏 server.ts。

### 6 有停机的切换和冷备份，避免数据库伪回退

运维步骤维护在 Lifecycle，README 只给入口：准备并验收新产物 → 所属监督器停止旧后端且确认退出 → 冷备份 shared/data 下数据库及仍存在的 WAL/SHM → 用发布包里的 SQLite 依赖只读检查备份 quick_check → 设置新产物工作目录/静态根 → nginx -t → 启动一个后端 → 健康/同源/项目重开检查 → 重载所属 Nginx。不启动两个后端抢同库，不复制运行中的单个 .sqlite 文件，不手工删除 generation.lock。

验收 runner 只操纵自己的进程/目录；真实服务器的监督器、服务名、TLS 和目录需要具体接入后替换文档占位，不能自动改 /etc、sudo、SSH 或系统服务。已验收旧产物保留；新启动失败时先停掉本次新进程，再按同样步骤重新启用相容旧产物。回退应用不回退数据，不覆写快照。

若新版本已迁移数据库且旧程序不兼容，禁止自动降级或直接恢复旧备份覆盖当前库；停止切换并保留现状，使用相容应用或单独评审恢复。首次验收用同一产物和错误启动配置演练失败后重新启用，只证明操作与数据保留；没有真实旧版本时不声称跨版本迁移/回滚已通过。

### 7 报告、时间预算与进程归属沿用既有工程

报告复用 GEN-008 的 runId、schema/源/构建身份、白名单导出及 passed/failed/blocked/cancelled/not-run；增加 releaseDigest、实际 Node/Nginx 平台信息、配置摘要和阶段来源。文件清单不匹配、空/旧报告、仅退出 0 或清理不完整都不是通过。打包诊断与部署报告关联，但各自只报告实际执行的命令。

release:build 初始总预算 10 分钟；deployment smoke 10 分钟，正常启动就绪 30s，预览 60s，信号清理 10s，SIGKILL 后因所有权 stale 等待重启可单独到 45s。使用实际计时与清晰阶段输出，网络/原生依赖缺失明确非零；不通过缩减必需断言满足预算。

复用已有锁库对本仓库部署验收互斥，绑定端口/DB 与本次拥有者，保留正常 PID/启动身份；Nginx 以前台 daemon off 作为所属子进程启动，仅对其前缀和进程发信号。取消时先停浏览器/在途请求，再结束本次后端与 Nginx；不执行系统范围 nginx -s stop，不按端口杀进程，未知占用直接报 blocked。

摘要可导出 release 身份、观察代码和经确认遮罩截图，数据库、cookie/storageState、源码/提示词、原始日志、实际配置/密钥文件只留私有。使用与 GEN-008 相同的敏感哨兵/路径控制检查；未发生的公网部署、live 模型和 hosted CI 分别为 not-run，不被本地成功覆盖。

## Risks / Trade-offs

- Nginx 尚未安装 → 实施前按官方平台安装说明准备并记录实际版本；命令缺失即阻塞，不降级为 Vite 通过。
- pnpm deploy 与 workspace/原生包可能暴露打包缺口 → 固定工具、明确 files、搬迁后真实加载/读写，先修依赖再验收。
- 本地 HTTP 未覆盖公网 TLS/多层代理 → 同源和模型验证分别记录，最终环境接入后重跑相应检查，不声称公网完成。
- 外部 Sandpack/bundler 仍需网络 → 保留原超时和真实编译断言，配置上线前从实际访问环境确认可达。
- 单机后端和代理共享 IP 限流、切换有停机 → 适用于面试 Demo；将限制写入运行指引，不在此引入分布式架构。
- 数据库迁移使旧版本不兼容 → 备份、schema 拒绝和不覆盖数据优先，失败切回演练不冒充通用数据库回滚。

## Migration Plan

1. GEN-001～008 可用后落实发布文件集合/控制测试，保留独立开发、manager 和产品回归入口。
2. 实现隔离构建与 pnpm 生产打包，检查清单、原生绑定和共享契约；更新 Monorepo/README 的发布边界。
3. 增加 Nginx 模板、同源运行和外置配置/持久目录说明；仅在本次私有前缀验证，不改系统配置。
4. 接入产物搬迁、生产入口和测试 SDK 两阶段验收、持久化/流/恢复和冷备份演练，更新 Verification/Lifecycle。
5. 执行实际工程、产品回归、release build、deployment smoke 和文档/OpenSpec 检查，记录当前平台结果及所有未运行范围。
6. 若撤回本工程方案，只撤回发布/验收入口与配置；保留已有产物、证据和持久数据，不改写上游任务状态。向 GEN-010 交付已验收的 releaseDigest、origin、启动步骤和模型配置入口。
