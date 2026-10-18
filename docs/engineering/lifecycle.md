# Lifecycle

本文件维护本地进程、起停状态与基础设施接入约定。调整启动入口、配置加载、进程管理或起停脚本时阅读并更新；安装、环境变量和生产服务器运行步骤见根 [README.md](../../README.md)。

## Available today

| 操作 | 当前入口与行为 |
| --- | --- |
| 开发后端 | 根目录运行 `pnpm dev:backend`；pnpm 将应用工作目录设为 `backend/` |
| 开发前端 | 在另一个终端运行 `pnpm dev:frontend`；前后端进程相互独立 |
| 停止开发服务 | 在各自终端按 Ctrl+C；后端入口处理 SIGINT、SIGTERM 并关闭 Fastify |
| 生产后端 | 构建后运行 `pnpm --filter @atoms/backend start` |
| 本地检查前端产物 | `pnpm --filter @atoms/frontend preview`；这是本地验收入口 |
| 当前基础设施 | 没有独立数据库、容器或队列服务；现有连通页面无需模型凭据 |

后端读取自身目录下的 `.env`，进程已有变量优先，配置经过解析后监听。前端开发及 preview 的代理目标来自其配置；生产反向代理由部署环境提供。

manager、Process Compose 配置与 `infra` 命令尚未实现。本地编排不接管生产服务器。

## Planned manager contract

下表记录计划中的 manager 目标。保留应用独立运行方式。

| 命令 | 行为与当前状态 |
| --- | --- |
| `bootstrap` | OPS-003 待实现：检查并安装实际依赖，不覆盖配置、不自动升级 |
| `doctor` | OPS-003 待实现：完整工具、版本、配置与端口诊断 |
| `start` | 待实现：启动并等待真实就绪，健康实例不重复创建 |
| `stop` | 待实现：停止已确认的所属实例，重复停止成功，保留数据 |
| `restart` | 待实现：同一锁内停止再启动，收敛到一组健康实例 |
| `status` | 待实现：区分 stopped、starting、unready、healthy、failed |
| `logs` | OPS-003 待实现：按服务读取日志，遵守 [日志规范](./development.md#configuration-and-logging) |

幂等按目标状态定义：重复 start/stop 不增加实例或误报失败；restart 允许重启进程，最终只保留一组健康实例。

实例、控制通道与运行文件按仓库隔离；运行产物在生成前加入忽略规则。进程管理交给现成工具，manager 只组织项目命令和状态判断。

端口被其他程序占用时报告冲突，不能通过按端口杀进程解决。部分失败应有有界等待、可诊断的失败结果和明确的恢复方式，不留下未知孤儿进程。

## Infrastructure contract

`INF-001` 接入 `infra start / stop / status` 时，空配置应明确报告“未配置外部基础设施”，不拉取占位镜像，不把空操作描述为服务已启动。

首次出现真实外部服务时，由 `INF-002` 接入 Docker Compose 并验证。基础设施就绪后再启动其依赖服务，停止按实际依赖逆序执行；停止不默认删除数据库文件或数据卷。

SQLite 接入后是应用使用的文件数据库，不需要额外数据库守护进程。迁移命令随首个实际 schema 添加；模型、数据库与容器配置按对应实现引入，不能要求当前骨架提前提供无关凭据或服务。

## Verification and updates

起停与故障场景以 [Verification](./verification.md#lifecycle-scenarios) 为准。每次能力落地后，更新本文件的可用状态、README 和必要的环境模板，避免计划命令继续被当作已实现命令。
