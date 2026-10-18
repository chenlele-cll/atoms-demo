# Proposal

## Why

`CI-001` 将既有验收接入仓库的 GitHub Actions。当前只有本地运行结果，需要可在 PR 和主分支重复执行的检查，同时保留完整生命周期验收的手动入口。

## What Changes

- 新增一个工作流：PR、main push 和手动触发 Ubuntu 基础检查、infra 测试、构建/浏览器 smoke 与 OpenSpec 严格校验。
- 手动触发时可选择 macOS arm64 完整生命周期 job，复用 bootstrap 与 pnpm verify，逐步扩展已实测平台。
- 复用 GitHub 和 pnpm 官方 Actions，以提交 SHA 固定版本；Node/pnpm 版本继续读取仓库文件，依赖安装使用 frozen lockfile。
- 设置只读仓库权限、超时、同一分支的重复运行取消、pnpm store 缓存及限定的测试证据上传；同步既有工程导航与验证文档。

## Capabilities

### New Capabilities

无产品能力新增；纯 CI 工具配置，使用 skip_specs。

### Modified Capabilities

无产品契约变化。

## Impact

新增 .github/workflows/ci.yml，调整 README、Agent、文档索引、Monorepo 与验证规范。没有新依赖、工具框架、Skill 或产品代码改动。仅在本地落盘、静态验证并运行对应检查，不提交、推送、触发远端工作流或修改分支保护；远端运行结果需在后续发布配置后观察。
