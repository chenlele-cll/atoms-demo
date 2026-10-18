# Lifecycle

本文件维护本地进程、起停状态与基础设施接入约定。调整启动入口、配置加载、进程管理或起停脚本时阅读并更新；安装、环境变量和生产服务器运行步骤见根 [README.md](../../README.md)。

## Available today

| 操作 | 当前入口与行为 |
| --- | --- |
| 开发后端 | 根目录运行 `pnpm dev:backend`；pnpm 将应用工作目录设为 `backend/` |
| 开发前端 | 在另一个终端运行 `pnpm dev:frontend`；前后端进程相互独立 |
| 停止开发服务 | 在各自终端按 Ctrl+C；后端入口处理 SIGINT、SIGTERM 并关闭 Fastify |
| 原生开发编排 | 根 [process-compose.yaml](../../process-compose.yaml) 管理前后端，操作见下节；工具版本由 [.process-compose-version](../../.process-compose-version) 固定 |
| 生产后端 | 构建后运行 `pnpm --filter @atoms/backend start` |
| 本地检查前端产物 | `pnpm --filter @atoms/frontend preview`；这是本地验收入口 |
| 当前基础设施 | 没有独立数据库、容器或队列服务；现有连通页面无需模型凭据 |

后端读取自身目录下的 `.env`，进程已有变量优先，配置经过解析后监听。前端开发及 preview 的代理目标来自其配置；生产反向代理由部署环境提供。

当前已有 Process Compose 配置；manager 与 `infra` 命令尚未实现。本地编排不接管生产服务器。

## Native Process Compose

