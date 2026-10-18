# Tasks

任务：`DEP-003`，按用户最新确认的“部署脚本框架、缺依赖保留待接入点”范围执行。完成以下框架任务不代表真实发布完成。

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

- GEN-009 仍需实现并验收实际发布包；本任务不推进其产品前置或另建打包器。
- 后续实现真实目标归属、上传、私有配置合并、冷备份/兼容激活、健康与恢复接点，再恢复 DEP-004 的目标验收。
- DEP-001 的自动连接问题与既有环境事实保留，不因为框架完成标为通过。

## Verification results

- 控制端 macOS arm64、Python 3.14.3、ansible-core 2.21.5、psutil 7.2.2；没有增加依赖。
- ./deploy.sh test：22 项通过，27.671 秒。包含原 check/status/秘密/取消保护，以及离线 plan、原生门禁与 rescue/always、实际配置暂存/重复无变化/既有秘密 env 保留/过期暂存清理/符号链接拒绝、幂等纯策略。
- ./deploy.sh plan --json：退出 0，0.067 秒；5 个主阶段、恢复与收尾、7 个明确待接入点，canApply/deploymentVerified 均为 false，不读取发布包或 inventory。
- ./deploy.sh validate：退出 0，1.656 秒；4 个 playbook 含静态导入阶段的语法及生产模板渲染通过。Shell/Python 语法检查通过。
- 本次没有连接真实服务器、解析/构建/上传真实产物、运行生产 Nginx/systemd、激活/回退服务、模型调用或数据库操作。真实接入及 DEP-004 目标验收仍未完成。
- DEP-003/004 严格 OpenSpec、Shell/Python 语法、相对链接及差异空白检查通过；私有配置内容/0600 权限和 Git HEAD/index 未变，公开文件匹配当前凭据为 0，未修改核心源码或增加依赖，并行工作保留。
- 私有证据位于忽略且受限的 test-results/dep-003/framework/；OpenSpec 工件通过不等于真实发布通过。
