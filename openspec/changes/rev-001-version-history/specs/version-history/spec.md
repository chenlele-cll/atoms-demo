# Spec Delta

## Purpose

为项目所有者提供稳定分页的版本历史，准确关联已存快照、需求和相对父版本的文件变化，让用户能够选择后续查看与恢复的目标。列表只呈现持久事实，不将生成保存、当前选择或消息摘要解释为曾采用、编译通过或业务验收。

## ADDED Requirements

### Requirement: 历史查询验证会话和项目归属

系统 SHALL 提供 `GET /api/projects/:projectId/versions`，每次请求检查有效会话与项目归属。缺会话 MUST 返回 401，其他会话与不存在项目返回同形 404；成功与错误响应均 no-store，不泄露会话、SQL 或其他项目内容。

#### Scenario: 作者读取已有项目

- **WHEN** 有效作者会话请求本项目历史
- **THEN** 返回对应项目的历史页，projectId 与请求一致，不混入其他项目版本或对话

#### Scenario: 缺会话和跨会话访问

- **WHEN** 无有效会话请求，或其他有效会话请求作者项目
- **THEN** 分别返回安全 401 或同形 404，不创建新会话或认领项目

### Requirement: 版本按稳定序号倒序分页

列表 SHALL 接受 limit（默认 20、范围 1..50）及可选非负安全整数 beforeSequence，拒绝其他或非法查询参数。items 按 sequence 倒序，仅包含 sequence 小于游标的版本；有后续项时 nextBeforeSequence 为本页末项序号，否则为 null。不得以可变当前引用或时间戳排序。

#### Scenario: 相同时间戳和分页间新增版本

- **WHEN** 多版本时间相同，作者读取第一页后另一个连接追加新版本，再以返回游标读取下一页
- **THEN** 原有较旧版本仍倒序且不重不漏，新版本在重新读取首页后可见，不挤掉下一页项目

#### Scenario: 模板页末和非法游标

- **WHEN** 查询 beforeSequence=0，或传入负数、小数、溢出整数、重复参数或未知字段
- **THEN** 前者返回空 items 和 null 游标，后者返回 400，不返回无限列表

### Requirement: 每页当前标记反映同次读取事实

响应 SHALL 包含 projectId、currentVersionId、items、nextBeforeSequence。每项包含 id、sequence、parentVersionId、kind、createdAt、isCurrent、runId、request、summary、changedFiles；本页 isCurrent 与同响应 currentVersionId 一致。current 可以不在本页，不根据最大序号推断，也不声称跨页永久一致。

#### Scenario: 当前指向较旧版本

- **WHEN** 项目当前引用指向较低序号的已存版本，且该项在本页中
- **THEN** 仅它的 isCurrent=true，较新候选仍保留且不会被标记为当前

#### Scenario: 两次请求之间当前选择改变

- **WHEN** 页一读取后项目当前引用改变，作者继续请求页二
- **THEN** 页二返回其读取时的 currentVersionId 和一致标记，不把旧页当前引用当成固定历史事实

### Requirement: 需求和摘要可追溯且有界

生成版本 SHALL 仅通过同项目 succeeded 结果关联定位 run 和消息；request 为对应 user 消息的标识及最多 240 个 Unicode 码点的摘录和 truncated 标志，缺失时为 null。summary 含最多 240 个码点的 text 和 stored/fallback 来源；stored 来自关联已存 assistant 消息，缺失时用事实性 fallback。不得额外调用模型或生成虚假需求。

#### Scenario: 有完整成功运行消息

- **WHEN** 生成版本关联 succeeded 运行，且该运行有 user 和 assistant 消息
- **THEN** 返回该运行 ID、最早 user 的需求摘录和最后 assistant 的存储摘要；超长需求标记 truncated，不取其他运行消息替代

#### Scenario: 模板或缺少旧关联信息

- **WHEN** 版本为模板，或旧生成版本没有成功关联或对应消息
- **THEN** 缺失的 runId/request 为 null，缺少 assistant 时返回标明 fallback 的模板起点或已保存生成快照说明，不推断曾采用或已验证

### Requirement: 修改文件来自与父快照的实际比较

changedFiles SHALL 为去重、稳定排序的规范路径数组；生成版本相对其自身 parentVersionId 比较完整文件映射，覆盖新增、删除和内容修改。模板为 []。快照按自身历史身份、结构和摘要校验，不从当前模板补齐；文件路径不等于逐行 Diff 或业务验证结论。

#### Scenario: 当前版本与父版本不同

- **WHEN** 历史生成版本的父快照并非当前版本，且文件存在增加、删除或内容修改
- **THEN** 修改路径只按该版本与其父版本计算，不与当前引用或最新模板比较

#### Scenario: 缺失父版本或摘要损坏

- **WHEN** 本页需要的快照、父引用、成功运行关联存在损坏或矛盾
- **THEN** 整页返回安全数据错误，不以空修改数组、默认模板或部分成功掩盖损坏

### Requirement: 历史读取不产生产品写入或模型调用

历史查询 MUST 不改变当前引用、更新时间、快照、消息或生成状态，不调用模型、不执行代码。响应只含有界元数据，不包含文件正文、完整对话、预览凭据、曾采用标记或可信验证结论；存储/频率故障 SHALL 明确返回安全错误，不能伪装为空历史。

#### Scenario: 重复读取和关闭重开

- **WHEN** 作者重复分页查询并在数据库关闭重开后再次查询
- **THEN** 版本关联和元数据保持一致，除真实并发写入外数据不变，模型请求增量为零，代码正文仍须由独立完整版本接口读取

#### Scenario: 存储不可用或请求受限

- **WHEN** 查询遭遇存储故障或触发限流
- **THEN** 分别返回安全 503 或带 Retry-After 的 429，不伪造空 items 或泄露底层错误
