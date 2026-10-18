# Tasks

本清单仅规划 GEN-009，所有项待实施。前置为 GEN-001～008 的实际能力，设计与范围见 [design.md](./design.md) 和 [proposal.md](./proposal.md)；不因已有提案而视为依赖已完成。

## 1. 独立生产产物

- [ ] 1.1 GEN-009 实现 release:build 的固定 CLI、隔离源副本、offline frozen install 和一次 build，复用 GEN-008 的输入/进程辅助并补充 deploy 配置输入。验证：Node 控制测试覆盖帮助/非法参数无构建、排除真实环境/数据、越界 symlink、源码变动、缺原生前提、构建失败及已有输出拒绝覆盖；实际命令使用项目 Node/pnpm，README 维护准备步骤与阻塞分类。
- [ ] 1.2 GEN-009 为 backend/共享契约设置 files 白名单，接入固定 pnpm 默认 deploy --prod --frozen-lockfile，复制前端产物、后端模板/许可证并生成 release.json，成功才原子发布目录。验证：产物无自有源码/测试/开发依赖/环境/DB，无指向外部的链接；控制测试拒绝清单篡改、缺资产和错误平台/ABI；搬迁后实际导入共享契约并打开/读写 SQLite，Monorepo/README 记录平台限制和文件归属。

## 2. Nginx 与所属运行进程

- [ ] 2.1 GEN-009 增加独立前缀 Nginx 模板及安全渲染，落实 SPA/API/资源路由、MIME/缓存、同源头和流配置。验证：用真实 nginx -t 检查带空格路径配置，路径换行/非法注入输入拒绝；真实请求验证深链接、JS/CSS MIME、缺资源 404、API 不回退 HTML、私有文件不可下载；README/Lifecycle 记录精确 origin、共享代理 IP 限流与 TLS 未验证边界。
- [ ] 2.2 GEN-009 实现 smoke:deployment --release 的只读产物校验、搬迁布局、外置绝对 DB/环境和互斥运行，按归属启动前台 Nginx 与生产 Node。验证：控制测试覆盖缺 Nginx/Chrome、端口占用、非法/不完整包、超时、并发、中断及未知进程不被停止；实际删除本次源副本后仍能运行，未创建 Vite/tsx 进程且不读取真实 .env，Lifecycle 维护起停和目录规则。

## 3. 两阶段部署路径

- [ ] 3.1 GEN-009 以未修改发布包的生产 server.js 和无模型配置执行阶段 A。验证：浏览器经 Nginx 完成会话/项目创建、模板真实编译交互、深链接刷新和重开；错 Origin/跨会话访问拒绝，缺模型诚实失败且当前快照不变；保留同一 cookie 停启后项目/文件/digest 相同，Verification 明确生产入口和无 live 调用的覆盖。
- [ ] 3.2 GEN-009 以私有测试启动器注入本地 SDK 传输执行阶段 B，复用 GEN-007 的具体 UI 断言而不嵌套启动 Vite/另一套服务。验证：可见输入→实际工具→SQLite 候选→Sandpack 报价/筛选交互→采用→重开；经 Nginx 在上游放行前收到 accepted/真实心跳，完成/显式取消/断流状态正确；原生产入口再次重开阶段 B 成果，报告逐项标明 fixture，Verification 更新主路径与流断言。

## 4. 数据保留与异常操作

- [ ] 4.1 GEN-009 完成 SIGTERM 有界关闭、活动生成 SIGKILL 后重启恢复、冷备份/隔离恢复及错误启动配置失败后的原产物重启演练。验证：只操作本次进程/数据，按库 stale 规则等待不删锁；崩溃运行 interrupted 且无自动模型调用，当前版本不变，备份 quick_check 和恢复项目核对通过；坏配置/只读数据/过高 schema/同库第二实例在各自子副本失败且数据保留。Lifecycle 说明有停机切换和不兼容 schema 禁止自动回退，首次演练不标为跨版本迁移通过。

## 5. 命令、证据与工程接入

- [ ] 5.1 GEN-009 接入根 release:build/smoke:deployment、控制测试到 check，并复用 GEN-008 的摘要/导出/清理语义，不将 Nginx 验收加入默认 product/full 或 CI。验证：两命令独立运行，smoke 不 build/安装/改原包，旧 smoke/manager 入口语义保持；新增测试验证控制与真实应用证据分别归类、未运行的 live/公网状态不被覆盖，README/Verification 给出可照抄的本地顺序与产物路径。
- [ ] 5.2 GEN-009 完成 release 身份关联、逐阶段报告、白名单脱敏导出和有界清理。验证：控制测试拒绝旧/空/不匹配报告及越界证据，敏感哨兵不进入 export；真实正常/SIGINT/SIGTERM/启动失败路径只清理所属进程，缺前置/断言/取消/清理失败均非零，原发布包和持久数据保持；Verification 记录实际平台、耗时、报告来源及尚未验收范围。

## 6. 实际集成验收

- [ ] 6.1 GEN-009 在前置能力与 Nginx 就绪后执行 frozen install、pnpm check、pnpm verify:product、pnpm release:build，再对输出目录执行 pnpm smoke:deployment --release；依变更范围执行 pnpm test:manager 等受影响检查。验证：实际产物搬迁后生产入口/两阶段主路径/代理/数据恢复/备份和清理均有本次证据，缺环境不勾选通过；记录实际命令与未运行范围，检查相对链接、git diff --check 及 pnpm openspec validate gen-009-local-release-validation --strict --no-interactive，向 GEN-010 交付已验收 releaseDigest/origin/模型配置入口，不声称完成远端部署或真实模型验收。
