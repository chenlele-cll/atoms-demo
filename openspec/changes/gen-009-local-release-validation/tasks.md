# Tasks

本清单跟踪 GEN-009 实施与本机实测，未完成项保持未勾选。前置为 GEN-001～008 的实际能力，设计与范围见 [design.md](./design.md) 和 [proposal.md](./proposal.md)；不因已有提案而视为依赖已完成。

## 1. 独立生产产物

- [x] 1.1 GEN-009 实现 release:build 的固定 CLI、隔离源副本、offline frozen install 和一次 build，复用 GEN-008 的输入/进程辅助并补充 deploy 配置输入。验证：Node 控制测试覆盖帮助/非法参数无构建、排除真实环境/数据、越界 symlink、源码变动、缺原生前提、构建失败及已有输出拒绝覆盖；实际命令使用项目 Node/pnpm，README 维护准备步骤与阻塞分类。
- [x] 1.2 GEN-009 为 backend/共享契约设置 files 白名单，接入固定 pnpm 默认 deploy --prod --frozen-lockfile，复制前端产物、后端模板/许可证并生成 release.json，成功才原子发布目录。验证：产物无自有源码/测试/开发依赖/环境/DB，无指向外部的链接；控制测试拒绝清单篡改、缺资产和错误平台/ABI；搬迁后实际导入共享契约并打开/读写 SQLite，Monorepo/README 记录平台限制和文件归属。

## 2. Nginx 与所属运行进程

- [x] 2.1 GEN-009 增加独立前缀 Nginx 模板及安全渲染，落实 SPA/API/资源路由、MIME/缓存、同源头和流配置。验证：用真实 nginx -t 检查带空格路径配置，路径换行/非法注入输入拒绝；真实请求验证深链接、JS/CSS MIME、缺资源 404、API 不回退 HTML、私有文件不可下载；README/Lifecycle 记录精确 origin、共享代理 IP 限流与 TLS 未验证边界。
- [x] 2.2 GEN-009 实现 smoke:deployment --release 的只读产物校验、搬迁布局、外置绝对 DB/环境和互斥运行，按归属启动前台 Nginx 与生产 Node。验证：控制测试覆盖缺 Nginx/Chrome、端口占用、非法/不完整包、超时、并发、中断及未知进程不被停止；实际删除本次源副本后仍能运行，未创建 Vite/tsx 进程且不读取真实 .env，Lifecycle 维护起停和目录规则。

## 3. 两阶段部署路径

- [x] 3.1 GEN-009 以未修改发布包的生产 server.js 和无模型配置执行阶段 A。验证：浏览器经 Nginx 完成会话/项目创建、模板真实编译交互、深链接刷新和重开；错 Origin/跨会话访问拒绝，缺模型诚实失败且当前快照不变；保留同一 cookie 停启后项目/文件/digest 相同，Verification 明确生产入口和无 live 调用的覆盖。
- [x] 3.2 GEN-009 以私有测试启动器注入本地 SDK 传输执行阶段 B，复用 GEN-007 的具体 UI 断言而不嵌套启动 Vite/另一套服务。验证：可见输入→实际工具→SQLite 候选→Sandpack 报价/筛选交互→采用→重开；经 Nginx 在上游放行前收到 accepted/真实心跳，完成/显式取消/断流状态正确；原生产入口再次重开阶段 B 成果，报告逐项标明 fixture，Verification 更新主路径与流断言。

## 4. 数据保留与异常操作

- [x] 4.1 GEN-009 完成 SIGTERM 有界关闭、活动生成 SIGKILL 后重启恢复、冷备份/隔离恢复及错误启动配置失败后的原产物重启演练。验证：只操作本次进程/数据，按库 stale 规则等待不删锁；崩溃运行 interrupted 且无自动模型调用，当前版本不变，备份 quick_check 和恢复项目核对通过；坏配置/只读数据/过高 schema/同库第二实例在各自子副本失败且数据保留。Lifecycle 说明有停机切换和不兼容 schema 禁止自动回退，首次演练不标为跨版本迁移通过。

## 5. 命令、证据与工程接入

- [x] 5.1 GEN-009 接入根 release:build/smoke:deployment、控制测试到 check，并复用 GEN-008 的摘要/导出/清理语义，不将 Nginx 验收加入默认 product/full 或 CI。验证：两命令独立运行，smoke 不 build/安装/改原包，旧 smoke/manager 入口语义保持；新增测试验证控制与真实应用证据分别归类、未运行的 live/公网状态不被覆盖，README/Verification 给出可照抄的本地顺序与产物路径。
- [x] 5.2 GEN-009 完成 release 身份关联、逐阶段报告、白名单脱敏导出和有界清理。验证：控制测试拒绝旧/空/不匹配报告及越界证据，敏感哨兵不进入 export；真实正常/SIGINT/SIGTERM/启动失败路径只清理所属进程，缺前置/断言/取消/清理失败均非零，原发布包和持久数据保持；Verification 记录实际平台、耗时、报告来源及尚未验收范围。

## 6. 实际集成验收

