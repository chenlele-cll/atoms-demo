# Spec Delta

## Purpose

让项目所有者安全地将当前版本引用恢复到本项目已持久化的模板或生成快照，保留全部不可变历史，并在并发选择、生成未结束、存储故障及响应丢失时获得真实可确认的结果，不把恢复等同于编译或业务验证。

## ADDED Requirements

### Requirement: 恢复接口具有严格的私有契约

系统 SHALL 提供 `POST /api/projects/:projectId/versions/:versionId/restore`，路径标识与 `expectedCurrentVersionId` 为 UUID，strict JSON 只接受该必填字段且请求体最多 1 KiB。成功返回 200 与 `projectId/currentVersionId/updatedAt/alreadyCurrent`；所有响应 MUST 为 no-store，不能返回代码、会话内部信息或原始异常。

#### Scenario: 合法请求返回已持久化引用

- **WHEN** 所有者以合法 expected 请求恢复符合条件的目标
- **THEN** 返回对应项目、目标当前版本、持久化更新时间及布尔 alreadyCurrent，响应通过权威 schema 校验且不含代码正文

#### Scenario: 额外字段或传输输入非法

- **WHEN** 请求缺失 expected、标识非法、带未知查询字段或包含 files、compiled、verified 等额外字段
- **THEN** 返回 400；超出体积为 413、非 JSON 为 415，不更新数据，也不接收任何可信编译证明

### Requirement: 每次恢复重新验证会话和归属

恢复 SHALL 检查有效持久会话、项目归属、目标属于同一项目及精确配置的 Origin。无有效会话返回 401，来源不符返回 403；其他会话、跨项目目标与不存在资源 MUST 返回同形 404，不泄露目标是否存在。合法重试也不能跳过这些检查。

#### Scenario: 非所有者或跨项目目标

- **WHEN** 会话 B 请求 A 的项目，或 A 在自己的项目路径请求另一项目版本
- **THEN** 返回与不存在项目或目标相同的 404，不改变任一项目，不返回版本或运行信息

#### Scenario: 会话到期或 Origin 不符

- **WHEN** 已成功恢复后，会话到期再次重试，或请求携带缺失、非精确匹配的 Origin
- **THEN** 分别按 401 或 403 拒绝，不因为目标已是当前而放宽保护

### Requirement: 恢复目标来自有效的已存快照

恢复 SHALL 支持本项目的模板版本和 generated 版本，按快照自身固定身份验证完整结构、入口、路径、依赖、体积及重算 digest，不依赖今日模板目录。generated MUST 关联本项目有效 succeeded 运行，其 resultVersionId 指向目标、baseVersionId 等于目标 parentVersionId。不得要求曾被采用，或将结构合法声明为预览验证通过。

#### Scenario: 模板和未曾采用的生成版本均可恢复

- **WHEN** 已存模板或有效 succeeded 生成版本符合完整性检查，即使生成目标从未成为当前
- **THEN** 目标具有恢复资格，不要求采用日志、编译标记或今日目录内容一致；实际切换仍受 CAS 和活动检查约束

#### Scenario: 生成关联或快照无效

- **WHEN** generated 缺少 succeeded 结果关联，或有关联但状态、父基线或唯一性不一致，或快照结构、文件或 digest 被破坏
- **THEN** 缺少合格结果关联返回 409 VERSION_NOT_RESTORABLE，损坏或矛盾持久记录返回安全 500 DATA_CORRUPT；不从模板补齐，不执行代码，不改变引用

### Requirement: 恢复通过预期当前版本条件原子切换

目标尚非当前时，恢复 MUST 要求项目 currentVersionId 等于 expectedCurrentVersionId，以归属及当前引用条件原子更新 currentVersionId 和 updatedAt；不符返回 409 CURRENT_VERSION_CONFLICT。恢复 SHALL 不要求目标 parentVersionId 等于 expected，此条件仍属于 GEN-006 adopt。不得自动替换 expected、合并或覆盖竞争者选择。

#### Scenario: 恢复祖先或其他分支

- **WHEN** 当前为 B，目标为模板或父版本不是 B 的已存生成 A，expected 为 B，项目空闲
- **THEN** 恢复 A 成功，目标父关联保持原值，不因为 adopt 的父基线条件拒绝恢复

#### Scenario: 两个不同目标竞争

- **WHEN** 两个请求都观察当前 C，分别请求恢复 A 和 B，均携带 expected=C
- **THEN** 在目标均不同于 C 时至多一个切换成功，另一个为 409 CURRENT_VERSION_CONFLICT，不能在失败后自动换 expected 再覆盖

