# Tasks

任务：`SKL-002`，以下为本变更局部编号。

## 1. Canonical repository skills

- [x] 1.1 SKL-002 将设计技能及资源迁入 .agents/skills，核对后移除重复 OpenCode 工作流；验证保留文件字节、许可证、引用与唯一目录，采用官方共享刷新方式。
- [x] 1.2 SKL-002 更新 Agent、设计、README 与工程导航，统一现行技能路径和 OpenSpec 刷新说明，记录宿主与个人同名冲突边界；检查链接与旧的现行引用。

## 2. Verification and handoff

- [x] 2.1 SKL-002 验证实际 Codex 与隔离/默认 OpenCode 的发现来源、嵌套目录读取、官方刷新幂等性；运行 check/build 及 OpenSpec 校验，核对 Git、依赖、私有资料和个人技能保留并交付结果，不提交、推送或归档。

## Verification results

- 仓库现有 11 个技能统一为 .agents/skills；设计技能及引用原样移动，原共享技能、脚本、图标和许可证的字节保持不变。七份 OpenCode 工作流仅有工具调用形式差异，经标准化比对后移除；.opencode/skills 目录已不存在。
- 在带空格的隔离副本运行官方 codex,agents 初始化与强制更新，全部共享文件哈希保持一致，也没有重建 OpenCode 副本；没有新增同步脚本、依赖、Skill 或软链接。
- Codex CLI 0.153.4 通过本地 app-server skills/list 在根目录和 frontend/ 均发现 11 个启用的项目技能，无项目解析错误；仅请求技能列表，未发起模型调用。OpenCode 1.18.23 在隔离配置的两个目录同样发现这 11 个共享来源。
- 默认 OpenCode 环境仍可能从 ~/.config/opencode/skills 载入七个同名旧 OpenSpec 技能，额外重复路径配置不能保证优先级。个人全局整理会影响其他仓库，本轮只统一仓库，未移动或修改个人技能；项目执行继续按 AGENTS.md 读取共享权威文件。
- 当前导航的 179 个本地链接通过，没有旧的现行技能路径；历史 OpenSpec 工件保留当时的记录。pnpm check（含后端六项）与 pnpm build 通过，本变更严格校验通过。
- 全仓 OpenSpec 校验为 12 项通过、1 项失败：并行编写的 GEN-004 尚缺规格增量，未修改或补写其内容。该失败不属于本次技能迁移；不将未完成的其他产品变更描述为验证通过。
- 原始证据位于忽略的 test-results/skl-002/。依赖/lockfile、版本与项目配置、CI、私有参考资料及个人技能保持原样，保留其他任务的改动。未在工作仓库暂存、提交、推送或归档；校验副本的 Git 初始化仅发生在忽略的隔离目录。
