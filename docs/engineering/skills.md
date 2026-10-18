# Repository skills

所有仓库技能统一存放在 `.agents/skills/<name>/SKILL.md`。设计、Git、浏览器与 OpenSpec 使用同一目录；脚本、references、assets 和许可证跟随各技能，不维护按 coding agent 分开的正文副本。

Codex 与 OpenCode 原生支持该共享目录。新增其他宿主时，先核对它的发现机制；需要时使用其支持的路径配置或必要链接适配，仍只维护这份源文件。统一目录不代表所有未知工具都具有相同的命令、权限或自动选用行为。

OpenSpec 的七个工作流保留官方兼容共享版本，Codex 与 OpenCode 读取相同文件；不手改生成正文。官方共享目标、刷新方式与 MIT 来源见 [OpenSpec 指南](./openspec.md)。设计规范位于 [atoms-frontend-design](../../.agents/skills/atoms-frontend-design/SKILL.md)，通过 [DESIGN.md](../../DESIGN.md) 导航。

本机 OpenCode 1.18.23 存在同名个人全局技能的覆盖问题，增加重复发现路径也不能保证优先级。个人目录不随仓库任务改写；项目执行以 `AGENTS.md` 指定的仓库文件为准。迁移与实际发现范围见 [SKL-002](../../openspec/changes/skl-002-unified-skills/tasks.md)，旧 change 保留当时的双目录历史记录。

## Installed upstream skills

| Skill | 来源与固定提交 | 职责 | 许可证 |
| --- | --- | --- | --- |
| [git-commit](../../.agents/skills/git-commit/SKILL.md) | [github/awesome-copilot · cb64ad12e32737ae764becd6885462e9b4c7cb00](https://github.com/github/awesome-copilot/tree/cb64ad12e32737ae764becd6885462e9b4c7cb00/skills/git-commit) | 差异分析、按范围暂存、Conventional Commit | [MIT](../../.agents/skills/git-commit/LICENSE)，从同一上游提交的根目录 LICENSE 原样复制 |
| [yeet](../../.agents/skills/yeet/SKILL.md) | [openai/skills · 49f948faa9258a0c61caceaf225e179651397431](https://github.com/openai/skills/tree/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/yeet) | 明确授权后的暂存、提交、推送与 PR 流程 | [Apache-2.0](../../.agents/skills/yeet/LICENSE.txt)，保留上游附带的界面元数据和图标 |
| [playwright](../../.agents/skills/playwright/SKILL.md) | [openai/skills · 49f948faa9258a0c61caceaf225e179651397431](https://github.com/openai/skills/tree/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/playwright) | 快照、交互、截图和浏览器调试 | [Apache-2.0](../../.agents/skills/playwright/LICENSE.txt) 及 [NOTICE](../../.agents/skills/playwright/NOTICE.txt)，保留 wrapper、参考文档、元数据和图标 |

上游的 `SKILL.md` 及配套资源保持原样；不创建同职责的自定义 Skill，不引入全套工作流框架。Playwright CLI 仅作为根开发工具，应用运行时不依赖它。

## Use

先按 [Git 工作流](./git-workflow.md) 确认请求范围，再加载对应技能：

- “提交 DOC-001 的改动”：使用 `git-commit`。
- “推送当前已提交的分支”：执行 Git 工作流中的 Push procedure，保持本地未提交内容不变。
- “提交并推送当前任务，再创建 PR”：使用 `yeet`，遵循仓库规定的暂存范围、任务编号、验证顺序和认证处理。
- 只请求安装技能时，范围包括技能、必要开发工具及导航；这不触发提交、推送或创建 PR。

`yeet` 的触发条件是完整的暂存、提交、推送和 PR 请求，不能将单独的推送请求扩大成完整流程。

## Browser verification

在仓库根目录使用 Node 和 pnpm 的项目版本，先完成 frozen install 并检查 `command -v npx`。根开发依赖精确固定 `@playwright/cli` 为 `0.1.22`；`pnpm playwright` 调用仓库内未改动的官方 wrapper，使用本地依赖，无需全局安装或 `@playwright/test`。CLI 自带的 Playwright 预发布依赖由 lockfile 锁定，与现有 smoke 的 `playwright-core` 分别解析；升级时一并核对。

[项目配置](../../.playwright/cli.config.json) 使用本机 Google Chrome、独立内存会话、默认无头模式及 1280×800 视口。需要目视检查时加 `--headed`；缺少 Chrome 时先报告前提未满足，浏览器安装需按实际环境处理。

在其他终端启动前后端后：

```sh
pnpm playwright --version
pnpm playwright --session=atoms-local open http://127.0.0.1:5173
pnpm playwright --session=atoms-local snapshot
# 读取快照中的实际编号后再点击，例如 click eN；不要复制过期编号。
pnpm playwright --session=atoms-local resize 375 812
pnpm playwright --session=atoms-local screenshot
pnpm playwright --session=atoms-local close
```

每次导航、显著状态变化或引用失效后重新获取快照。额外选项以固定 CLI 的 `pnpm playwright --help` / `pnpm playwright screenshot --help` 为准；例如该版网络记录命令为 `requests`，配置默认位置为 `.playwright/cli.config.json`，上游参考文件的旧示例可能不同。

命令从仓库根目录执行，使用具名会话；只关闭自己启动的会话，不运行影响其他任务的 `close-all` 或 `kill-all`。配置将默认产物放在忽略目录 `output/playwright/`，显式 `--filename` 也应使用该目录内的路径；CLI 本地状态目录 `.playwright-cli/` 同样被忽略。配置文件本身纳入版本控制。现有 `pnpm smoke` 保持原入口和 `test-results/smoke/` 产物路径，固定回归覆盖见 [Verification](./verification.md#existing-coverage)。

`SKL-001` 验证范围见 [变更任务](../../openspec/changes/skl-001-playwright-skill/tasks.md)。按仓库路径读取可直接使用固定技能；工具的自动发现与模型选择仍受宿主及同名全局版本影响，不将其视为本次浏览器操作验收的结果。

## Updates

1. 明确要更新的上游仓库和固定提交，检查变更及依赖资源。
2. 使用上游安装方式更新指定技能目录，保留许可证；不在日常开发启动时自动更新。
3. 将更新后的文件与固定提交核对，确认技能名称、资源、适用范围和仓库约束仍然匹配。
4. 更新本文件的来源提交，按 [Verification](./verification.md#change-matrix) 选择相应检查并记录实际结果，再交付变更。

技能保持小范围、按任务加载；项目约束集中维护在 Git 工作流和 `AGENTS.md` 中，避免修改第三方技能副本。

## Discovery references

- [Codex Build skills](https://learn.chatgpt.com/docs/build-skills)
- [OpenCode Agent Skills](https://opencode.ai/docs/skills/)
