# Git workflow

本项目采用 GitHub flow 的短期任务分支模式，提交信息遵循 Conventional Commits。任务编号和下面的命名方式是本仓库约定。

## Skill routing

| 用户请求 | 使用方式 |
| --- | --- |
| 提交指定任务的改动 | 加载 [git-commit](../../.agents/skills/git-commit/SKILL.md)，先确认范围与验证结果，再分析差异、暂存和提交 |
| 只推送已经存在的提交 | 执行下方 Push procedure，保留工作区与暂存区，不新建提交或 PR |
| 提交并推送，但没有请求 PR | 使用 `git-commit` 完成授权提交，再执行 Push procedure |
| 明确要求暂存、提交、推送并创建 PR | 加载 [yeet](../../.agents/skills/yeet/SKILL.md)，按用户授权的完整流程执行 |

技能的上游内容保持原样，来源与固定版本见 [Skills 说明](./skills.md)。本仓库的任务范围、命名、验证、认证及权限约定优先于技能中的通用示例：

- 存在其他任务改动时，按文件或补丁暂存本任务内容，不能执行上游 `yeet` 的 `git add -A` 步骤。
- 创建提交前先完成本次变更所需的验证；上游的提交步骤不能替代仓库验收要求。
- 认证失败时检查账号和写权限，不能执行上游 `yeet` 中通过拉取 `master` 再重试的步骤。
- 分支和提交信息继续携带任务编号，遵循本文件约定。

## Tasks and branches

- `main` 保存已经验收的基线。
- 每批相关任务使用一个短期分支，独立任务分别建分支。
- 任务编号使用大写代号和三位序号，例如 `DOC-001`、`OPS-002`。
- 分支名使用 `<type>/<task-id>-<description>`，全部小写，描述使用英文 kebab-case。
- 同批涉及多个任务时，分支名使用主任务编号，在任务记录和提交说明中列出其余编号。

示例：

```text
docs/doc-001-documentation-layout
chore/osp-001-openspec-setup
chore/ops-001-service-lifecycle
ci/ci-001-repository-checks
```

## Before starting work

1. 检查 `git status --short --branch`、`git branch -vv` 和当前差异，确认任务范围与已有改动的归属。
2. 已在对应任务分支时继续使用该分支。开始独立批次时，从已确认的 `main` 基线创建任务分支。
3. 存在 upstream 时，先检查远端更新和本地领先情况；同步只能快进，分叉时先检查提交再决定处理方式。首次推送前使用已经验收的本地基线。
4. 已有其他任务的未提交改动应保持原样。需要隔离时使用独立 worktree；不要通过自动 stash、reset、clean 或切换分支搬动这些改动。

在干净且基线已确认的工作区创建分支，例如：

```sh
git switch -c docs/doc-001-documentation-layout
```

分支已经存在时先检查其归属与内容，继续使用对应分支，不覆盖已有分支。

## Changes and commits

- 将一次完整、可验证的变更组织成提交；提交前先按下方粒度规则划分批次，不能将整个工作区或一个大功能的所有改动直接打包提交。
- 提交前检查工作区差异和暂存区差异。按文件或补丁暂存本任务的改动，共用文件中已有的其他改动不能一起提交。
- 提交标题采用 `type(scope): description (TASK-001)`；`scope` 可省略。
- 常用类型包括 `feat`、`fix`、`docs`、`refactor`、`test`、`build`、`chore` 和 `ci`。
- 标题或正文必须关联任务编号。正文记录必要的原因、兼容性影响和实际验证结果。

### 提交粒度

- 暂存前审查完整差异，先列出拟提交的分组：每组的具体目的、涉及文件、验证依据，以及分组间的依赖顺序。分组是本次操作说明，不另建任务跟踪文件；已有提交授权时按分组继续执行，无需重复请求确认。
- 一个提交只解决一个可以清楚描述的具体问题。为同一行为服务的实现、必要测试、配置和说明可以一起提交，避免拆到提交后无法构建或无法理解。
- 可以独立验证、审阅或回退的改动应分开，例如 VS Code 自动保存配置、设计 skill 与其入口、Git 提交规范属于不同提交。不能仅因为同属一次会话、一个任务编号或一个大功能就合并。
- 不按每个文件、每个函数或每处文字修改机械拆分。设计 skill 与它在 `DESIGN.md`、`AGENTS.md`、README 中的导航更新属于同一个完整变更。
- 涉及十几个文件时主动复查是否混入多个目的；涉及二三十个或更多文件时，默认进一步拆分。统一重命名、生成产物或不可分割的跨端契约等确需较多文件的变更，可以保持一个提交，但要在正文解释这些文件必须一起修改的原因。文件数是复查信号，不是硬性上限。
- 每组达到完整且验证通过的状态后，及时在已有授权内提交，不等到大功能全部完成才累计成一次提交。每次只暂存当前分组，提交前再次核对暂存区；共享文件按补丁区分各组内容，不夹带其他任务的修改。

