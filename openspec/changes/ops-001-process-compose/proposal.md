# Why

`OPS-001` 为已确认的渐进计划接入 Process Compose 官方进程配置。当前前后端依靠两个终端分别运行，尚无统一的就绪、退出策略和日志配置。

# What Changes

- 固定官方 Process Compose 版本，验证发布校验和，保留独立应用命令。
- 添加原生开发进程配置、HTTP 就绪探针、有界重试和进程组停止参数。
- 添加必要的启动端口检查，防止 watcher 留存时将其他服务误认为本应用健康。
- 文档说明原生操作、日志、配置归属和当前边界，并用真实服务验收。

# Capabilities

## New Capabilities

无产品契约变化；使用 `skip_specs: true`。

## Modified Capabilities

无。

# Impact

影响本地开发编排和工程文档，不更改应用源码、HTTP 契约或 workspace 依赖。本步不实施 `OPS-002` 的 manager 幂等控制、`OPS-003` 的 bootstrap/doctor、基础设施或生产部署。
