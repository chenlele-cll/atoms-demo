# Tasks

任务：`OPS-002`，子任务使用本变更局部编号。

## 1. Manager implementation

- [x] 1.1 OPS-002 添加薄 shell/Node 入口、精确锁依赖、串行操作及实例身份；验证帮助、非法输入、frozen install、版本与锁的实际运行。
- [x] 1.2 OPS-002 实现 start/stop/restart/status、真实就绪截止时间和停止/回滚；验证健康重复 start 不换 PID、重复 stop、重启与状态 JSON。
- [x] 1.3 OPS-002 更新生命周期、README、Agent 及文档导航；检查实际入口、状态/退出码、恢复方式和尚未实现的 OPS-003 边界。

## 2. Behavior and integration verification

- [x] 2.1 OPS-002 用真实服务验证并发调用、端口冲突与外部服务保护、部分失败、就绪超时、中断回滚、崩溃后记录/锁恢复及跨仓库隔离；检查退出结果和清理。
- [x] 2.2 OPS-002 执行聚焦行为测试、pnpm check、pnpm build、OpenSpec 严格校验及文档链接检查，记录实际覆盖。
- [x] 2.3 OPS-002 对照入口快照确认既有改动、Git HEAD/index、私有资料与产物忽略保护；停止验证实例，交付结果，不提交或推送。

## Workflow follow-up

- `OPS-003` 后续实现 bootstrap、doctor 和 logs；INF 与 VER 按既有计划推进。
- 归档、提交、推送与 PR 按后续明确请求执行。

## Verification results

- `manager.sh` 可从其他 cwd 执行，帮助和参数校验、状态退出码、默认截止时间及 JSON 已通过实际命令核对。Node/pnpm/Process Compose 在启动前检查，stop 不依赖重新启动这些工具。
- frozen install 通过，锁直接复用精确依赖 `proper-lockfile@4.1.2`，未自写锁协议或常驻守护器。原生 API 的主机名前缀按官方定义处理，状态与认证不输出秘密。
- `pnpm test:manager` 九组真实进程场景全部通过（Node runner 含父测试共十项），耗时约 104 秒。隔离副本包含空格和深路径，以离线 frozen install 获得真实依赖；测试与当前辅助入口逐字节一致。
- 验证了三次并发 start 收敛到同一组 PID、重复健康 start 不换 PID、restart 换实例，以及混合并发 start/stop/restart 串行执行。
- 验证了原生后端恢复后保留上一轮 `exitCode: -1` 时仍正确判断健康，前端 PID 不变；两种外部 HTTP 200 监听均受到保护，未按端口终止程序。
- 就绪超时回滚、SIGTERM 中断回滚、SIGKILL 调用者后的 30 秒陈旧锁恢复、supervisor 退出后的子树清理、陈旧 PID、跨副本控制隔离及未知 socket 保护均通过。补充在当前仓库实测 SIGINT 返回 130，回滚后重复 stop 成功。
- 无响应 supervisor 的身份校验和强制清理通过，约 30 秒内停止；所属实例记录、锁、socket 和应用监听均已释放，日志与依赖保留。
- `pnpm check`、后端六个测试、`pnpm build`、shell/Node 语法、文档链接及 OpenSpec 严格校验通过。未修改应用源码、原生配置、既有技能或私有参考材料；Git HEAD/index 未变，无提交、推送或归档。
- 本地证据在忽略的 `test-results/ops-002/` 与 `test-results/manager/`。本步未重跑浏览器 smoke，未验证 Linux/Windows、网络文件系统、恶意同用户程序、生产部署或尚未实现的 OPS-003/INF 能力。
- 最终范围核对发现 `docs/architecture/stack-decisions.md` 被并行修改，并新增 `docs/product/core-paths.md`；本任务未写入这两个文件，保留其现状，范围报告单独记录，未将其纳入 manager 改动。
