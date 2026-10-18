# Why

`SKL-001` 要让进入仓库的 Agent 直接使用已有的浏览器操作方法，减少开发者反复调试自定义技能的成本。现有 `pnpm smoke` 提供固定回归场景，但仓库尚无交互式浏览器 Skill。

# What Changes

- 使用官方安装器落盘 OpenAI Playwright Skill，固定上游提交并保留全部资源和许可证。
- 固定项目 CLI 开发依赖，提供仓库入口、浏览器配置和本地产物排除规则。
- 接入 Agent 与文档导航，实际验证快照、点击、截图及后端离线状态。

# Capabilities

## New Capabilities

无产品能力变化；本变更使用 `skip_specs: true`。

## Modified Capabilities

无。

# Impact

影响仓库开发工具、技能和导航，不修改应用实现，不接入测试框架或 MCP 服务。提交、推送、PR 与归档不在本次请求范围内。
