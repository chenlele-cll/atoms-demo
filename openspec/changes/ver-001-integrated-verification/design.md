# Design

## Context

动机与范围见 [proposal.md](./proposal.md)。已有 pnpm check、test:infra、test:manager 和 smoke，各自覆盖不同边界；manager 与 smoke 使用相同应用端口，不能并行执行。Agent、技能及 OpenSpec 的规范继续由现有文档维护。

## Goals / Non-Goals

复用现有测试和平台工具形成一条可重复执行的本地验收路径，给出实际证据与能力边界。没有产品功能、服务拓扑或依赖变更，不新增自定义测试框架、Skill 或进程编排器。

## Decisions

- package.json 新增 verify 脚本，以 `&&` 连接 doctor、check、test:infra、test:manager、smoke、OpenSpec 严格校验。smoke 自带 build，避免额外重复构建；任何一步非零均停止后续步骤。
- 开发者先选择固定 Node/pnpm、完成 bootstrap，准备系统 Chrome、GitHub 下载网络与 pnpm 缓存，并让 3001/5173/4173 空闲。统一入口不自动停止已有程序或变更环境配置。
- 安装及故障验证继续在 manager 的隔离副本执行；不在开发工作副本制造错误配置。测试保留既有有界等待与清理路径，不复制真实环境文件。
- Playwright CLI 使用仓库官方 wrapper 和具名会话，读取最新快照后操作，覆盖真实成功交互及窄屏；固定 smoke 继续覆盖响应异常、后端离线、恢复与生产构建入口。只关闭本次会话和本次启动的实例。
- 在验证文档维护统一命令与能力矩阵，任务实测结果放本 change。原始日志、截图、耗时和源码 hash 放忽略目录；Git HEAD/index、声明、lockfile、环境模板与私有资料分别核对，保留并行工作。

## Risks / Trade-offs

- 完整回归包含真实发布下载、等待陈旧锁和强制清理 → 文档明确网络和耗时前提，快速检查仍用 pnpm check；不把完整流程强加给每次小改动。
- 多套测试争用固定端口 → 串行运行；端口冲突明确失败，保留原监听者。
- 其他任务可能同时编辑代码或工件 → 保存入口与交付快照；只有证据对应的源码能报告通过，受影响改动才重跑相关检查。
- 当前没有模型、持久化或外部基础设施 → 对应运行验收为未实现/不适用；OpenSpec 全仓结构校验不能证明其他 change 的产品行为已实现。
- 平台覆盖有限 → 本次只报告实际 macOS arm64 与本机 Chrome 结果，不推断 CI、Linux、Windows 或线上部署。

## Migration Plan

无应用或数据迁移。撤回本任务新增的 verify 脚本与导航差异即可恢复原有命令，不撤回其他任务的内容。
