# Deployment Acceptance Report

任务：`DEP-004`。**12/12 完成，已修复用户实测的模型配置 503**。真实 Ubuntu/systemd/Nginx、公网可信 IP HTTPS、A/B 更新、幂等/故障恢复及本地模型配置同步均有实际证据；生成和流式检查使用明确的测试上游，未调用计费模型。任务状态见 [tasks.md](./tasks.md)。

## Authentication and target

早期自动 SSH 失败是真实的服务器拒绝。用户随后在本机通过 getpass 与 inventory 比对，结果 DIFFERENT，并原子更新私有密码；更新后 Ansible 官方 sshpass 自动连接、sudo 与正式 check 均通过。原因是旧私有配置与可登录凭据不一致，不能归因于 Terminal 应用控制限制。

目标为 Ubuntu 22.04 x86_64、Python 3.10、systemd 和现有 Nginx。首次确认 /srv/atoms、Atoms unit/站点不存在，之后仅建立所属专用验收实例；其他站点、数据库和进程保存基线，不接管既有 8443。控制端和目标均使用精确 Node 22.22.2、pnpm 12.11.2，目标工具单独安装于 /opt/atoms-toolchain，不替换全局 Node。

9443 实际不可达，改用原本空闲且公网可达的 443；3001 只绑定 loopback。取得真实 Let’s Encrypt IP 证书，系统信任和 IP 校验通过；使用现有静态 webroot 完成 ACME，未改其他站点，另设专用定时续期与校验后 reload，真实 Certbot renew --dry-run 已通过。真实地址、密钥、原始站点与凭据只保存在私有证据中。

## Observed target scenarios

| 场景 | 实际证据与结果 |
| --- | --- |
| 首次发布 A | GEN-009 在 Ubuntu 真实 offline frozen 构建，SQLite 原生读写通过；首次成功 apply 为 install，真实 systemd、HTTPS、静态内容和 JSON API/404 通过 |
| 健康 A 连续两次 | 均 noop/changed=false；同一 PID/启动时间/成功状态字节/包目录/数据库逻辑摘要，无重建或新 UUID |
| 停止后恢复 A | 主动停止所属 unit 后 apply=repair；同一 UUID、单实例恢复，原项目/会话/快照不变，冷备份 quick_check=ok 且含测试项目 |
| 实际代码更新 B | 在冻结源码副本只增加构建可观察 meta，使用同一 GEN-009 真实构建；apply=activate，新 UUID/内容摘要，旧 A 清单保持不变 |
| B 浏览器与数据 | 真实 HTTPS 页面可见 B 的 meta；同一浏览器会话/项目/当前版本/快照摘要保留，预览实际编译完成 |
| 运行配置 | 后端 MODEL_ID fixture 补丁 configure 后 PID/启动身份变化，release 不变；重复 noop；代理独立变更 configure，后端身份不变，重复 noop。原代理模板已恢复，重复 no-op；原包和逻辑数据保留 |
| 隔离坏包 | 目标实际复制的完整 A 内容篡改、越界链接、重算清单后的错误平台，均经生产 Transaction/System 在激活前拒绝 RELEASE_INVALID；只操作隔离副本 |
| 浏览器基线 | 实际创建专用项目，模板预览编译、FAQ 交互、源码查看通过；无模型设置时如实返回模型未配置，未伪造生成通过 |
| 公网路由 | Mac 系统严格 TLS，首页/项目深链接/API health/JSON 404、静态 JS/CSS MIME 共 9 项检查通过；私有路径未返回秘密文件 |

A：`07dbcfb4-bf3d-4601-a954-07fa23278958`，releaseDigest `885f684ffa8147b9960f34724b9edcf35f1fa5f412138a38060e82e02b7613f5`。

B：`03b458e2-33aa-4315-a4d5-707b0eb4e914`，releaseDigest `8a9d721b4cff0cb4c4814373ff5e051f86a9e59df6861b2234946eb58819cd59`。

成功首次安装 runId `65a703b1-c68f-4ccd-b213-b83a8227b0a6`；重复 `43ab1102-07ab-45fb-b59f-da06f09c0027`、`dbf47e51-8e0a-4399-ab51-d2c3ec44c988`；修复 `8b88f359-bddc-49b2-9423-a72f066651d0`；B `9f87de77-239d-41a1-b055-c242e614aadc`。每次的时间、退出码及前后服务/数据记录均在私有证据中。

