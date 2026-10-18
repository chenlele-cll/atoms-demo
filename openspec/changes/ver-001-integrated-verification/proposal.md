# Proposal

## Why

`VER-001` 汇总既有工程骨架、Agent 工具与生命周期能力的实际验收，避免仅凭各任务的局部结果宣称仓库整体可开发。现有检查已有明确覆盖，需要统一入口、运行证据及未实现能力的边界。

## What Changes

- 提供 `pnpm verify`，用 pnpm 和 shell 的失败即停止语义串行复用现有 doctor、check、test:infra、test:manager、smoke 和 OpenSpec 严格校验；smoke 已含构建，不重复构建。
- 实际执行完整入口，记录版本、耗时、测试结果、进程清理与源码对应关系。
- 用仓库官方 Playwright skill 补充真实页面快照、点击与窄屏检查；保留既有 smoke 覆盖。
- 在现有验证文档维护命令前提、验收矩阵与限制，入口只保留导航。

## Capabilities

### New Capabilities

无；纯开发工具与验收文档，使用 `skip_specs: true`。

### Modified Capabilities

无产品规格变化；不将其他 change 的规划或未实现产品能力作为验收通过项。

## Impact

影响根 package.json、README、Agent 导航与验证文档，不增加依赖或另一套测试框架。复用现有实际服务与隔离副本；不实现生成、持久化或容器服务，不操作提交、推送、归档或部署。