`OPS-001` 使用官方 [v1.122.0 发布](https://github.com/F1bonacc1/process-compose/releases/tag/v1.122.0)，不需要 Docker、额外守护服务或 npm 运行时依赖。版本文件是工具版本，YAML 中的 `version: "0.5"` 是配置格式版本。

### Tool installation

从固定发布下载匹配系统和架构的归档与 `process-compose_checksums.txt`，先核对 SHA-256，再将二进制及附带的 LICENSE 放到 `.tools/process-compose/1.122.0/`。目录被忽略，不把本机二进制提交到仓库；自动安装留给 `OPS-003`。

本次实测 macOS arm64，安装示例在仓库根目录执行：

```sh
atoms_pc_version="$(cat .process-compose-version)"
mkdir -p .runtime/process-compose/download .tools/process-compose/"$atoms_pc_version"
curl -fL "https://github.com/F1bonacc1/process-compose/releases/download/v$atoms_pc_version/process-compose_darwin_arm64.tar.gz" -o .runtime/process-compose/download/process-compose_darwin_arm64.tar.gz
curl -fL "https://github.com/F1bonacc1/process-compose/releases/download/v$atoms_pc_version/process-compose_checksums.txt" -o .runtime/process-compose/download/process-compose_checksums.txt
(
  cd .runtime/process-compose/download || exit 1
  awk '$2 == "process-compose_darwin_arm64.tar.gz"' process-compose_checksums.txt | shasum -a 256 -c -
) && tar -xzf .runtime/process-compose/download/process-compose_darwin_arm64.tar.gz -C .tools/process-compose/"$atoms_pc_version" process-compose LICENSE
```

该归档实测 SHA-256 为 `eaa1238a1d6c300e928ef855d36a3d95aab8da64997104d74ea73d91d3cb6c60`。其他平台应选择对应归档并核对其官方校验和，不能复用此文件或校验值；Linux 和 Windows 未在本步实测。

### Commands

以下是原生开发编排入口，控制 socket 按仓库隔离。

先使用 `.nvmrc` 的 Node、根 package.json 的 pnpm，并完成 frozen install。以下准备命令在每个操作终端的仓库根目录执行，后续命令依赖这些变量：

```sh
export ATOMS_PC="$PWD/.tools/process-compose/$(cat .process-compose-version)/process-compose"
export PC_SOCKET_PATH="$PWD/.runtime/process-compose/control.sock"
export PC_LOG_FILE="$PWD/.runtime/process-compose/client.log"
mkdir -p .runtime/process-compose
"$ATOMS_PC" version
"$ATOMS_PC" up -f process-compose.yaml --disable-dotenv --dry-run
```

前台启动整个开发 profile，在该终端按 Ctrl+C 或另一个已准备的终端执行 `down` 停止：

```sh
"$ATOMS_PC" --log-file .runtime/process-compose/supervisor.log up -f process-compose.yaml --disable-dotenv -t=false
```

另一个终端查看状态、就绪与应用日志：

```sh
"$ATOMS_PC" process list -o json
"$ATOMS_PC" project is-ready
"$ATOMS_PC" process logs backend --tail 50
"$ATOMS_PC" process logs frontend --tail 50
"$ATOMS_PC" down
```

只启动一个服务时，在同一 `up` 命令末尾加 `frontend` 或 `backend`。不同时运行独立 pnpm 开发命令和占用相同端口的托管服务。`PC_SOCKET_PATH` 隔离本仓库控制通道，不启用默认 TCP 控制端口；不同工作副本需要各自的运行目录，但应用端口仍可能冲突。该原生示例的 socket 路径过长时工具会报错。

### Behavior and limits

- 配置调用原有独立命令，前后端没有 `depends_on`。前端 readiness 检查页面本身，后端离线时仍可就绪；全项目检查需同时确认两个服务的 `Running`、`Ready` 和实际 API 代理响应。`project is-ready` 的单次检查在未就绪时返回非零；本步不使用可能持续等待的 `--wait`。
- 托管 profile 固定后端 `HOST=127.0.0.1`、`PORT=3001`，前端代理为 `http://127.0.0.1:3001`，前端自身监听 5173。应用继续加载各自 `.env`，但这三个托管值优先；原生入口用 `--disable-dotenv`，进程也配置 `is_dotenv_disabled`，不把根 `.env` 注入两个应用。不新增环境变量或改写现有环境文件；自定义地址仍使用独立启动方式。
- [端口预检](../../scripts/check-dev-port.cjs) 只检查本服务的固定端口，遇到占用返回失败；不按端口杀进程。检查和实际监听之间仍有竞争窗口，HTTP 探针也不验证响应正文或进程身份，不能据此承诺并发启动安全。
- 使用官方 HTTP readiness：初始延迟 1 秒、间隔 2 秒、单次超时 1 秒、连续失败阈值 5。失败退出退避 2 秒，最多自动重试 2 次。实测持续失败的探针触发了两次重试，但最后一轮仍可能保持 `Running / Not Ready`，不能承诺原生配置会自动终止所有未就绪进程；原生操作需检查并显式停止。
- 本次实测工具在重试耗尽时可能给出 `status: Completed`、`exit_code: 1`、`is_running: false`，探针还可能保留 `is_ready: Ready`；故障恢复后的 `Running / Ready` 也可能保留上一轮的 `exit_code: -1`。不能按单个标签或退出码判断健康：持续服务停止即不可用，运行中的服务结合当前探针、真实接口及进程归属判断，退出码用于解释已结束的进程。原生 `project is-ready` 只作辅助检查。
- 停止使用 SIGTERM 发给所属进程组，最多等待 10 秒，再由原生工具强制终止。服务仍作为前台子进程运行，不配置 `is_daemon`，也不自行写 PID 文件。
- 应用合并日志在 `.runtime/process-compose/processes.log`，每行刷新，配置 5 MB 轮转、两个备份和七天保留；supervisor 与 client 日志使用不同文件。运行文件、socket、下载及工具均被忽略。原生日志接口按服务过滤，继续遵守应用日志规范；本步未做日志容量压力测试。

原生配置验收记录见 [OPS-001 tasks](../../openspec/changes/ops-001-process-compose/tasks.md)。原生启动不等于等待所有应用就绪；原生停止返回后仍应确认子进程和监听已释放。后续 manager 需提供统一状态和幂等入口，不能把相同保证直接套到手动原生 `up` / `down` 上。

## Planned manager contract

`OPS-001` 原生配置已接入；下表记录后续 manager 目标。保留应用独立运行方式。

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
