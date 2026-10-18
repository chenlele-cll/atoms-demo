# Tasks

任务：`DEP-002`；范围与前提见 [design.md](./design.md)。

## 1. Local entry and inventory

- [x] 1.1 DEP-002 实现 deploy.sh、固定 Ansible 环境 bootstrap、帮助/参数/单主机私有 inventory 校验与提前拒绝的 apply；补齐使用说明及入口边界测试，实际重复 bootstrap/help/apply 验证不隐式连接、不改私有文件、不泄密。

## 2. Inspection and templates

- [x] 2.1 DEP-002 接入 Ansible builtin 只读 check/status 与明确的缺项/未验收状态；补齐失败连接及秘密保护测试和检查说明，不运行配置收敛或发布。
- [x] 2.2 DEP-002 增加目录权限声明、Nginx IP HTTPS、systemd 和外置后端环境模板及离线 validate；用真实 Ansible 验证语法/渲染和重复执行，文档说明 GEN-009/releaseId、证书/端口前提及目标运行尚未验证。

## 3. Integrated handoff

- [x] 3.1 DEP-002 执行聚焦行为测试、离线验证、OpenSpec 严格校验与差异/链接/秘密/配置保护检查，记录真实工具版本、执行结果及 DEP-001/003/004 边界，保留并行工作；不提交、推送、归档或部署。

## Verification results

- 本机 macOS arm64，Python 3.14.3、ansible-core 2.21.5、psutil 7.2.2；所有控制端依赖固定在 deploy/requirements.txt。
- 显式 bootstrap 安装成功；已准备环境的重复 bootstrap 在禁止 pip 索引网络时成功，未改写 pyvenv.cfg。无工具副本 help/apply 与带空格路径检查通过，apply 退出 2 且无配置或连接操作。
- ./deploy.sh test：13 项通过，21.504 秒。包含真实 Ansible 官方 ASKPASS 的合成字面密码、失败输出保护、本地 builtin 模块的受控状态/前提分支、重复模板收敛及 SIGINT/SIGTERM/超时子进程清理；未连接真实服务器。
- ./deploy.sh validate：四个 playbook 语法及三份生产模板的真实 Ansible 渲染通过，changed=0；独立模板写入测试第二次执行 changed=0。sh -n deploy.sh 通过。
- DEP-002 与已补充日志结论的 DEP-001 均通过 OpenSpec 严格校验；已跟踪/新增文件空白及相关文档相对链接检查通过。私有 inventory 内容及 0600 权限、Git HEAD/index 未变，公开文件匹配当前凭据为 0；并行工作保留。
- 本步没有安装目标 Nginx/systemd 模板、运行真实 nginx -t/systemd 验证或发起远端部署。DEP-001 自动认证仍未恢复；用户提供的服务端日志已作为该任务证据补充，不据此声称探针通过。
- 发布构建归 GEN-009，真实上传/更新/健康切换归 DEP-003；幂等发布、配置单独更新、失败与数据保留验收归 DEP-004。releaseId 规则继续由 Lifecycle 单独维护。
- 私有证据位于忽略的 test-results/dep-002/；本变更不提交、推送或归档。
