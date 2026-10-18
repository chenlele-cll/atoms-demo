# Proposal

## Why

仓库已具备分层 Agent 导航与工程规范，但尚无统一的变更工件和执行上下文。本机全局 OpenSpec 版本与本次采用版本不同，需要可随仓库复现的官方工具入口。

## What Changes

- 固定仓库内 OpenSpec CLI 为 `1.14.3`，通过 `pnpm openspec` 使用。
- 将官方 CLI 配置限定到仓库的 `.config/`，选择核心六个工作流加 `verify`，使用官方 Codex 与 OpenCode 适配生成项目入口。
- 配置项目上下文、文档入口及工件规则，沿用 `spec-driven` schema。
- 以 `OSP-001` 记录本次引导接入，并验证真实 CLI 的创建、状态推进、上下文注入与结构校验。
- 更新导航和使用说明，明确 CLI 校验与实现行为验证的区别。

非目标：不实现产品生成、数据库、预览、生命周期脚本或 CI，不提交、推送或创建 PR。

## Capabilities

### New Capabilities

无产品能力新增。本次仅接入开发工具，使用 `.openspec.yaml` 中的 `skip_specs: true`，不创建能力规格。

### Modified Capabilities

无现有产品契约变更。

## Impact

影响根开发依赖与 lockfile、CLI 命令、OpenSpec 配置及变更记录、生成的 OpenSpec Skills 和相关导航文档。OpenCode 项目入口用于解决本机全局同名技能遮蔽共享目录的问题。前后端运行代码、现有 Git 与设计技能保持不变，个人全局 OpenSpec 配置和技能不修改。
