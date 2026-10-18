# Design

## Context

动机见 [proposal.md](./proposal.md)。现有 manager 用 shell 定位仓库，bootstrap/doctor 分发到仅使用 Node 标准库的 setup.mjs；应用起停继续由 Process Compose 执行。当前没有外部基础设施配置。

## Goals / Non-Goals

提供不依赖安装状态的空配置入口，保留现有进程生命周期边界。不新建配置 schema、插件系统或空服务目录；真实 Docker Compose 生命周期随 `INF-002` 的首个实际服务实现。

## Decisions

- `infra` 复用 setup.mjs 的轻量入口，接受且仅接受 start/stop/status 和可选的单个 `--json`。无需进入应用 manager、创建锁或读取应用环境文件。
- 文本输出“未配置外部基础设施”；JSON 返回 `ok: true`、`action`、`state: "not_configured"`、`configured: false`、`services: []` 和相同提示。有效空操作退出 0，非法命令或尚未接入的配置退出 1。重复及并发调用均不产生状态。
- 不为不存在的服务新建配置文件。仓库根出现 compose.yaml、compose.yml、docker-compose.yaml 或 docker-compose.yml，或进程显式设置非空 COMPOSE_FILE 时，明确拒绝空操作并指向 INF-002。不解析内容、不调用 Docker、不输出配置值。这只是防止误报的接入门槛，不是 Compose 配置发现与校验的替代品。
- 不把 infra 自动接到当前应用 start/stop；当前应用没有外部依赖，未来接入时再由真实依赖关系定义顺序。
- 新测试通过真实 shell 入口，在无 node_modules/Process Compose 的隔离目录执行，限制 PATH 并记录意外工具调用；核对数据和状态文件未变、无新运行目录、既有监听者未受影响。

## Risks / Trade-offs

- 尚无真实基础设施 → 不输出 running/healthy，不验证 Docker，不承诺容器或数据卷行为；INF-002 接入时替换空实现并增加对应验收。
- 配置门槛仅识别上述显式入口 → 额外文件、自动化环境与 Compose 的完整配置规则在真实接入时统一交给官方 Compose 处理，不在此实现另一套编排器。
- 共用 shell 与 setup 分发 → 额外执行现有 manager 行为回归、pnpm check/build，确认未影响安装、诊断与应用生命周期。

## Migration Plan

无应用或数据迁移；只新增开发命令。撤回本任务的命令分发、帮助、测试及文档差异即可，不能撤回其他任务的既有改动。
