# Tasks

任务：`VER-001`，以下为本变更局部编号。

## 1. Integrated local acceptance

- [x] 1.1 VER-001 接入 pnpm verify，复用现有命令串行执行且失败即停止；同步 README、Agent 与验证文档的前提、执行顺序和覆盖矩阵，核对脚本解析、英文路径、文档链接及依赖未变。
- [x] 1.2 VER-001 实际执行完整 pnpm verify，记录版本、耗时、诊断、测试、构建、浏览器 smoke 与 OpenSpec 校验结果；核对隔离副本源码匹配及测试进程、锁、socket、暂存目录和端口清理。
- [x] 1.3 VER-001 按官方 Playwright skill 用具名会话检查真实页面快照、成功点击与窄屏，观察 smoke 截图及错误覆盖，记录实际结果并只清理本次会话/实例。

## 2. Handoff verification

- [x] 2.1 VER-001 对照工件完成 OpenSpec verify 报告与实际验收记录，核对 Agent/文档导航、技能与项目配置归属、最终差异、源码证据、Git HEAD/index、私有资料及本地产物忽略；交付已验证与未实现边界，不提交、推送或归档。

## Workflow follow-up

- 本地验收完成后，后续 CI-001 再将适合目标 runner 的检查接入 CI；本步不声称已有 CI 运行结果。
- INF-002 随首个真实外部服务接入；生成、持久化和产品工作台按各自 change 实施。
- 归档及版本控制操作按后续明确请求执行。

## Verification results

- `pnpm verify` 实际退出 0，耗时 139.975 秒；doctor、lint、类型、后端 6 项、infra 4 项、manager 13 项（含父测试）、两应用构建与浏览器 smoke 均通过；链路运行时 OpenSpec 全仓结构校验 8 项通过，交付复核含并行新增工件共 9 项通过。
- 使用固定 Playwright CLI 0.1.22 的独立会话，按最新快照点击后连接成功，375px 页面和错误截图已目视检查。既有 favicon 请求 404 作为一项非阻塞资源建议保留，详见 [verification-report.md](./verification-report.md)。
- Agent 导航、文档英文路径、技能文件/许可证、生成版本和项目范围配置入口已核对。上游内容及配置未改，不推断宿主会自动选择同名项目技能。
- 运行源码与隔离副本匹配，测试与交互式验证的实例、操作锁、socket、安装暂存目录和端口均已清理；原始证据保存在忽略的 `test-results/ver-001/`。
- 依赖、唯一 lockfile、环境模板和私有参考资料保持原样；保留并行 GEN 工件，本任务未执行暂存、提交、推送或归档。仅验证本机 macOS arm64，其他平台、真实外部基础设施、产品生成/持久化、CI 和线上部署仍待各自实现验收。
