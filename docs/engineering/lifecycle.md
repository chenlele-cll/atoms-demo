# Lifecycle

本文件维护本地进程、起停状态与基础设施接入约定。调整启动入口、配置加载、进程管理或起停脚本时阅读并更新；安装、环境变量和生产服务器运行步骤见根 [README.md](../../README.md)。

## Available today

| 操作 | 当前入口与行为 |
| --- | --- |
| 开发后端 | 根目录运行 `pnpm dev:backend`；pnpm 将应用工作目录设为 `backend/` |
| 开发前端 | 在另一个终端运行 `pnpm dev:frontend`；前后端进程相互独立 |
| 停止开发服务 | 在各自终端按 Ctrl+C；后端入口处理 SIGINT、SIGTERM 并关闭 Fastify |
| 本地工具与开发编排 | [manager.sh](../../manager.sh) 提供 bootstrap/doctor/start/stop/restart/status/logs/infra，见下节 |
| 原生开发编排 | 根 [process-compose.yaml](../../process-compose.yaml) 管理前后端，操作见下节；工具版本由 [.process-compose-version](../../.process-compose-version) 固定 |
| 生产后端 | 构建后运行 `pnpm --filter @atoms/backend start` |
| 本地检查前端产物 | `pnpm --filter @atoms/frontend preview`；这是本地验收入口 |
| 独立模型能力探针 | `pnpm model:probe` / `pnpm model:probe:built`，默认仅帮助；只有显式 --case 才调用，不监听端口 |
| 当前基础设施 | `infra start/stop/status` 明确报告未配置；没有独立数据库、容器或队列服务，现有连通页面无需模型凭据 |

后端读取自身目录下的 `.env`，进程已有变量优先，配置经过解析后监听。前端开发及 preview 的代理目标来自其配置；生产反向代理由部署环境提供。

GEN-003 正式后端先验证 DATABASE_PATH / APP_ORIGINS，加载相对 server 模块的 template-assets，再打开 SQLite 并迁移，最后监听。数据库默认相对 backend cwd 为 ../data/atoms.sqlite，不在 dist 中；启用外键、WAL、5000ms busy_timeout，迁移事务取得写锁后重读 user_version。高于支持版本、迁移/文件/资产/监听失败均安全报错且释放连接，不删库或切换内存；正常 SIGINT/SIGTERM 关闭 Fastify 与所属连接并保留数据。

buildApp 无参数仍不打开磁盘数据库；项目测试显式传入 store/catalog，应用 onClose 负责关闭。后端 dev/typecheck/test 准备 src/template-assets，build 同时准备自身 dist 资源；运行 start 需要完整 backend/dist、平台依赖及可写持久目录。项目读写不调用模型。

