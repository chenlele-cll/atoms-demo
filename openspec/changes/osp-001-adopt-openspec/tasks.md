# Tasks

任务：`OSP-001`。以下编号是本变更的局部子任务；初始化先于这些工件创建，记录的是实际引导接入工作。

## 1. CLI and generated workflows

- [x] 1.1 OSP-001 固定项目开发依赖与 CLI 入口；通过安装、版本和配置路径命令确认使用 `1.14.3` 及仓库配置。
- [x] 1.2 OSP-001 使用官方 Codex/OpenCode 适配生成核心加 verify 的七个工作流入口；验证重复初始化、更新及现有技能保护，记录同名全局技能发现限制和按仓库路径读取的方式。
- [x] 1.3 OSP-001 记录固定版本、profile、许可证与使用入口；检查文档链接及官方生成内容一致性。

## 2. Project context and navigation

- [x] 2.1 OSP-001 接入项目上下文、工件规则与 apply 指导；检查实际 instructions JSON 中的注入结果及规则范围。
- [x] 2.2 OSP-001 更新 Agent、README、文档索引与 Git 工作流；确认旧的“未接入 OpenSpec”状态被替换且无无关改动。

## 3. Integration verification

- [x] 3.1 OSP-001 验证创建、proposal/design/tasks 状态推进、工具变更的 skip_specs 及严格校验，读取 apply 的实际任务进度。
- [x] 3.2 OSP-001 运行 frozen install、pnpm check 和 pnpm build，记录真实结果。
- [x] 3.3 OSP-001 检查技能发现路径、个人配置、现有工作区及私有参考材料保护；记录自动发现限制和未执行的模型自动选择与产品生成验证。

## Verification results

- 固定 CLI、项目配置路径、上下文与按工件区分的规则已通过实际命令确认。
- 两个官方适配的十四个技能文件与隔离重新生成结果逐字节一致；重复 init/update 不改变配置和生成内容。
- 隔离 CLI 场景验证了缺少工件时阻止 apply、任务完成前后状态变化、工具变更跳过规格及冲突增量被拒绝。
- frozen install、`pnpm check` 和 `pnpm build` 通过；后端六个测试通过。
- 文档链接、许可证、现有改动、个人配置及全局技能保护检查通过。OpenCode 全局同名技能的自动选择仍不稳定，入口明确要求读取仓库固定文件；模型自动选择、该运行时冲突修复和产品生成未验证。

## Workflow follow-up

- 保留本变更供审阅；用户要求归档时再执行官方归档流程。
- 提交、推送与 PR 按用户单独授权的范围执行。
