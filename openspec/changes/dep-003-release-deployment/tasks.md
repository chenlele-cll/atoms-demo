# Tasks

任务：`DEP-003`。1～3 节保留早期框架交付历史；4～5 节按用户最新要求补齐依赖就绪后的实际接点。本机实现/验证不代表真实服务器发布完成。

## 1. Offline plan and dependency boundary

- [x] 1.1 DEP-003 实现离线 plan 文本/JSON、阶段与待接入点展示及 --release 预留输入，明确 canApply=false；验证缺依赖时 apply 在 inventory/产物读取和 SSH 前失败，帮助/非法参数/损坏框架声明不泄密，更新命令说明。

## 2. Native deployment framework

- [x] 2.1 DEP-003 使用 Ansible 原生 import_tasks/block/rescue/always 建立预检/发布暂存/配置/激活/健康/恢复/收尾阶段，未实现接点明确 fail；验证全部阶段语法及直接 playbook 门禁，无隐藏启用开关或服务器操作。
- [x] 2.2 DEP-003 用 builtin file/stat/template 实现专用目录配置暂存与既有 env 保护，标明配置合并待接入；验证实际隔离渲染、重复 changed=0、既有秘密 env 不变、过期暂存清理及拒绝非普通配置文件，文档区分暂存与安装。
- [x] 2.3 DEP-003 实现仅消费可信版本/内容/私有配置指纹和健康观察的幂等决策；测试同包健康无操作、代码切换、两类配置独立更新、同包修复、同 ID 内容冲突和未知健康拒绝，不读取/创建发布清单或真实状态。

## 3. Integrated verification and handoff

- [x] 3.1 DEP-003 完成聚焦行为测试、离线计划/语法/渲染与现有 check/status 回归，验证重复命令、无工具副本、失败输出、取消及无关进程保护，记录实际版本与未运行的真实部署范围。
- [x] 3.2 DEP-003 更新 README/Deployment/Lifecycle/Verification 的阶段状态与接入说明，执行严格 OpenSpec、链接/差异/秘密/私有配置/Git/并行工作保护检查，保留证据；不改核心代码、不连接服务器、不提交/推送/归档。

## Workflow follow-up

- GEN-009 已提供真实生产者/产物，本轮复用其契约，不另建打包器。
- 本轮完成归属、上传、配置、冷备份/激活、健康和恢复实现，DEP-004 仍需专用真实 Ubuntu/公网目标验收。
- DEP-001 的自动连接问题与既有环境事实保留，不因为框架完成标为通过。

## 4. Complete available integrations

- [x] 4.1 DEP-003 复用 GEN-009 清单校验与源码快照，接入显式包验证、匹配缓存和目标机隔离构建，拒绝跨平台/ABI 包及秘密/越界输入；验证真实生产者的包、篡改/错误平台/缺包分支，保留来源契约。
- [x] 4.2 DEP-003 将 apply 接入原生 Ansible 预检、私有暂存、上传/构建及执行，确认受管根/服务/站点/端口和工具/TLS 前提；验证默认入口实际分派、失败无越权操作、配置/日志秘密保护。
- [x] 4.3 DEP-003 在目标事务中使用进程范围文件锁，接入不可变发布、私有环境合并、同包 no-op、选择性服务操作和冷备份/兼容检查；用隔离真实文件/SQLite 验证重复、配置更新、并发、拒绝篡改和数据保留。
- [x] 4.4 DEP-003 接入真实健康/代理检查、成功状态原子记录及失败/中断恢复日志；验证兼容旧包恢复、不兼容 schema 拒绝自动回退、下一次安全前向修复，不恢复旧库覆盖当前数据。

## 5. Completion verification

- [x] 5.1 DEP-003 执行控制端/Ansible 回归、真实产物校验、隔离事务与真实 Node/Nginx/SQLite 主路径验收，覆盖 no-op/代码及配置变化/失败恢复/持久化/互斥；记录实际平台与尚未执行的真实服务器范围。
- [x] 5.2 DEP-003 更新命令/配置示例/部署与生命周期说明、接点状态和 DEP-004 前提，执行受影响检查、严格 OpenSpec、链接/差异/秘密/Git/并行工作保护，保留证据；不提交、推送或自动上线。

## Historical framework verification