### 提交信息

- 标题写清“具体对象 + 做了什么”，让读者仅看 `git log --oneline` 就能理解该提交的主要改动。`scope` 使用实际模块或工具名，不能仅写 `update files`、`misc changes`、`完善功能`、`更新文档` 等笼统描述。
- 标题聚焦具体变更，不只重复大功能名称。例如写 `chore(vscode): enable autosave after a one-second delay`，而不是 `chore: improve development experience`。任务编号仍按上方格式携带。
- 少量文件且文件名有助于定位时，可以直接在标题点名，如 `DESIGN.md`。多个文件无需全部塞进标题；正文按文件或紧密相关的文件组写明路径、修改内容和目的，让审阅者能快速对应差异。
- 除一眼可知的单文件小改动外，正文应说明关键文件或模块各改了什么、必要原因及实际验证结果；不能只罗列文件名，也不能声称未执行的检查已通过。
- 若标题必须用多个互不相关的动作才能概括，或正文需要并列解释多个独立目的，先重新拆分提交，再编写信息。

示例（任务编号仅作格式示意）：

```text
chore(vscode): enable autosave after a one-second delay (OPS-002)
docs(design): add Lovable workspace skill and DESIGN.md navigation (DOC-001)
docs(git): define commit splitting and message requirements (DOC-002)
fix(api): preserve the last snapshot when generation is cancelled (GEN-001)
```

多文件提交正文示例：

```text
docs(design): add Lovable workspace skill and DESIGN.md navigation (DOC-001)

- .opencode/skills/atoms-frontend-design/: define workspace tokens,
  layout, interaction states, and retain the initial-screen reference.
- DESIGN.md: link to the detailed skill as the design entry point.
- AGENTS.md and README.md: document when to read the skill and its purpose.

Validation: reviewed local links and skill metadata; git diff --check passed.
```

OpenSpec 变更中的需求、设计、任务状态和验收记录统一维护在对应 change 中，入口见 [OpenSpec 指南](./openspec.md)。既有任务沿用原编号和交接记录，不另建平行清单，也不将旧工作补写成已经由 OpenSpec 执行。

## Verification

提交与合并采用 [Verification](./verification.md) 定义的变更检查和证据要求；本文件只维护 Git 操作顺序，不另设一份测试策略。

## Merge and publish

- 常规变更通过任务分支和 PR 合入 `main`；默认使用 squash merge，合并后的标题继续包含任务编号。
- PR 说明写清问题、最终行为、验证结果和剩余限制，避免重复聊天过程。
- 合并前检查完整差异、验证结果和冲突。远端出现新提交时先同步并检查，保持 `main` 历史可追溯。
- 初始基线允许直接在 `main` 创建和首次推送，对应 `GIT-004`、`GIT-005`；后续批次遵循任务分支流程。
- 合并后先确认任务分支已完整纳入 `main`，再在已授权范围内删除该分支。
- 提交、推送、创建 PR、合并与发布各自遵循用户已授权的范围；授权仍有效时无需重复询问。仅请求本地实现不自动授权这些操作。
- 不强制推送、不改写已经发布的 `main`，不擅自更换远端地址或全局 Git 配置。
- 公开仓库的写入同样需要账号权限；提交署名邮箱与推送认证相互独立。认证信息不写入仓库或日志。
- 秘密、原始题目材料和本地工具产物按 `.gitignore` 排除。用户授权推送也不改变这些文件的入库边界。

本规范记录协作流程；远端分支保护与自动发布未在本任务中配置或验证。

## Push procedure

1. 确认用户授权的目标仓库、分支和提交范围。只推送时不暂存、不提交工作区内容；工作区存在未提交改动不代表这些内容会被推送。
2. 检查当前分支、fetch/push 地址和 upstream，确认实际目标与请求一致。使用 GitHub CLI 时，检查当前账号及该仓库的写权限；邮箱署名不能替代推送认证。
3. 核对本地待推送提交的差异、实际验证结果和入库范围。已有有效验证且提交内容未变时复用证据；不把尚未提交的工作区内容描述成已经验证或即将发布。
4. 检查远端目标分支。首次推送使用带 upstream 设置的普通推送；已有 upstream 时正常推送，不使用强制覆盖。
5. 返回 403 或认证错误时处理账号、凭据和权限。GitHub CLI 已登录正确账号而 Git 使用旧凭据时，可使用单次命令级 credential helper，保持远端地址和全局配置不变。非快进拒绝则先 fetch 并检查双方提交，保留本地未提交改动。
6. 成功后重新读取远端分支 SHA，与预期提交比较，检查 upstream，并确认操作未改变本地工作区和暂存区。
7. 交接时给出仓库、分支和推送后的提交号，明确哪些改动仍未提交。没有待推送提交时报告两端一致，不创建空提交。

## References

- [GitHub flow](https://docs.github.com/en/get-started/using-github/github-flow)
- [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)
