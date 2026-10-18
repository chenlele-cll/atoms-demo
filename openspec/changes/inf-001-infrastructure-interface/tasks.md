# Tasks

任务：`INF-001`，以下为本变更局部编号。

## 1. Empty infrastructure interface

- [x] 1.1 INF-001 接入 infra start/stop/status 与 JSON；添加并执行真实 CLI 聚焦测试，验证无依赖重复/并发空操作、未配置状态、无工具调用或文件/进程副作用，以及非法参数和未接入配置失败。
- [x] 1.2 INF-001 更新帮助、README、Agent 导航与生命周期/验证文档；逐条核对可执行示例、退出语义及 INF-002 边界，保持英文路径和既有文档职责。

## 2. Integration verification

- [x] 2.1 INF-001 执行现有 manager 回归、pnpm check/build、OpenSpec 严格校验及差异/链接/忽略检查，核对私有参考、声明与 lockfile 及其他任务改动，交付实际结果并保留本地证据，不提交、推送或归档。

## Workflow follow-up

- 按原计划继续 VER-001 综合验收；INF-002 仅在首个实际外部服务需要时接入 Docker Compose。
- 归档及版本控制操作按后续明确请求执行。

## Verification results

- `pnpm test:infra` 四项通过，无跳过：无依赖/工具的隔离副本从其他工作目录执行，覆盖文本与 JSON、重复/并发空操作、已有环境/数据/状态保护、非法参数，以及 Compose 配置入口拒绝；文件快照保持一致，意外工具调用记录未产生。
- `pnpm test:manager` 共 13 项通过，无跳过，约 130 秒；保留原并发、恢复、归属与强制停止场景，并在真实健康实例上验证三个 infra 动作不改变实例记录或服务 PID，HTTP 健康检查继续通过。
- `pnpm check`（含后端六个测试）、`pnpm build`、shell/Node 语法、六条文档 infra 示例、帮助、95 个本地链接与差异空白检查通过。最终 OpenSpec 全仓严格校验七项通过；过程中另一任务的 GEN-001 曾尚未写完规格，未修改其现场。
- 隔离副本的分发与实现文件逐份匹配当前源码；验证实例记录、操作锁、安装暂存目录和 socket 已清理，3001/5173 端口已释放。
- 只新增 test:infra 脚本，没有依赖或 lockfile 改动；环境模板和私有参考资料保持原样。保留其他任务的未提交内容，本步未执行暂存、提交、推送或归档。
- 证据位于忽略的 `test-results/inf-001/`，聚焦副本位于 `test-results/infra/`。仅实测 macOS arm64；没有真实基础设施，未验证容器、数据卷、Linux/Windows 或生产部署；无 UI 改动，未重复浏览器 smoke。
