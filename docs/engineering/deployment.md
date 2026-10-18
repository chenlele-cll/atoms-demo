# Deployment

本文件维护 `DEP-002/003` 的部署入口、框架和接入边界。开发环境继续使用 [Lifecycle](./lifecycle.md) 的 manager；生产版本身份统一遵守 [releaseId 规则](./lifecycle.md#deployment-release-identity)。

## Current scope

已提供本地工具安装、离线 plan/验证/测试、Ansible 只读 check/status、分阶段部署流程、配置暂存及幂等决策。用户已确认先完成框架、未实现依赖留待接入。**实际发布尚未接入，apply 显示依赖后非零，不读取私有 inventory/发布包或连接服务器。**

采用已有 Nginx 托管前端，`/api` 原 URI 转发到 loopback Fastify；systemd 监督一个后端。发布包沿用 [GEN-009 布局](../../openspec/changes/gen-009-local-release-validation/design.md)，不复制 macOS node_modules 到 Ubuntu。框架不提前实现其构建或另建 release.json 格式；真实上传/切换/健康等接点后续实现，目标幂等与故障验收仍由 DEP-004 完成。

## Local tools

控制端使用 Python 3.12～3.14，目标端需 Python 3.9～3.14。固定 ansible-core 2.21.5 及其依赖见 [requirements.txt](../../deploy/requirements.txt)，只使用内置模块与原生 SSH，不安装远端 Agent 或第三方 collection。控制端另固定 psutil 7.2.2，仅用于取消/超时时清理本次 Ansible 创建的独立会话 SSH 子进程，不运行常驻进程。

```sh
./deploy.sh bootstrap
./deploy.sh plan
./deploy.sh plan --json
./deploy.sh validate
./deploy.sh test
```

bootstrap 只准备忽略的 `.tools/deploy` 虚拟环境；版本匹配时直接成功，不联网或升级。缺 Python/venv/pip/下载前提明确失败，不自动安装系统包。更换固定版本须调整 requirements、复核官方支持矩阵并重跑验证。其他命令不补装工具。

validate 使用真实 Ansible 进行四个 playbook 语法检查及模板渲染，不读取 server.local.yml、不连接服务器、不创建远端文件。test 使用标准库 unittest、隔离 inventory 与 SSH 替身验证边界，不连接真实服务器；不是线上或 SSH 登录通过的证据。

## Deployment flow and integration points

plan 从实际 [apply.yml](../../deploy/apply.yml) 读取主流程/rescue/always 阶段，从 [integrations.yml](../../deploy/integrations.yml) 读取待接入点及负责人。它不读取私有配置或发布包；退出 0 仅表示计划生成，JSON 始终明确 canApply=false、deploymentVerified=false。

```sh
# --release 是已预留的输入，目前只记录“提供了路径”，不读取或验证该路径。
./deploy.sh plan --release /path/to/release --json
# 当前返回 2，先显示缺失接点，不读取凭据或连接服务器。
./deploy.sh apply --release /path/to/release --inventory server.local.yml
```

| 阶段 | 当前实现与接入要求 |
| --- | --- |
| 预检 | 框架位置已定义；需确认目标、端口、站点/服务归属及互斥，不能从既有响应推断归属 |
| 发布暂存 | 等待 GEN-009 真实产物选择/完整性/平台 ABI 校验及不可变上传；不生成假 ID 或复制依赖 |
| 配置暂存 | 已用 builtin file/stat/template 实现，输出到 shared/config/pending；只生成配置，不安装站点或启动服务 |
| 激活 | 等待私有配置合并、停止所属后端、冷备份/兼容检查和完整包切换；目前明确失败 |
| 健康 | 等待真实后端、最终 IP HTTPS、静态/API/持久性检查；不能从 ID 或模板推断成功 |
| rescue | 保留兼容旧包恢复接点，目前明确失败，不恢复旧数据库覆盖当前数据 |
| always | 仅报告安全的 framework/未验证状态，不输出原始异常、配置或失败结果正文 |

各待接入点在 integrations.yml 记录具体输入/输出要求。此文件不是功能开关；清空它或从直接 playbook 传入空声明不能启用发布，入口仍有明确失败门禁。脚本不接受任意 Ansible 参数或环境覆盖作为绕过入口。后续接入需实现对应任务、产物验证和执行契约，再增加实际验收；不能只删除 fail 任务宣告完成。

流程复用 Ansible 原生 block/rescue/always，不另建部署引擎。注意：不可达主机和无效任务定义不会触发这些恢复/收尾段，不能据此承诺网络中断时已回滚；真实状态检查与恢复必须由后续接点及 DEP-004 验证。[Ansible 官方行为](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_blocks.html)

## Idempotency decision boundary

控制端 decide_update 只处理可信接入点提供的版本 ID、包内容指纹、分别属于后端/代理的私有配置指纹和明确的健康观察；不解析或写入 release.json，不读取服务器、不构建、不恢复数据库。current=None 只代表接入点已确认没有当前受管版本，不能用来代替未知状态。

| 输入事实 | 框架决策 |
| --- | --- |
| 同包、同配置、两侧健康 | noop；不重建、不切换、不重启，仍须真实健康确认 |
| 选择另一个已验证包 | activate；要求冷备份检查及切换，保留旧包 |
| 仅后端配置变化 | configure；保持 releaseId，仅重启后端并验证 |
| 仅代理配置变化 | configure；保持 releaseId，仅处理代理并验证 |
| 同包但某侧不健康 | repair；保留包 ID，仅请求修复受影响服务 |
| 同 ID 不同内容，或健康未知 | 明确拒绝，不给出可执行成功计划 |

这里只完成决策规则；实际指纹采集、健康分类、互斥、配置合并及服务操作尚未接入。私有指纹不进入 plan 的公开输出，连接密码变化也不是发布包变化。

## Private inventory

```sh
cp server.example server.local.yml
chmod 600 server.local.yml
# 在本地编辑 server.local.yml，不把真实凭据写进 server.example。
./deploy.sh check
./deploy.sh status
# 或使用显式私有配置：
./deploy.sh status --inventory /absolute/path/server.local.yml
```

已存在私有文件时保留它，不重复执行 cp。配置必须是当前用户拥有的普通文件、权限恰为 0600、扩展名 .yml/.yaml，且仅包含 all.hosts.atoms 一个 IPv4 主机。密码与私钥路径二选一；密码是 YAML 字面值，不是 shell 转义，推荐单引号保存反斜杠；不 source 文件，不放在命令参数或日志。控制字符及模板分隔符不被接受，解析错误只显示固定提示。

除 server.example 的字段外，可在 atoms 下覆盖 atoms_https_port、atoms_backend_port、atoms_node_binary、atoms_pnpm_binary、atoms_nginx_binary、atoms_tls_certificate、atoms_tls_key。端口须互异；路径须为无空白/换行/模板/父目录段的绝对路径。根目录与服务名保持项目固定值，不接受额外 Ansible 连接、sudo、插件或执行参数。仓库内的私有 inventory 还必须被 Git 忽略。

默认程序路径为 /usr/bin/node、/usr/bin/pnpm、/usr/sbin/nginx；NVM 等安装必须填写实际绝对路径，非交互 SSH 不保证读取登录 shell 的 PATH。Node/pnpm 精确版本读取 .nvmrc/package.json，不另写一份版本规则。

SSH 严格验证已有 known_hosts，不接受未知或变更密钥、不关闭校验；新服务器先通过人工核对指纹的正常 SSH 登录建立信任。使用 Ansible 官方 SSH_ASKPASS，单次密码提示、无自动重试或连接复用。check/status 清理外部 ANSIBLE_* 覆盖、不接受 verbose/diff，原始观察由 no_log 保护。真实配置和本地工具/证据均不入库。

## Read-only inspection

check 查询 Ubuntu/systemd、精确 Node/pnpm、非交互 sudo、现有 Nginx 状态和 nginx -t、监听端口、证书 IP/服务器系统信任库/至少一天有效期、私钥文件是否可读。只返回检查名和布尔结果，必需项缺失时非零；不安装、授权 sudo、写站点、重载或杀占用者。版本检查禁用 Corepack 网络/自动下载/自动写 packageManager，不因缺 pnpm 隐式安装。

首次安装时相关端口须空闲；存在 current 时不以端口占用判定安装冲突，其所属服务仍需 DEP-003 核对。证书文件与服务器信任库检查不证明实际公网 TLS 或客户端信任；check 成功也不标记 deployment_verified。Ansible 本身可能创建并清理模块传输临时文件，nginx -t 等诊断可能访问日志，受管部署配置、应用和数据保持不动。

status 只报告 current 指针和后端/Nginx 的观察状态，不能据此声称产物、API、HTTPS 或流已通过验收。SSH/模块查询失败非零；未知状态须与明确停止区分。check/status 有 90 秒预算，bootstrap 为 300 秒、test 为 180 秒；SIGINT/SIGTERM 或超时只结束本次 Ansible/SSH 子进程。

## Production templates

模板位于 [deploy/templates](../../deploy/templates)，目录与权限声明见 [defaults.yml](../../deploy/defaults.yml)。配置阶段 [configure.yml](../../deploy/tasks/configure.yml) 在已确认的受管目录里使用 pending 子目录：目录 0700、文件 0600，重复渲染无变化时 changed=0；现有 backend.env 不读取、不覆盖，存在时移除本阶段旧的 pending/backend.env，拒绝 env 或 pending 目录为符号链接等非预期类型。运行配置更新/秘密保留合并另有待接入点，不用旧暂存覆盖现有配置。当前只在本地隔离目录验证这些操作，不向服务器安装文件。

| 路径 | 用途与权限计划 |
| --- | --- |
| /srv/atoms/releases/&lt;releaseId&gt; | 不可变完整包，root 管理，含 frontend/ 与 backend/；不存凭据或数据库 |
| /srv/atoms/current | 指向已验收包的软链接，健康确认后才记为当前成功版本 |
| /srv/atoms/shared/data | atoms 所有，0700，SQLite/锁文件；systemd 仅对此持久目录开放写入 |
| /srv/atoms/shared/config/backend.env | 外置 systemd EnvironmentFile，root:root 0600；更新须保留用户模型配置，不写入发布包 |
| /srv/atoms/backups | root:root 0700；停服冷备份，失败不自动覆盖当前数据库 |

服务使用非 root atoms 用户、backend 工作目录及绝对 Node 路径；环境从外置文件注入，保留 loopback 监听和精确 HTTPS APP_ORIGINS。应用产物不可写，NODE_OPTIONS/NODE_PATH 不进入服务；日志由 journal 管理。ProtectHome 默认禁止使用 /home 下的 Node，生产应准备服务可执行的系统级 Node 路径。

Nginx 为已有 http 上下文新增独立站点，不覆盖 nginx.conf 或其他站点；依赖已有配置包含 MIME 映射。默认 HTTPS 8443 仅为候选值，80/443/3001/8080/8443 的现有响应不代表端口空闲。无域名仍须可验证的 IP HTTPS；证书位置默认 /etc/letsencrypt/live/&lt;IP&gt;/，不在本步签发、续期或替换现有证书。

静态根仅为 current/frontend；/api 与 /api/ 保留 URI/Host 端口和同源头，API 失败不回退 HTML。流代理关闭缓冲、缓存、错误拦截与重试；SPA 深链接回退 index，缺静态资源返回 404，私有文件拒绝下载。模板渲染成功不代表 nginx -t、systemd 启动或真实流式行为已验证，目标环境验收在 DEP-003/004 完成。

## Sources

- [Ansible 安装](https://docs.ansible.com/projects/ansible/latest/installation_guide/intro_installation.html)、[支持矩阵](https://docs.ansible.com/projects/ansible-core/devel/reference_appendices/release_and_maintenance.html)、[PyPI 固定版本](https://pypi.org/project/ansible-core/2.21.5/)
- [Ansible SSH 认证机制](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/ssh_connection.html)、[检查模式的边界](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_checkmode.html)
- [Nginx 代理语义](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)、[systemd 外置环境](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html#EnvironmentFile=)
- [psutil 进程树 API](https://psutil.readthedocs.io/en/latest/)、[固定版本](https://pypi.org/project/psutil/7.2.2/)
- [OpenSSL verify 与 IP 校验](https://docs.openssl.org/3.0/man1/openssl-verify/)
