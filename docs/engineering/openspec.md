# OpenSpec workflow

本文件维护项目 OpenSpec 的入口、配置归属与使用方式。CLI 是固定为 `1.14.3` 的根开发依赖；前后端运行时不依赖它。

## Project CLI

在仓库根目录完成 `pnpm install --frozen-lockfile` 后，使用 `pnpm openspec`。上游技能中的 `openspec ...` 命令在本项目均通过此入口执行，不依赖个人全局安装版本。

| 文件 | 职责 |
| --- | --- |
| [package.json](../../package.json) 与唯一 lockfile | 固定 CLI 版本并提供项目命令 |
| [.config/openspec/config.json](../../.config/openspec/config.json) | 官方 CLI 设置：核心六个工作流加 verify，delivery 为 skills |
| [openspec/config.yaml](../../openspec/config.yaml) | schema、语言、简短项目上下文、文档入口及工件规则 |
| `openspec/changes/` | 当前变更及后续归档的 proposal、design、tasks 等工件 |
| `openspec/specs/` | 发生真实产品契约变更时维护的长期能力规格 |
| `.agents/skills/openspec-*` | 官方 Codex 集成生成的七个技能，不手改生成文件 |
| `.opencode/skills/openspec-*` | 官方 OpenCode 项目入口，对应同一组工作流，可按路径读取固定版本 |

官方 CLI 设置原本属于机器范围。项目命令通过 `XDG_CONFIG_HOME` 将其限定到仓库 `.config/`，不改变个人默认设置。项目上下文只保留必要事实和引用，已有工程规范继续各自维护。

## Skill entry points

| 技能 | 使用时机 |
| --- | --- |
| `openspec-explore` | 在创建提案前调查和讨论想法 |
| `openspec-propose` | 创建完整规划工件；该工作流只规划，不直接开始实现 |
| `openspec-apply-change` | 用户明确要求实施已选变更时，按其任务执行 |
| `openspec-update-change` | 修订已有工件并保持一致 |
| `openspec-sync-specs` | 将契约增量合入长期规格 |
| `openspec-verify-change` | 对照工件检查实际实现与验证证据 |
| `openspec-archive-change` | 用户要求完成并归档变更时使用 |

Codex 使用 `$openspec-propose` 等技能名或技能选择器；OpenCode 提供 `/openspec-propose` 等技能入口。当前没有另装 `/opsx:*` slash command 文件，不能假定各工具具有相同命令拼写。

本机 OpenCode `1.18.23` 的同名技能发现结果会受全局版本影响，项目目录也不能保证每次被优先选择。执行工作流前，按 `AGENTS.md` 直接读取对应仓库路径中的 `SKILL.md`，核对 `metadata.generatedBy: "1.14.3"`，再使用项目 CLI。自动模型选择与全局同名冲突的运行时修复未在本任务中验证；不修改个人全局技能。

## Change handling

先读取对应工件和现有规范，保持用户分配的任务代号与三位序号；子任务使用 schema 的局部编号。不要重建一份平行任务清单，也不要将已完成的旧任务补写成“经 OpenSpec 执行”。

新规划通过 propose 形成工件并展示结果，后续明确请求 apply 时再实施。已有明确范围的任务按用户授权推进，不能因安装了技能就自行扩大范围。归档、提交和推送分别遵循既有授权。

纯工具或文档变更没有产品契约变化时，可使用官方 `skip_specs: true`；不能为满足校验创造产品需求。本次首次接入记录在 [osp-001-adopt-openspec](../../openspec/changes/osp-001-adopt-openspec/tasks.md)，保留为 active change 供审阅。

## Available inspection commands

```sh
pnpm openspec --version
pnpm openspec list --json
pnpm openspec status --change osp-001-adopt-openspec --json
pnpm openspec instructions apply --change osp-001-adopt-openspec --json
pnpm openspec validate --all --strict --no-interactive
```

`status` 主要反映工件存在情况，任务完成以真实工作和复选框为准。`validate` 验证结构与元数据，不能证明生成、持久化、预览或部署已运行；实现正确性继续按 [Verification](./verification.md) 验收。

## Refresh and provenance

版本由 package.json 与 lockfile 固定，生成技能的 `metadata.generatedBy` 记录 CLI 版本；相关 MIT 许可证保存在 [UPSTREAM-LICENSE](../../openspec/UPSTREAM-LICENSE)。

```sh
pnpm openspec init --tools codex,opencode --profile custom --language zh-CN --no-animation
pnpm openspec update
```

首次初始化和后续刷新都使用项目入口。升级时明确调整固定版本，检查生成差异、来源、上下文与发现路径，不在启动时自动更新。技能清单及其他技能来源见 [skills.md](./skills.md)。

## Official references

- [Project setup](https://openspec.dev/docs/setup)
- [Profiles](https://openspec.dev/docs/profiles)
- [CLI settings](https://openspec.dev/docs/configuration/config-json)
- [Project context and rules](https://openspec.dev/docs/project-config)