- 控制端 macOS arm64、Python 3.14.3、ansible-core 2.21.5、psutil 7.2.2；没有增加依赖。
- ./deploy.sh test：22 项通过，27.671 秒。包含原 check/status/秘密/取消保护，以及离线 plan、原生门禁与 rescue/always、实际配置暂存/重复无变化/既有秘密 env 保留/过期暂存清理/符号链接拒绝、幂等纯策略。
- ./deploy.sh plan --json：退出 0，0.067 秒；5 个主阶段、恢复与收尾、7 个明确待接入点，canApply/deploymentVerified 均为 false，不读取发布包或 inventory。
- ./deploy.sh validate：退出 0，1.656 秒；4 个 playbook 含静态导入阶段的语法及生产模板渲染通过。Shell/Python 语法检查通过。
- 本次没有连接真实服务器、解析/构建/上传真实产物、运行生产 Nginx/systemd、激活/回退服务、模型调用或数据库操作。真实接入及 DEP-004 目标验收仍未完成。
- DEP-003/004 严格 OpenSpec、Shell/Python 语法、相对链接及差异空白检查通过；私有配置内容/0600 权限和 Git HEAD/index 未变，公开文件匹配当前凭据为 0，未修改核心源码或增加依赖，并行工作保留。
- 私有证据位于忽略且受限的 test-results/dep-003/framework/；OpenSpec 工件通过不等于真实发布通过。

## Completion verification

- 本轮补全真实部署接点，没有增加依赖；控制端 macOS arm64、Node 22.22.2、Python 3.14.3、ansible-core 2.21.5、psutil 7.2.2。真实进程使用忽略目录内按官方源码独立编译的 Nginx 1.30.6（TLS 模块）；未改系统 Nginx。
- 最终 `./deploy.sh test` 显式传入两份实际 GEN-009 本平台包和 TLS Nginx：41/41 通过，无跳过，测试 143.563 秒、命令总计 143.886 秒。包括实际 Ansible/控制分派与脱敏、生产者校验/公开源过滤、13 个文件/SQLite 事务场景、真实 SIGTERM 恢复/SIGKILL 释放锁及真实 Node/Nginx/HTTPS/SQLite 主路径。
- 实际生产包 A/B 经原校验器完整验证，使用生产模板与事务，在随机自有本地端口完成 HTTPS 会话/项目创建、同包无重启、换包、后端配置重启、代理单独 reload、坏配置停服前拒绝、激活后健康故障恢复和原会话/当前快照重开。只替换 OS 服务管理；测试证书 CA 仅在测试适配器信任，生产没有该开关。高 schema/前向修复由真实 SQLite 的受控迁移夹具验证，不声称已做真实产品跨版本迁移。
- 初始现有 Nginx 无 TLS 模块的专项失败和收紧运行权限后暴露的私有 umask 夹具失败均保留；修正专用 TLS 工具、公开夹具权限和构建执行 umask 后完成上述全绿回归。另实际执行两个生产构建 argv 的 umask 包装：0077 父环境下生成文件 0644、暂存根仍 0700。
- 生产者原语无依赖提取后 `pnpm test:release` 16/16 通过，接口保持不变；受影响 JavaScript ESLint、目标 Python 3.9 语法兼容、Shell/五个 Ansible playbook/模板、DEP-003/004 严格 OpenSpec 与差异空白检查通过。plan 显示 implementationReady/canApply=true、无未实现接点，targetVerified/deploymentVerified=false。
- README、部署/生命周期/验证指南、英文配置示例、当前设计和 DEP-004 前提已同步。相对文件链接无失效，公开文件匹配当前服务器凭据为 0，私有 inventory 内容未变、0600、仍 Git 忽略。
- 本任务未修改应用/HTTP/依赖/lockfile、未新建真实服务器连接、未调用模型、未做工作区提交/推送/分支操作。期间其他任务更新了 HEAD/index 和核心文件，已如实记录并保留，不将其宣称为本轮验证范围。
- 私有证据位于 test-results/dep-003/completion/，包含最终/失败尝试、检查、umask、隐私审计；真实 Ubuntu/systemd、服务器权限、Linux 目标构建、公网 TLS/SSE、DEP-004 目标更新/故障矩阵仍 not-run，DEP-004 保持 1/9。没有自动上线。
