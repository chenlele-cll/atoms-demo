# Proposal

## Why

`SKL-002` 按用户要求统一仓库技能位置。当前设计技能位于 OpenCode 目录，OpenSpec 同时生成两套入口，导致不同 coding agent 可能读取不同文件。

## What Changes

- 所有仓库技能只保存在 `.agents/skills/<name>/SKILL.md`，设计技能及配套引用迁入此处，删除等价的 OpenCode 专用副本。
- 保留现有官方 OpenSpec 兼容 Codex 与其他 agent 调用方式的共享生成结果，以 codex,agents 单一物理目录刷新，不手改第三方正文。
- 更新当前导航、安装/刷新说明与发现边界；不支持共享目录的宿主只配置路径适配，不维护第二套正文。
- 验证实际工具发现、完整性、相对引用及刷新后不会恢复重复目录；个人全局技能保持原样。

## Capabilities

### New Capabilities

无；仅工具目录与文档调整，使用 skip_specs。

### Modified Capabilities

无产品契约变化。

## Impact

影响技能目录、Agent/设计导航和相关工程文档。没有新 Skill、依赖或应用代码，不改用户级配置、不提交、不推送或归档。此前工具级双份生成属于历史记录，由本变更替代现行目录规则。
