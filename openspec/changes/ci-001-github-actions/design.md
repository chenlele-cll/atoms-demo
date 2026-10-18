# Design

## Context

动机见 [proposal.md](./proposal.md)。当前没有 Actions 配置；pnpm verify 已在本机 macOS arm64 实测，包含需要 Process Compose、GitHub 网络、缓存和固定端口的完整回归。应用和空基础设施检查可以独立执行。

## Goals / Non-Goals

先提供常规 PR 检查，再以手动选项接入完整生命周期。复用现有命令，不建立新测试框架、工作区脚本或 Skill；不把本地结果描述为 GitHub runner 已通过。

## Decisions

- 使用单个 ci.yml，pull_request、main push 与 workflow_dispatch 触发 quality job；全量 lifecycle job 只在手动 full_lifecycle 为 true 时运行。没有路径过滤，避免必需检查因文档变更被跳过。
- quality 使用明确的 ubuntu-24.04：frozen install → check → test:infra → smoke（自带 build）→ OpenSpec 严格校验。复用 runner 自带 Chrome，执行前检查版本；不要求 Process Compose、外部服务或应用凭据。
- lifecycle 使用 GitHub 标准 macos-15（arm64），复用 bootstrap → pnpm verify，在独立 VM 内串行使用端口。Linux 完整生命周期暂不默认启用，待真实 runner 结果支持后再扩展。
- checkout、setup-node、pnpm/action-setup 和 upload-artifact 使用官方固定提交。setup-node 读取 .nvmrc；pnpm action 读取 package.json；仅 pnpm action 管理 store 缓存，关闭 setup-node 自动缓存，不缓存 node_modules、工具二进制或运行状态。
- contents: read、checkout 不保留凭据、各 job 有超时。同工作流/事件/PR 或分支的新运行取消旧运行，手动验收与 PR 检查分组独立。工作流不使用 pull_request_target、不传入应用 secrets，也不设置部署或写仓库权限。
- 上传范围仅为 smoke PNG 和 manager 汇总 report.json，保留七天；不上传环境文件、fixture 全目录、认证状态或 .runtime。
- 用上游 actionlint 的固定发布在本地校验 Actions YAML 与表达式，并逐项核对固定 action.yml 的输入。执行常规 job 对应命令；完整生命周期源码未变时复用 VER-001 的哈希与运行证据，不重复耗时回归。

## Risks / Trade-offs

- Hosted runner 镜像、下载网络和缓存状态与本机不同 → 记录官方镜像信息与配置依据，首次远端结果留待配置发布后观察；不声称本地等价于远端成功。
- 全量安装和故障回归成本更高 → 提供手动布尔开关，日常检查不下载 Process Compose。
- 固定提交需要维护 → 在验证文档记录标签/提交与官方来源，升级时核对输入、runner 支持与实际结果，不自动追踪主分支。
- 并行任务可能新增工件或改变源码 → 保存入口状态与哈希，只重跑受影响检查，不更改其他任务的内容。

## Migration Plan

本步仅落盘。后续按明确授权提交、推送后，检查 Actions 的 quality 结果；需要完整回归时手动启用 full_lifecycle。分支保护需先取得实际成功的检查名称再单独配置，本任务不修改仓库设置。撤回工作流与对应文档差异即可，不涉及应用数据迁移。
