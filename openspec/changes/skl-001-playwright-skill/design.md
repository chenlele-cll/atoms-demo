# Context

`SKL-001` 已由用户指定执行。仓库已有 `playwright-core` 冒烟脚本及本机 Google Chrome；本次补齐按需交互式操作入口。初始化变更和安装 Skill 后创建本工件，后续验证据实记录。

# Goals / Non-Goals

- 目标：原样复用官方 Skill，固定技能与 CLI 来源，明确项目调用路径和浏览器验收入口。
- 非目标：编写新 Skill、迁移冒烟脚本、修改 UI、安装全套 Agent 框架、管理生产进程。

# Decisions

- Skill 固定到 `openai/skills` 的 `49f948faa9258a0c61caceaf225e179651397431`，与现有同仓库 Git 技能使用同一已选提交；用官方 skill-installer 安装到 `.agents/skills/playwright/`。
- CLI 使用根开发依赖的精确版本，由项目命令调用上游 wrapper，避免依赖个人全局安装。CLI 自带的 Playwright 依赖与现有 smoke 的 `playwright-core` 分别锁定，不调整 smoke。
- 浏览器配置复用系统 Chrome，独立临时会话，不连接个人浏览器。按上游路径将交互产物放在忽略的 `output/playwright/`；现有 smoke 继续使用 `test-results/smoke/`。
- Agent 明确读取仓库 Skill；同名全局技能和模型自动触发不作为已验证能力。操作前读取快照，引用当前元素编号，只关闭本任务拥有的会话和进程。
- 来源与调用方式维护在 skills.md，检查覆盖维护在 verification.md，入口文件只导航。

# Risks / Trade-offs

- 本机 Chrome 是外部前提；未安装时应明确报告，不能声称浏览器检查通过。
- CLI 版本及其传递依赖以 lockfile 为准；升级时检查实际 CLI 帮助和配置行为，不能假定上游引用文档始终匹配。
- 浏览器输出可能含页面数据，保持本地忽略，不提交。

# Migration Plan

安装并核对上游文件，接入固定 CLI 与配置，完成真实浏览器操作和项目检查后交付。回退仅移除本任务新增的技能、工具依赖和入口，不处理其他待提交工作。

# Open Questions

无阻碍本任务执行的未决问题。