- [x] 6.1 GEN-009 按用户授权在独立快照（仅排除两份未完成 REV 恢复测试，保留原工作区与默认检查规则）中，在前置能力与 Nginx 就绪后执行 frozen install、pnpm check、pnpm verify:product、pnpm release:build，再对输出目录执行 pnpm smoke:deployment --release；依变更范围执行 pnpm test:manager 等受影响检查。验证：实际产物搬迁后生产入口/两阶段主路径/代理/数据恢复/备份和清理均有本次证据，缺环境不勾选通过；记录实际命令与未运行范围，检查相对链接、git diff --check 及 pnpm openspec validate gen-009-local-release-validation --strict --no-interactive，向 GEN-010 交付已验收 releaseDigest/origin/模型配置入口，不声称完成远端部署或真实模型验收。

## Implementation evidence

- 2026-10-18：已实现固定 release:build、隔离 frozen/offline install、真实 SQLite、一次构建与固定 pnpm 默认 deploy；backend files 白名单为 dist，共享契约保留已有 dist 白名单。产物逐项校验字节/模式/内部链接、平台/ABI、模板/许可证，原子发布且已有输出拒绝覆盖。
- 已实际构建并搬迁两次初期包，026ab7be-18be-4482-b390-2d737fecd2f0 的 releaseDigest 为 0c164b35938a347edf0902b76a0173e780bf3fe651a1928fead3998ceaf5afb7，14 秒内完成；源副本成功后删除，搬迁契约导入/SQLite 读写实际通过。该身份属于早期阶段，最终交接以后续完整验收包为准。
- 官方 nginx.org 的 nginx 1.30.6 源码在忽略的 .tools/nginx/1.30.6 下本地编译，仅作测试，不改系统服务。真实 nginx -t 在带空格 prefix/static root 下通过，MIME/缓存/SPA/缺资源/API/私有文件均经实际请求断言。
- d7a729b3-4b40-4f98-9e97-7cffe0928af8 的阶段 A 生产入口完成无模型创建/真实模板编译/深链接/会话隔离/精确 Origin/相同 cookie 停启重开；阶段 B 的可见生成/真实报价/采用、代理心跳/完成/取消/断流/SIGTERM 也通过。但该轮 crash-recovery 计数断言失败，整轮仍 failed，不能作为最终部署通过；已改为确认 SDK 请求真实到达挂起上游后才注入故障。
- 初期模板状态定位错误和两个外部副本端口竞争均保留 failed/cancelled/blocked 记录；修正测试定位并新增健康正文/监听 PID 归属检查，不终止外部占用者，不把其他实例响应视为本轮通过。
- pnpm test:release 当前 14/14，pnpm lint 退出 0；第一次 pnpm check 退出 0（当时 263 测试），后续变化还需最终 check/product/release/deployment 实测。全部测试传输使用假凭据/loopback，未读真实 backend/.env，未执行 live 模型或远端部署。

- 首次完整本机部署报告：test-results/deployment/2d62d9ae-6b1d-4a41-9c9a-3eaf0716e05f/export/summary.json，16/16 passed，cleanup passed，耗时 72118ms；包为 78b65aa6-3235-4cd1-9120-ce9cd0337026，releaseDigest 536ab305ff79b52e5ec5105d2295804a5255288564cc80735614c7f92fd08717，生产 buildDigest 29674dd793de3bd08b9384d2fff88a278241ba0677a2a842b55b77d853ae5caa。本地 SDK HTTP 共 10 次，realModel/publicHTTPS/hostedCI 均 not-run；后续目录护栏/完整冷备份复制的最终代码仍需新包复验。
- 正常生产/fixture/生产三阶段、实际 gate 前 accepted/10s 心跳、真实报价/采用、取消/断流、无需 SIGKILL 的 SIGTERM、确认 SDK 到达后的硬杀/32s stale/interrupted/无重发、冷备份 quick_check/隔离恢复及坏配置/只读/高 schema/同库冲突均实际通过。仅同版本失败重启，未声称跨版本 schema 回滚。
- Nginx 1.30.6 官方源码包本次 SHA-256：3cf46f5ed7504d460125866b7bea99fb357f31d887e2e63b35503310e9b8b6c8。私有编译工具未进入发布包，测试命令不会自动下载/安装 Nginx。