## Failure, interruption and rollback evidence

- 坏代理在停旧后端前拒绝，recovery=unchanged；新 unit 启动后 HEALTH_FAILED，恢复 B 并真实健康，成功记录字节和逻辑数据保留。
- 控制端进程锁竞争非零；目标真实内核 flock 竞争返回 DEPLOYMENT_BUSY。停止专用持锁进程后正常 no-op，未删锁文件。
- 上传完整归档后、校验解压前向所属控制进程组发送 SIGTERM，退出 143；旧服务/成功状态/数据不变，仅清理匹配 runId 的暂存。
- 在真实 activated 阶段向精确所属 helper PID 发送 SIGTERM，命令 DEPLOYMENT_INTERRUPTED；恢复 B 并真实健康，完整包重试 no-op。
- 高 schema 测试先停止专用服务，将原库原 inode 保留，创建副本设 user_version=4。正常部署入口明确 SCHEMA_INCOMPATIBLE，未改成功状态；测试副本仍为 4。清理仅重新接回从未修改的原文件，保留未来 schema 夹具，不把此清理称为自动降级或覆盖恢复。随后正常 A 回退沿用原 UUID，所有测试项目逻辑摘要相同。
- 实测其他 12 份 Nginx include 内容、原 Nginx 主 PID 与 6 个无关监听所有者保持基线。故障仅注入 Atoms 专用实例。

## Implementation fixes and local checks

真实 Linux 流程暴露并修复：pnpm fetch 不接受 frozen 参数；生产者启动前需要按锁文件准备其依赖；所选工具链目录需要标准命令名与 PATH；BSD tar 合成 AppleDouble 文件破坏模板文件数；Ubuntu 新 inactive unit 的 reset-failed 行为；远端 umask 导致根目录不可遍历。失败保留生产者和 pipeline 私有诊断，成功后仍保留旧失败记录。

用户新增本地模型同步要求已实现：apply 默认用 Node parseEnv 读取 ignored/owner/0600 的 backend/.env，仅同步非空模型白名单；显式 --env-file 替代自动来源，未给出的远端项保留。秘密通过现有私有 JSON/环境文件传递，非 apply 命令不读取。真实目标已同步 4 项非空设置并逐项比较一致；同包 configure 仅重启后端，再次 noop，PID/启动身份和成功记录字节不变。生产进程环境与私有文件值一致，原包/数据库保留，未调用计费模型。

当前完整本地部署套件：47 项，46 通过、1 个显式原生专项按默认条件跳过，50.334 秒；最后隔离 Node 预载环境的修改另执行 8 项控制端回归通过；五个 playbook 语法/模板渲染、OpenSpec 严格校验通过。跳过项不算通过，真实 Ubuntu 场景另列上述证据。

## Acceptance conclusion

坏代理/健康失败恢复、并发、上传完成后解压前中断、activated 阶段 SIGTERM、隔离高 schema 拒绝和兼容 A 回退已通过。公网 SSE 已实测 accepted 82ms、10.043 秒心跳、成功终态、USER_CANCELLED、CLIENT_DISCONNECTED 和重启后不重放；使用测试 HTTP 上游，真实模型调用为 0。读取最后计数时曾有 SSH UNREACHABLE，已保留失败并恢复生产入口；随后重新启动 fixture 仅复核持久终态重放及计数 0→0。后续只读 SSH 也曾失败，最终正式 status 和生产复核成功；不自动重试认证，保留失败记录，不把本轮验收称为每次网络连接都成功。

真实生产配置同步/幂等复测通过：同步 runId `62903c13-5e54-4b2d-94e5-950bb26b93d4`，重复 `4808bef3-86ff-411a-81a9-a901426ed613`；生产进程确认实际加载相同配置。最终 status `74ba5135-64be-4d18-865b-499ba799ad59` 为 healthy/deploymentVerified=true。候选 fixture 的预览、5000/7000/10000 报价、源码核对、采用、切回生产入口后同快照重开及 375/320px 无宿主溢出通过。

专用 fixture 启动器/管理端口已移除/停止，历史失败 runId 的所属暂存已确认并清理，目标所属暂存数为 0；未来 schema 测试副本保留在私有 backups 证据目录，原库未改变。所属浏览器已关闭。前轮结束保留 A 和 B；用户反馈后的当前修复包为 C，身份与复核结果见下节。真实模型配置和测试项目均保留。445 个 Git 可见文件未匹配当前凭据，本地/目标配置权限 0600。证据汇总为私有 acceptance-summary.json。

