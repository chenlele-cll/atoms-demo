# Proposal

## Why

项目已能保存不可变模板和生成候选，但当前前端尚无历史列表、历史源码查看或恢复确认流程。REV-003 将 REV001 的历史读取、REV002 的恢复操作组合到 GEN006/007 规划的同一工作台，让用户先检查真实历史快照，再明确恢复，避免查看动作或过期反馈改变当前版本。

## What Changes

- 在 GEN007 项目工作台内新增分页历史视图，显示稳定版本序号、时间、关联请求摘录、事实摘要和修改文件；分别标识持久当前版本、正在查看版本和生成候选。
- 使用 REV001 `GET /api/projects/:projectId/versions?limit=20&beforeSequence=N`，消费 `projectId/currentVersionId/items/nextBeforeSequence`；不创建重复历史接口，不推测“曾采用”或验证状态。
- 复用 GEN006 单版本完整快照读取和唯一 `SnapshotPreview`、GEN007 只读源码及导航。历史选择只改变本地查看对象，先取得本轮真实预览编译反馈、检查交互，再进入明确的恢复确认。
- 使用 REV002 strict `{expectedCurrentVersionId}` 恢复请求；处理 CAS、busy/unconfirmed、写入失败和结果未知，未知时以 GET 项目确认，不自动重新覆盖，也不调用模型。
- 为列表分页、长文本、旧请求隔离、预览身份、无权限、键盘焦点及桌面/320/375px 布局规划聚焦验证。纯状态、客户端和组件 fixture 可先行；完整接入以 GEN006/007 实际可用为闸门。
- 本轮仅创建本目录规划工件，任务全部未完成；用户当前授权限于 REV001～005 的规划。恢复后的继续修改由 REV004 负责，跨 REV 完整验收由 REV005 负责。

## Capabilities

### New Capabilities

- `version-history-workspace`：在项目工作台中分页检查历史、同步预览与只读源码、明确确认恢复，并隔离并发与未知结果。

### Modified Capabilities

无。主规格目录当前没有能力；本增量引用其他 active change 的接口边界，不修改 candidate-review 或 project-workspace 的归属契约。

## Impact

未来实现涉及 frontend 的项目工作台、版本客户端、历史组件及纯状态测试，复用 GEN006 计划的 `@atoms/contracts`、预览和 GEN007 的源码视图，不新增运行依赖、路由框架、第二套预览或临时工作台。历史列表 schema/存储归 REV001，恢复 schema/事务归 REV002，GEN006 继续拥有单版本来源、修改文件与采用可用性；REV-003 只消费这些权威契约。

当前实际源码是首页连接检查、企业官网 Sandpack 基线预览，以及后端项目/会话/消息/不可变版本存储和内部有界生成；公开生成、候选预览采用、工作台和 REV 接口仍待实施。工件或 fixture 通过不代表真实生成、预览、恢复或最终环境验收已通过。