- 最终代码的 pnpm check 退出 0：269 测试（release 控制 16、原验证控制 23、契约准备 1、后端 197、前端 32），lint/types 同时通过。pnpm verify:product 的 gen009-product-final 通过 29 个浏览器 case，耗时 133162ms，一次 build，cleanup passed；buildDigest 与所有本机生产包的实际 app 构建字节一致。产品报告与独立发布/部署身份分别保存，不用产品结果代替产物验收。
- 已实测 pnpm test:deployment-control，7/7，约 22s：缺 Nginx 返回 blocked/2；外部真实监听保持；已有锁不接管；实际 Nginx/生产后端运行后发 SIGINT/TERM，分别 130/143 且清理/端口释放通过；缺文件的真实包返回 RELEASE_CHANGED/1；原包身份不变。控制证据单列 evidenceKind=control-test，不冒充完整应用/真实模型通过；export 只含白名单摘要，敏感哨兵与未知字段测试通过。
- 首轮交接包本身通过全部正常/故障验收，但随后外部任务同步了候选页刷新互斥修复并造成五处 stash-pop 冲突，源指纹复核正确发现交接包已不是当前源码。已保留双方新增内容、解决标记冲突并仅标记这五处为 resolved，未提交/推送；当前需对合并后的代码重新执行 product、受影响候选专项及 release/deployment 验收，6.1 继续未勾选。manager/Process Compose、Ansible 和 hosted CI 未改动其运行职责，本轮不重复 GEN-008 已实测的 manager 专项，不执行真实远端 apply。

- 用户明确授权：最终以独立快照验收 GEN-009，仅排除并行任务未实现的 backend/test/version-restoration.test.ts 与 backend/test/version-restoration-network.test.ts；原工作区两文件保留，根 check/测试配置不作修改。当前应用、GEN-006 刷新互斥修复和 GEN-009 实现均进入快照。原工作区的协调后 check 因新 REV 测试 lint/缺配套契约阻塞，gen009-product-coordinated 为 failed，不计通过；此前合并过程的 gen009-product-merged 为 STALE_INPUT，不计通过。
- 授权快照为 .runtime/gen009-acceptance/96e6c376-aac5-4fef-b526-969898b16cc4/workspace，私有 baseline.json 列明精确排除项与源指纹；独立 Git 索引只属于该快照，未切换/回退原工作区。已 offline frozen install；将在该基线用未改动的公共 check/product/release/deployment 命令验收，并将不可变包校验后复制回原仓库。

## Final acceptance

- 2026-10-18，GEN-009 在用户指定的冻结快照 96e6c376-aac5-4fef-b526-969898b16cc4 完成全部验收。仅排除上述两份未完成 REV 测试；后续原工作区继续出现的 REV/DEP 改动不纳入这个已冻结基线，也不覆盖或回退它们。此处记录是本次最终交接，前述初期包/失败/阻塞记录保留其原状态。
- 公共命令实际执行：offline frozen install；pnpm verify:product（内部原样执行 pnpm check，269/269，以及模板/infra、一次 build、29 个浏览器 case）；pnpm release:build --json；pnpm smoke:deployment --release <该包>；pnpm test:deployment-control。依次退出 0，无跳过必需产品/部署场景。当前应用的独立 pnpm build 与 pnpm smoke:candidate 也通过，21/21，cleanup passed，fixture 请求 2、真实模型 0。
- 产品 run 为 gen009-approved-snapshot，耗时 131190ms；发布构建 13364ms、一次 build；真实 Nginx 部署 run 为 e9945ce6-3c78-4b26-b496-e4233fd01c73，16/16、71920ms、fixture SDK 请求 10、cleanup passed；真实故障控制 7/7、27291ms。两个命令和所有报告身份分别核对，控制结果为 control-test，不冒充应用正常链路或 live 模型。
- 发布包 c2b0a75c-d7c0-4ab6-bde1-ec718ed7e875 已完整复制到原仓库 .runtime/releases/c2b0a75c-d7c0-4ab6-bde1-ec718ed7e875/，复制前后 releaseDigest 均为 d34051f379352cbf13ba3e9c2aa49064742b68c4d0ab85950fdd87dd291a79d7。冻结快照的 release 输入指纹为 84c1687c48dcdb71a05fd1b28530db28122113f4643b45bc5ead2ef9d390ffe3；产品与发布实际 app buildDigest 一致，均为 91b2ad39ef05b51be3d43bdd308ef6892cc4d460a932bc51b9ac317c71c3e6d5。
- 平台 Darwin arm64、Node v22.22.2、modules ABI 127、pnpm 12.11.2、Nginx 1.30.6。本次构建源副本已实际删除；复制回原仓库后再次完整清单校验，并从包内真实导入契约、打开/写入/读取 SQLite，退出 0、cleanup passed。没有依赖 Vite/tsx、原源副本、真实 .env 或真实模型凭据。
- 最终摘要 test-results/gen-009/report.json；白名单分享证据位于 test-results/gen-009/accepted/{product,deployment}/，故障控制为 accepted/control-report.json；源/DB/日志/配置留在各 private/shared 目录，不导出。原工作区默认检查保持包含所有 REV 文件；本次通过只声明上述授权冻结基线，未声明后续混合工作区整体通过。
- GEN-010 交接入口：已验收本地 origin 为 http://127.0.0.1:8080，运行包外置绝对 DATABASE_PATH 与精确 APP_ORIGINS；模型只由生产后端外部环境注入 OPENAI_API_KEY、OPENAI_BASE_URL、MODEL_ID 及既有预算项，不进入前端或发布包。用户真实凭据仍由既有私有配置管理，本轮不读取/复制/回显。真实模型、远端部署、公网 HTTPS、hosted CI 及跨版本 schema 回滚均 not-run。
