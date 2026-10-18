# Documentation

文档按职责放在英文子目录中，普通文件名使用英文 kebab-case；目录入口使用 `README.md`。正文可以使用中文。

| 目录 | 文档 | 内容与阅读时机 |
| --- | --- | --- |
| `product/` | [core-paths.md](./product/core-paths.md) | 应用场景与核心路径优先级、模板生成策略、范围与验收目标；实施产品能力前阅读，具体任务在 OpenSpec change 中跟踪 |
| `architecture/` | [stack-decisions.md](./architecture/stack-decisions.md) | 选型依据、候选比较与适用条件；重新评估技术决策时阅读并更新 |
| `architecture/` | [monorepo.md](./architecture/monorepo.md) | 目录职责、依赖方向、workspace 与工具链边界；调整应用组织和共享代码时阅读并更新 |
| `engineering/` | [development.md](./engineering/development.md) | 类型、接口、配置、日志及生成与存储规则；修改对应代码时阅读，规则变化时更新 |
| `engineering/` | [verification.md](./engineering/verification.md) | 检查选择、已有覆盖和验收证据；验证任务时阅读，检查与覆盖变化时更新 |
| `engineering/` | [lifecycle.md](./engineering/lifecycle.md) | manager 初始化/诊断/起停/日志、原生 Process Compose 与后续基础设施契约；调整命令、进程或基础设施时阅读并更新 |
| `engineering/` | [git-workflow.md](./engineering/git-workflow.md) | 任务编号、分支、提交、推送与合并约定；开展版本控制操作时阅读，流程变化时更新 |
| `engineering/` | [skills.md](./engineering/skills.md) | 上游技能来源、固定版本与触发范围；使用或更新项目技能时阅读 |
| `engineering/` | [openspec.md](./engineering/openspec.md) | OpenSpec CLI、上下文、工件和技能入口；创建、推进或更新变更时阅读，接入方式变化时更新 |
| `product/` | `assignment.md`（仅本地） | 原始题目参考材料；存在时可供本地查阅，由 `.gitignore` 排除，不能复制到公开文档 |

公开项目的目标、当前实现状态与运行命令见根目录 [README.md](../README.md)。原始题目材料不随仓库发布，克隆后不存在属于预期情况。

Agent 工作入口见 [AGENTS.md](../AGENTS.md)，UI 设计入口见 [DESIGN.md](../DESIGN.md)。本索引只导航，具体规范在对应文档中维护。

应用内修改还需阅读对应的 [前端指南](../frontend/AGENTS.md) 或 [后端指南](../backend/AGENTS.md)；跨端 HTTP 契约变更读取双方指南。局部入口补充目录职责和任务路由，通用规范仍由本目录的权威文档维护。

规范细则各维护一份：选型文档说明为什么选择，Monorepo 文档约束包边界，开发规范约束实现，验证文档定义如何验收，生命周期文档定义进程行为。入口只保留摘要与链接，UI 细则继续由设计 skill 维护。

移动或重命名文档时，同步更新本索引、根目录入口和所有实际引用，避免留下失效链接。
