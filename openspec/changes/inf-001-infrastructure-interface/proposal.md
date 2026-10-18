# Proposal

## Why

`INF-001` 要先补齐基础设施生命周期入口。当前项目没有外部服务，入口必须如实表达未配置，让后续实际接入有明确边界。

## What Changes

- 提供 `./manager.sh infra start|stop|status [--json]`，无配置时重复执行均明确返回“未配置外部基础设施”。
- 空操作不安装工具、拉取镜像、调用 Docker、创建状态或改变应用进程与数据；没有 node_modules 也可执行。
- 严格校验命令；检测到标准 Compose 文件或显式 `COMPOSE_FILE` 时拒绝将未接入的配置当成空配置。
- 补充行为验证及既有导航，真实服务接入保留给 `INF-002`。

## Capabilities

### New Capabilities

无产品能力新增；仅开发工具接口，使用 `skip_specs: true`。

### Modified Capabilities

无产品契约变更。

## Impact

修改现有 manager 分发、Node 标准库入口、帮助与文档，添加聚焦测试入口；不增加依赖、占位 Compose 文件或业务目录，不提交、推送或归档。