### Requirement: 同目标合法重试无写入且时间不变

会话、归属、输入与目标完整性检查通过后，若目标已经是当前，系统 SHALL 返回 200、alreadyCurrent=true 与现存 updatedAt，不要求 expected 仍等于当前，不重复更新任何数据。这一无写入分支 MUST 先于 CAS 与活动运行拒绝；损坏或无资格目标不能仅因已是当前而成功。

#### Scenario: 原响应丢失后的相同载荷重试

- **WHEN** C 已成功恢复到 A，携带 expected=C 的原合法载荷再次恢复 A
- **THEN** 返回 alreadyCurrent=true，updatedAt 与请求前持久值完全相同，不新增快照、消息或恢复记录

#### Scenario: 目标已是当前但有新生成

- **WHEN** A 已是当前且仍合法，此时项目有活动执行者或孤立 running，相同目标重试
- **THEN** 返回已是当前且不写数据，不取消或干扰运行；若目标已损坏则仍返回安全错误

### Requirement: 实际切换不得越过活动或未确认生成

目标尚非当前且 CAS 匹配时，恢复 SHALL 同时检查 GEN-005 活动执行者和持久 running。任一活动执行者含取消收尾阶段阻止切换并返回 409 PROJECT_BUSY；无执行者但数据库有 running 返回 503 RUN_STATE_UNCONFIRMED。检查不可用、服务关闭或所有权失效 MUST 拒绝写入，不能以默认空检查开放生产恢复。

#### Scenario: 执行者或取消收尾仍占用项目

- **WHEN** expected 匹配且尝试实际恢复，但生成执行者尚未完全收尾，即使已请求取消或数据库已存终态
- **THEN** 返回 PROJECT_BUSY，当前引用不变，恢复不代替取消或释放准入

#### Scenario: 遗留 running 没有执行者

- **WHEN** 目标尚非当前、expected 匹配，数据库有 running 而服务没有对应执行者
- **THEN** 返回 RUN_STATE_UNCONFIRMED，不静默终止该运行、不恢复、不启动模型；由 GEN-005 成功恢复运行状态后再允许新的明确操作

#### Scenario: 生成与恢复争用基线

- **WHEN** 新生成受理与实际恢复竞争同一项目
- **THEN** 生成先受理则恢复被 busy 保护；恢复先提交则携带旧基线的生成被基线检查拒绝，不能在恢复后的当前引用上继续写入旧基线结果

### Requirement: 恢复只修改当前引用和更新时间

成功的实际恢复 SHALL 只原子改变项目 currentVersionId 和 updatedAt。系统 MUST 不调用模型、编译或执行生成代码，不新增快照、不改写或删除版本、消息、运行、父关联及序号，不把恢复记为新生成或预览验证。更新失败全量回滚，存储不可用返回安全 503，关闭重开后选择和内容保持一致。

#### Scenario: 多次往返恢复并重启

- **WHEN** 在模板和两个合法生成版本间往返恢复，随后关闭并重开数据文件
- **THEN** 当前引用为最后提交的目标，全部历史快照和关联逐项保持原样，模型调用为零，没有新增版本或被删除的历史

#### Scenario: 更新事务故障

- **WHEN** 实际更新发生存储故障
- **THEN** 返回安全错误，旧 currentVersionId 与 updatedAt 全部保留，不产生半完成切换，日志无 SQL、凭据、路径或代码正文

### Requirement: 未知响应以当前事实确认且保持并发边界

恢复响应超时、丢失或无法验证时，调用方 SHALL 将结果视为未知，通过项目 GET 查询 currentVersionId，不能因网络失败声明回滚。查询只证明当下事实，MUST 不证明原请求从未或不会提交，也不推断采用历史。允许明确发起相同合法载荷重试，不自动更改 expected；UI 展示及门槛由 REV-003 实现。

#### Scenario: 提交成功但响应丢失

- **WHEN** 恢复已提交而调用方未收到有效响应，随后查询发现目标为当前
- **THEN** 可确认目标当前生效，不新增快照或重新生成；相同载荷重试返回幂等结果

#### Scenario: 查询仍失败或当前为其他版本

- **WHEN** 确认查询不可用，或查询读到旧版本或其他选择
- **THEN** 查询失败保持未知；其他选择不被自动覆盖，旧版本不被当成原请求绝不会提交的证明；目标曾生效后又被切走的历史也不能凭当前查询推断
