# Repository skills

Git 技能复用上游实现，直接保存在 `.agents/skills/`。该目录可由 Codex 和 OpenCode 读取；工具未自动显示或存在同名全局技能时，按 `AGENTS.md` 中的仓库路径读取 `SKILL.md`。

## Installed upstream skills

| Skill | 来源与固定提交 | 职责 | 许可证 |
| --- | --- | --- | --- |
| [git-commit](../../.agents/skills/git-commit/SKILL.md) | [github/awesome-copilot · cb64ad12e32737ae764becd6885462e9b4c7cb00](https://github.com/github/awesome-copilot/tree/cb64ad12e32737ae764becd6885462e9b4c7cb00/skills/git-commit) | 差异分析、按范围暂存、Conventional Commit | [MIT](../../.agents/skills/git-commit/LICENSE)，从同一上游提交的根目录 LICENSE 原样复制 |
| [yeet](../../.agents/skills/yeet/SKILL.md) | [openai/skills · 49f948faa9258a0c61caceaf225e179651397431](https://github.com/openai/skills/tree/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/yeet) | 明确授权后的暂存、提交、推送与 PR 流程 | [Apache-2.0](../../.agents/skills/yeet/LICENSE.txt)，保留上游附带的界面元数据和图标 |

上游的 `SKILL.md` 及配套资源保持原样；不创建同职责的自定义 Skill，不引入全套工作流框架。

## Use

先按 [Git 工作流](./git-workflow.md) 确认请求范围，再加载对应技能：

- “提交 DOC-001 的改动”：使用 `git-commit`。
- “推送当前已提交的分支”：执行 Git 工作流中的 Push procedure，保持本地未提交内容不变。
- “提交并推送当前任务，再创建 PR”：使用 `yeet`，遵循仓库规定的暂存范围、任务编号、验证顺序和认证处理。
- 只请求安装技能时，范围包括技能、必要开发工具及导航；这不触发提交、推送或创建 PR。

`yeet` 的触发条件是完整的暂存、提交、推送和 PR 请求，不能将单独的推送请求扩大成完整流程。

## Updates

1. 明确要更新的上游仓库和固定提交，检查变更及依赖资源。
2. 使用上游安装方式更新指定技能目录，保留许可证；不在日常开发启动时自动更新。
3. 将更新后的文件与固定提交核对，确认技能名称、资源、适用范围和仓库约束仍然匹配。
4. 更新本文件的来源提交，按 [Verification](./verification.md#change-matrix) 选择相应检查并记录实际结果，再交付变更。

技能保持小范围、按任务加载；项目约束集中维护在 Git 工作流和 `AGENTS.md` 中，避免修改第三方技能副本。

## Discovery references

- [Codex Build skills](https://learn.chatgpt.com/docs/build-skills)
- [OpenCode Agent Skills](https://opencode.ai/docs/skills/)