上述 A/B 来自记录的冻结源身份；C 仅在 A 基础上纳入已实现的零超时逻辑，其他并行产品改动没有自动上线。本验收不替代真实模型业务质量或 GEN-010 的验收。

## Evidence and scope

本轮证据：忽略且 0700 的 test-results/dep-004/acceptance-06c98e91-b54f-4f7f-9eab-d5f79c96ad6c/，原始配置/日志/cookie/项目快照文件仅存于私有目录。正式命令另保留 .runtime/deploy/runs/&lt;runId&gt;；B 控制端位于该私有证据下的冻结源副本。浏览器截图位于 output/playwright/。

历史 sshpass 失败和隔离回归证据在 test-results/dep-004/sshpass-7fed8d80-3399-4b33-9f76-4a9019be2654/；更早连接证据在 target-cc1bdac7-ea6d-434e-aa45-ceb8176aeb45/。历史“无构建/无 apply”结论已被当前实际构建与发布替代，不再代表现状。

没有工作区 Git 写操作、计费模型调用、提交、推送或归档。并行产品改动保留，代码更新测试只在冻结源副本进行；故障不注入其他站点/用户服务，不恢复旧备份覆盖当前库，不降级原库 schema，不删除锁文件解锁。

## Model configuration follow-up

用户实际创建项目后出现 HTTP 503 MODEL_CONFIGURATION。只读复核确认 key 已在生产进程中，但 A 的 readModelConfig 拒绝同步的 MODEL_TIMEOUT_MS=0；原矩阵只验证配置字节和进程环境，未验证发布版本的解析兼容性。不得将旧 11/11 结论扩展为真实生成可用。

修复在隔离 A 源副本复用工作区已经实现的零超时配置、模型客户端及生成协调逻辑，其他并行产品改动保留；由 GEN-009 在 Ubuntu 构建并激活 C：`dfb06444-12b5-4d6c-a2f2-5ecdb25959db`，releaseDigest `0d6ce5a3d447ed6f5527ca8968143300f8fc51752ea49ab927291d8059e29f6f`。激活 runId `0409d301-ccd2-4fa1-8f0e-cf6fa0636239`；重复 `76045696-7312-478a-84ae-b9b1161e8138` 为 noop，进程 PID/启动身份、配置和数据摘要均不变。状态 runId `4b46bd85-2f7a-4c8b-846a-f7e53ecd7774` 为 healthy/deploymentVerified=true。

部署门禁用所选包的真实 readModelConfig 解析合并后的值，在停服、切换和 no-op 前拒绝不兼容配置；status 同样校验当前包。无 key 时仍允许诊断部署。有 key 的旧 A 在修复前返回 MODEL_CONFIGURATION；C 对实际生产配置（包含原 key 和 timeout=0）解析成功。暂存 JSON 0600，校验不调用供应商。

实际目标验证使用 C 的原始编译模块与生产配置，解析后将 key 替换为明确假值，在独立库/loopback HTTP 应用注入 SDK fixture；不替换线上 unit、不向用户项目写入测试内容。HTTP 受理、0 配置下持续运行、USER_CANCELLED 和候选保存全部通过（4 个本地 fixture HTTP 请求，1 次上游取消，真实模型请求 0）。公网 HTTPS 健康、原测试项目/采用快照、原模型配置、schema=3/quick_check=ok 和 Nginx 主身份保留；临时 fixture 已移除。

隔离副本类型检查与 80 项模型/生成回归通过，含 62.410 秒的零超时真实 loopback SSE 测试；部署事务专项 15 项通过。第一次扩大检查暴露了 no_log 外的合成 SSH 凭据错误输出，并发真实部署还干扰了控制锁专项；保留失败，补充命令输出字面密码过滤并串行复测，最终部署全套 48 项中 47 通过、1 项按显式条件跳过（49.745 秒）。这不将跳过项算作通过。固定 Ansible 渲染和 OpenSpec 严格检查通过。

证据在忽略的 `test-results/dep-004/model-config-1b94bb82-774a-4fd1-a15d-4be9fe16a477/`，包含诊断、来源选择、配置/数据/进程前后比较、目标 HTTP fixture 和 summary.json；449 个 Git 可见文件匹配真实凭据为 0。修复未调用计费模型，供应商实际生成质量仍由用户显式生成或 GEN-010 另行验证。
