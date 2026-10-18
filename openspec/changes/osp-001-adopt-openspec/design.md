# Design

## Context

任务范围见 [proposal.md](./proposal.md)。当前已有文档分工和按任务导航；个人全局 CLI 是 `1.4.1`，本次项目采用 `1.14.3`。首次安装和官方初始化属于引导步骤，已先于本变更工件创建执行；后续配置、文档和验收在本变更中记录，不宣称之前的任务已通过 OpenSpec 执行。

## Goals / Non-Goals

**Goals:**

- 克隆后通过唯一 lockfile 安装同一 CLI，使用同一工作流集合。
- 复用官方 schema 与生成技能，将已有规范通过上下文和引用接入。
- 用本任务实际验证状态图、上下文、工件校验及工作区保护。

**Non-Goals:**

- 不修改个人全局 CLI 或设置，不引入 store、workset、自定义 schema 或第二套任务系统。
- 不把结构校验等同于产品运行验证，不在本任务执行真实 PR 创建或产品生成。

## Decisions

1. **仓库开发依赖固定版本**：在根 package.json 精确固定 CLI，并提供 `pnpm openspec`。直接使用全局工具无法保证版本一致；每次临时下载会把基础工作流依赖网络。CLI 是开发工具，不进入前后端运行时依赖。
2. **项目范围的官方 CLI 配置**：根命令将 `XDG_CONFIG_HOME` 指向仓库 `.config/`，使官方配置读写落在 `.config/openspec/config.json`。配置选择核心六个工作流加 `verify`，delivery 为 skills；个人默认配置保持原样。
3. **官方生成与工具级入口**：Codex 集成生成 `.agents/skills/openspec-*`，OpenCode 集成生成 `.opencode/skills/openspec-*`。本机存在全局同名技能，实际发现结果不稳定，因此以 `AGENTS.md` 指定的仓库文件作为执行时的权威来源，不依赖目录发现优先级。两套入口对应同一组七个工作流，不手改生成内容；现有 Git、设计及全局技能保持不变。MIT 许可证保留在 `openspec/UPSTREAM-LICENSE`。
4. **既有规范继续拥有细则**：`openspec/config.yaml` 只保存语言、简短项目上下文、文档入口和工件规则；命令示例统一使用仓库入口。`AGENTS.md`、README 和技能说明导航到使用文档。
5. **工具接入跳过产品规格**：官方 `skip_specs: true` 表达本次没有产品契约变化。保留 proposal、design、tasks；不为使校验通过而创造产品需求。
6. **保留本次变更供审阅**：完成后仍保留 active change，不自动归档。验收通过不自动授权提交、推送或 PR。

## Risks / Trade-offs

- 直接运行全局 `openspec` 可能使用旧版或个人配置 → 所有项目命令使用 `pnpm openspec`，上下文和入口明确该约定。
- 官方生成文件更新覆盖本地手改 → 不修改生成文件，通过项目配置和既有规范接入，并验证 update 的重复执行结果。
- schema 校验不能证明 agent 自动选择或产品行为 → 分别报告 CLI、发现路径、应用检查和未执行的模型交互。
- XDG 环境赋值依赖 shell → 当前入口面向本机 macOS 与计划中的 Linux 开发环境，不声明已经验证 Windows。
- OpenCode 同名技能自动发现可能指向个人旧版 → 执行前直接读取仓库固定版本文件；将自动选择和运行时冲突修复列为未验证范围。

## Migration Plan

安装固定开发依赖后，官方初始化生成技能，再配置上下文、接入导航并执行验收。后续开发者先 frozen install，再运行仓库 CLI。

如需撤回，仅撤回本次依赖、命令和新增配置及技能的差异；保留其他任务改动及后续产生的变更记录，不重置工作区或个人全局设置。
