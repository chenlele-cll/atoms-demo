# Tasks

任务：`OPS-001`。编号为本变更的局部子任务，完成后据实更新复选框。

## 1. Native process configuration

- [x] 1.1 OPS-001 固定官方工具版本并验证发布校验和；安装到忽略的项目目录，通过实际 version 和原生 dry-run 核对工具与配置。
- [x] 1.2 OPS-001 接入独立前后端、端口预检、HTTP readiness、有界重试、停止信号和日志；通过真实双服务启动、代理响应与停止清理验证。
- [x] 1.3 OPS-001 更新 README、生命周期、验证和 Agent 导航；核对原生命令、环境归属、日志路径和未实现的 manager 边界。

## 2. Failure and integration verification

- [x] 2.1 OPS-001 验证前端独立启动、部分进程故障恢复、就绪失败和外部端口冲突；检查失败状态、有限重试、其他服务保护及停止后无残留。
- [x] 2.2 OPS-001 执行 pnpm check、pnpm build、OpenSpec 严格校验及文档链接检查，记录实际覆盖与平台限制。
- [x] 2.3 OPS-001 对照入口快照核对工作区范围、Git HEAD/index、私有资料和产物忽略规则；交付实际结果，不提交或推送。

## Workflow follow-up

- 下一步 `OPS-002` 实现薄层 manager 的 start/stop/restart/status 与幂等收敛；`OPS-003` 实现 bootstrap、doctor 和 logs。
- 归档、提交、推送和 PR 按后续明确请求执行。

## Verification results

- 官方 macOS arm64 归档与发布校验和一致，实际工具版本为 `v1.122.0`；二进制及 Apache-2.0 LICENSE 保存在忽略的项目目录。原生 dry-run 验证两个服务，拼错配置键会被严格解析拒绝。
- 正式配置下两个服务均为 `Running / Ready`，后端健康正文及前端 `/api/health` 代理响应符合契约；验证托管环境值覆盖冲突的继承值、实时日志文件和按服务读取日志。
- 单独选择 frontend、backend 均可启动，无虚构服务依赖。终止所属后端进程组后，原生策略恢复后端，前端 PID 保持不变，代理恢复成功。
- 分别在两个应用端口运行返回 HTTP 200 的外部测试服务，预检均拒绝占用，最多重试两次；外部服务及另一应用保留。原生全项目就绪检查返回非零，显式停止不影响外部监听者。
- 使用正式探针阈值，将后端探针路径覆盖为不存在的地址，触发两次重试；继续观察超过完整失败阈值窗口，最后一轮仍可 `Running / Not Ready`。就绪命令返回非零，显式停止后端成功且前端保留。原生自动清理未就绪进程不作为交付保证，整体等待和回滚由 `OPS-002` 实现。
- 状态标签存在实测边界：重试耗尽可显示 `Completed / Ready` 但进程已退出且退出码非零；成功恢复的运行实例可保留上一轮退出码。生命周期指南已记录判定方式，未把标签单独视为健康。
- `pnpm check`、后端六个测试和 `pnpm build` 通过；OpenSpec 严格校验通过。ESLint 排除已忽略的工具和运行产物，避免把下载的第三方示例当作应用源码检查。
- 文档链接、差异、来源、工作区及忽略规则已核对；所属进程树、socket 和应用监听均已清理。未修改应用源码、workspace 依赖、既有技能、Git HEAD/index 或私有参考材料；未提交、推送或归档。
- 本地证据位于忽略的 `test-results/ops-001/`，运行文件在 `.runtime/process-compose/`。本步为真实 HTTP 和进程验收，没有重跑浏览器 smoke；未验证 Linux/Windows、日志容量压力、manager 并发幂等、基础设施或生产部署。