模型探针通过 workspace 使用 backend 工作目录及同样的原生环境加载规则，帮助不读取 `.env`。模型配置仅在显式探针或未来生成请求边界解析，manager、健康检查、默认自动化入口不触发模型。一次样例的全部请求共用截止时间；SIGINT/SIGTERM 中止底层请求、停止后续样例、输出脱敏最终报告并退出 130/143。构建入口为 `backend/dist/model/probe.js`；配置、请求上限与报告含义见 [README](../../README.md#模型能力探针) 和 [Model access](./verification.md#model-access)。

当前已有 manager 的七个开发命令、infra 空配置入口和 Process Compose 配置。本地编排不接管生产服务器。

## Manager commands

预先选择 `.nvmrc` 的 Node 和 package.json 的 pnpm，然后在仓库根目录运行：

```sh
./manager.sh bootstrap
./manager.sh doctor
./manager.sh start
./manager.sh status
./manager.sh logs backend --tail 50
./manager.sh restart
./manager.sh stop
```

也可从其他目录以绝对路径调用，支持带空格或深路径的仓库。start/restart 默认等候 30 秒就绪，可加 `--timeout 1..120` 秒；额外在途检查和必要停止/回滚时间不计入该窗口。只有 bootstrap 安装缺失的项目工具和依赖，不自动安装全局 Node/pnpm 或升级已有工具。stop/status 需可用的 Node 和根依赖；bootstrap/doctor/infra 的入口仅依赖 Node 标准库，在没有 node_modules 时也能执行。infra 用法见 [Infrastructure contract](#infrastructure-contract)。

### Bootstrap and diagnostics

bootstrap 明确向原样保留的 [官方安装器](../../scripts/vendor/process-compose/get-pc.sh) 传入项目固定 tag，在私有暂存目录完成发布下载、上游 SHA-256 校验及实际版本检查，再原子安装到 `.tools/process-compose/<version>/`，保留 [Apache-2.0 LICENSE](../../scripts/vendor/process-compose/LICENSE)。已有完整且版本匹配的工具复用；发现损坏或错误版本目录时失败并保留现场，不覆盖或自动升级。

随后执行 `pnpm install --frozen-lockfile`，不更新声明与 lockfile，不创建或覆盖 `.env`，不启动应用。原生安装器整体期限 120 秒，依赖安装 180 秒；中断时结束本次子进程组并清理暂存目录。安装日志在忽略的 `.runtime/setup/`。依赖安装失败时，已经正确安装的固定工具可以保留，重新执行继续安装依赖。

bootstrap 在停止开发后执行；有 manager 实例记录时先执行 stop，失败记录也需先清除。首次安装不依赖自写锁协议，不承诺与另一安装或开发命令并发；pnpm 负责依赖安装。它不批准额外技能、不操作全局配置、不安装占位基础设施。

doctor / `doctor --json` 汇总：Node/pnpm 版本、根和两应用的声明依赖、workspace/lockfile、固定 Process Compose、原生严格配置、可选环境文件可读性，以及端口和已有实例状态。停止且端口空闲是正常状态；健康实例占用自己的端口也正常；外部占用、未就绪实例、缺失工具和配置错误明确失败。环境文件只检查存在与可读性，不读取或输出值。缺少工具时还检查安装器所需的下载、SHA-256 和 POSIX 工具；npx 与系统 Chrome 是浏览器验收的可选检查。

doctor 不安装、启动、停止或改写项目配置，仅可能准备私有诊断目录并写入原生校验日志。必需检查有 error 时退出 1；只有可选浏览器 warn 时仍可退出 0。JSON 输出 `ok` 和逐项 `checks`，建议的下一步跟随失败项；无法读取项目 pin 等入口异常写 stderr 并返回非零。依赖诊断检查声明存在和精确版本，不替代 frozen install、类型、行为测试或生产验证。

### Application logs

```sh
./manager.sh logs                    # 两个应用，各取末 50 条
./manager.sh logs backend --tail 100
./manager.sh logs frontend --follow  # 另一个终端，Ctrl+C 只取消读取
```

只接受 backend/frontend/all，tail 范围 1..1000，不接受文件路径。在线读取确认实例归属后，复用官方 Process Compose logs CLI 和认证文件；all 分别订阅两个服务并标记来源，避免实测原生多服务快照只返回一路的问题。跟随不持有修改锁，不阻塞 stop，取消不停止应用。每个有限快照请求设 10 秒期限；异常返回非零。

实例停止后，无 `--follow` 时按服务读取 `.runtime/process-compose/processes.log` 当前文件；不跨轮转归档，不宣称保留完整历史。没有保存日志或试图跟随已停止实例时明确失败。logs 输出应用文本，不提供 JSON，也不将状态、认证或环境文件作为日志内容；可遮盖当前管理认证值，但不替代应用产生日志时的既有脱敏规范。

### State and results

bootstrap、doctor 和四个核心命令支持 `--json`；logs 使用文本。start/stop/restart 成功返回 0，失败非零；启动被 SIGINT/SIGTERM 中断时分别返回 130/143，并执行回滚。status 退出码含义为：

| 状态 | 含义 | 退出码 |
| --- | --- | --- |
| `healthy` | 所属实例、两个运行进程、当前探针、原生端口归属、后端健康正文及前端页面/API 代理均通过 | 0 |
| `stopped` | 当前没有已知运行实例 | 3 |
| `starting` | 当前实例仍在启动、尚未满足整体就绪 | 2 |
| `unready` | 实例已运行但当前检查未通过 | 2 |
| `failed` | 已记录的启动失败、服务结束或 supervisor 退出后仍有所属子进程 | 1 |

无法解析记录、未知控制端点或权限异常也返回非零并在 stderr 说明，不把损坏记录当成停止。JSON 只输出公开状态、服务 PID 和诊断字段，不输出认证值。status 不修改实例记录或等待修改锁，执行时可能看到正在进行的操作。

### Idempotence and ownership

- 进程重启、探针和应用日志继续由 Process Compose 执行；manager 只是短时运行的 Node 脚本，不是新的常驻守护器。
- 健康实例上的重复 start 保留实例和服务 PID；已停止时重复 stop 返回成功。restart 在同一互斥操作内停止再启动，可以更换 PID，最终只保留一组健康实例。
- 已有实例未就绪时，start 先在期限内等待原生恢复；失败则停止其所属实例并返回错误。新实例失败或启动中断也回滚，不遗留已知实例。显式 stop 可清除失败记录，再次 start 可重试。已有健康实例的配置变化需通过 restart 应用，start 不默默替换它。
- start/stop/restart 使用精确根开发依赖 [proper-lockfile 4.1.2](https://github.com/moxystudio/node-proper-lockfile/tree/v4.1.2)（MIT），复用原子目录锁和心跳，5 秒更新、30 秒 stale、最多等候锁 75 秒。崩溃后的锁由库恢复，不手动删锁；争用超时非零，不创建第二组实例。此保证适用于所有修改都通过 manager 的本地文件系统，不承诺网络文件系统或被长期暂停的调用者。
- 状态、独立认证文件、实例配置及管理日志保存在忽略的 `.runtime/manager/`；目录权限 0700，认证和状态文件 0600。原生 socket 位于 `/tmp/atoms-pc-<uid>-<repository-hash>/control.sock`，目录私有且路径短，仓库 realpath 决定实例域。不要复制运行目录到另一个副本。
- 原生认证和随机项目名确认控制端点，OS PID、启动时间、命令及父子关系确认进程归属；端口归属使用原生 API 获取。拒绝接管未知 socket。两个副本不会互相停止实例，但应用的固定 3001/5173 端口仍互斥，冲突时保留原监听者。
- stop 优先使用认证的原生 API，再通知已确认的 supervisor；等待 25 秒后，只对身份仍匹配的所属进程使用 SIGKILL，再等候 5 秒确认清理。单次网络、进程和工具检查另有超时。supervisor 已退出时可按已记录身份清理所属子树；PID 被复用或身份不匹配时不向该进程发信号，不按端口杀进程。
- SIGKILL、断电或记录损坏后，下一命令以持久记录和实际进程核对；无法确认归属时非零并保留诊断，不推测未知进程的身份。启动失败保留 `failed` 记录用于检查，完整 stop 后移除实例记录、认证与 socket，保留日志、依赖和数据。

不要同时使用原生命令修改 manager 实例。bootstrap/doctor/logs 已接入；管理进程自身的诊断文件仍位于 `.runtime/manager/console.log` 与 `supervisor.log`，不通过应用 logs 命令混读。macOS arm64 已作为目标验收平台；Linux 和 Windows 未验证，本入口依赖 POSIX。

回归入口为 `pnpm test:manager`：隔离副本使用离线 frozen install，端口必须空闲，需要已安装的固定 Process Compose。覆盖和证据见 [Verification](./verification.md#lifecycle-scenarios) 与 [OPS-002 tasks](../../openspec/changes/ops-002-manager/tasks.md)。

## Native Process Compose

`OPS-001` 使用官方 [v1.122.0 发布](https://github.com/F1bonacc1/process-compose/releases/tag/v1.122.0)，不需要 Docker、额外守护服务或 npm 运行时依赖。版本文件是工具版本，YAML 中的 `version: "0.5"` 是配置格式版本。

### Tool installation

推荐使用 bootstrap，它复用官方安装器。安装器及许可证固定来自 [673850dd20683ef14b33890444ca3416d02c751c](https://github.com/F1bonacc1/process-compose/tree/673850dd20683ef14b33890444ca3416d02c751c)，保持上游内容与署名不变。也可从固定发布下载匹配系统和架构的归档与 `process-compose_checksums.txt`，先核对 SHA-256，再将二进制及 LICENSE 放到 `.tools/process-compose/1.122.0/`；目录被忽略，不提交本机二进制。

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

以下是独立原生调试入口，使用单独的控制 socket，不与 manager 实例混用。常规开发优先使用上节 manager 命令。

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

只启动一个服务时，在同一 `up` 命令末尾加 `frontend` 或 `backend`。不同时运行独立 pnpm 开发命令和占用相同端口的托管服务。`PC_SOCKET_PATH` 隔离本仓库控制通道，不启用默认 TCP 控制端口；不同工作副本需要各自的运行目录，但应用端口仍可能冲突。该原生示例的 socket 路径过长时工具会报错，manager 则使用前述短路径。

### Behavior and limits

- 配置调用原有独立命令，前后端没有 `depends_on`。前端 readiness 检查页面本身，后端离线时仍可就绪；全项目检查需同时确认两个服务的 `Running`、`Ready` 和实际 API 代理响应。`project is-ready` 的单次检查在未就绪时返回非零；本步不使用可能持续等待的 `--wait`。
- 托管 profile 固定后端 `HOST=127.0.0.1`、`PORT=3001`，前端代理为 `http://127.0.0.1:3001`，前端自身监听 5173。应用继续加载各自 `.env`，但这三个托管值优先；原生入口用 `--disable-dotenv`，进程也配置 `is_dotenv_disabled`，不把根 `.env` 注入两个应用。不新增环境变量或改写现有环境文件；自定义地址仍使用独立启动方式。
- [端口预检](../../scripts/check-dev-port.cjs) 只检查本服务的固定端口，遇到占用返回失败；不按端口杀进程。检查和实际监听之间仍有竞争窗口，HTTP 探针也不验证响应正文或进程身份，不能据此承诺并发启动安全。
- 使用官方 HTTP readiness：初始延迟 1 秒、间隔 2 秒、单次超时 1 秒、连续失败阈值 5。失败退出退避 2 秒，最多自动重试 2 次。实测持续失败的探针触发了两次重试，但最后一轮仍可能保持 `Running / Not Ready`，不能承诺原生配置会自动终止所有未就绪进程；原生操作需检查并显式停止，manager 已增加整体就绪截止时间及失败回滚。
- 本次实测工具在重试耗尽时可能给出 `status: Completed`、`exit_code: 1`、`is_running: false`，探针还可能保留 `is_ready: Ready`；故障恢复后的 `Running / Ready` 也可能保留上一轮的 `exit_code: -1`。不能按单个标签或退出码判断健康：持续服务停止即不可用，运行中的服务结合当前探针、真实接口及进程归属判断，退出码用于解释已结束的进程。原生 `project is-ready` 只作辅助检查，manager 使用上述统一状态判断。
- 停止使用 SIGTERM 发给所属进程组，最多等待 10 秒，再由原生工具强制终止。服务仍作为前台子进程运行，不配置 `is_daemon`，也不自行写 PID 文件。
- 应用合并日志在 `.runtime/process-compose/processes.log`，每行刷新，配置 5 MB 轮转、两个备份和七天保留；supervisor 与 client 日志使用不同文件。运行文件、socket、下载及工具均被忽略。原生日志接口按服务过滤，继续遵守应用日志规范；本步未做日志容量压力测试。

原生配置验收记录见 [OPS-001 tasks](../../openspec/changes/ops-001-process-compose/tasks.md)。原生启动不等于等待所有应用就绪；原生停止返回后仍应确认子进程和监听已释放。manager 已提供统一状态和幂等入口，不能把相同保证直接套到手动原生 `up` / `down` 上。

## Planned manager contract

`OPS-001` 原生配置、`OPS-002` 核心、`OPS-003` 工具入口与 `INF-001` 空基础设施入口已接入，保留应用独立运行方式。

| 命令 | 行为与当前状态 |
| --- | --- |
| `bootstrap` | 已实现：官方固定工具安装与 frozen install，不覆盖环境文件、不自动升级 |
| `doctor` | 已实现：版本、依赖、配置、实例、端口与环境文件诊断 |
| `start` | 已实现：启动并等待真实就绪，健康实例不重复创建 |
| `stop` | 已实现：停止已确认的所属实例，重复停止成功，保留数据 |
| `restart` | 已实现：同一锁内停止再启动，收敛到一组健康实例 |
| `status` | 已实现：区分 stopped、starting、unready、healthy、failed |
| `logs` | 已实现：在线快照/跟随、停止后当前文件读取，遵守 [日志规范](./development.md#configuration-and-logging) |
| `infra start/stop/status` | 已实现：空配置明确返回 not_configured；真实服务留待 INF-002 接入 |

幂等按目标状态定义：重复 start/stop 不增加实例或误报失败；restart 允许重启进程，最终只保留一组健康实例。

实例、控制通道与运行文件按仓库隔离；运行产物在生成前加入忽略规则。进程管理交给现成工具，manager 只组织项目命令和状态判断。

端口被其他程序占用时报告冲突，不能通过按端口杀进程解决。部分失败应有有界等待、可诊断的失败结果和明确的恢复方式，不留下未知孤儿进程。

## Infrastructure contract

`INF-001` 已接入以下入口，和其他 manager 命令一样可从其他目录调用：

```sh
./manager.sh infra start
./manager.sh infra stop
./manager.sh infra status
./manager.sh infra status --json
```

当前没有外部服务或 Compose 文件，三个动作均输出“未配置外部基础设施”并退出 0，可重复或并发执行。JSON 返回 `ok: true`、请求的 `action`、`state: "not_configured"`、`configured: false`、`services: []` 及同一提示；成功只表示空操作已处理，不表示服务运行或就绪。

入口仅依赖 Node 标准库，不调用 Docker、Process Compose 或 pnpm，不安装工具、拉取镜像、读取应用环境文件、创建运行状态，也不改变应用实例或持久数据。当前应用没有外部依赖，普通 start/stop 不自动串联 infra。

只接受 start/stop/status 和至多一个尾随 `--json`，非法参数退出 1。仓库根检测到 compose.yaml、compose.yml、docker-compose.yaml 或 docker-compose.yml（含目录或符号链接），或进程显式设置非空 `COMPOSE_FILE` 时，也退出 1，提示先通过 `INF-002` 接入；不读取配置内容或输出环境值，不把未处理的配置当成空配置。这是当前接入门槛，不替代将来的 Compose 配置校验。

聚焦回归为 `pnpm test:infra`，无需 node_modules、Process Compose 或 Docker 的隔离副本覆盖 CLI 行为；测试 runner 本身使用项目 Node。真实运行中的前后端保护在 `pnpm test:manager` 覆盖，证据见 [INF-001 tasks](../../openspec/changes/inf-001-infrastructure-interface/tasks.md)。

首次出现真实外部服务时，由 `INF-002` 接入 Docker Compose 并验证。基础设施就绪后再启动其依赖服务，停止按实际依赖逆序执行；停止不默认删除数据库文件或数据卷。

SQLite 接入后是应用使用的文件数据库，不需要额外数据库守护进程。迁移命令随首个实际 schema 添加；模型、数据库与容器配置按对应实现引入，不能要求当前骨架提前提供无关凭据或服务。

## Verification and updates

起停与故障场景以 [Verification](./verification.md#lifecycle-scenarios) 为准。每次能力落地后，更新本文件的可用状态、README 和必要的环境模板，避免计划命令继续被当作已实现命令。
