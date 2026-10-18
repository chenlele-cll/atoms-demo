# Design

## Context

范围见 [proposal.md](./proposal.md)。现有 server.example 为 Ansible 原生 YAML；server.local.yml 是 Git 忽略、0600 的私有配置。用户确认 Ubuntu/已有 Nginx/无域名，自动 SSH 尚未认证，不能假定版本、sudo、证书或端口可用。

## Goals / Non-Goals

**Goals:** 提供渐进式部署入口、真实只读检查、可渲染生产模板及不泄密的失败路径。

**Non-Goals:** 本步不发布应用、不实现包构建/激活/回滚、不签发证书或变更远端服务，不代替 GEN-009、DEP-003、DEP-004。

## Decisions

- 采用 PyPI 固定 ansible-core 2.21.5 和自带 builtin 模块/SSH_ASKPASS，在忽略的 .tools/deploy 虚拟环境显式安装。控制端 Python 3.12～3.14；目标端 Python 3.9～3.14。使用官方实现，避免重写认证传密、文件收敛和服务管理器；不引入第三方 role/collection 或远端 Agent。
- 固定 psutil 7.2.2，仅解决取消时 Ansible 独立会话 SSH 进程不能靠控制端进程组完全清理的问题；按本次父子关系枚举并终止，不扫描端口或操作既有用户会话。行为测试保留独立无关进程作为保护哨兵。
- deploy.sh 只定位仓库和 Python 入口；小型控制端适配负责命令、私有配置权限/字面值、单主机范围和固定工具版本。无参数显示帮助；bootstrap 仅本机安装且重复不升级；validate/test 不读取真实 inventory 或连接服务器；check/status 显式连接。apply 在任何读取配置或连接前非零，直接调用其 playbook 也失败。
- 只支持 all.hosts.atoms 一个 IPv4 目标；认证字段沿用 Ansible。公开默认项维护部署根、非 root 服务用户、Node/pnpm/Nginx 绝对路径、HTTPS/后端端口与证书位置。允许的覆盖值在控制端校验，拒绝 shell/模板注入及任意 Ansible 连接参数；真实 inventory 不改写。SSH 主机检查严格启用、无重试、单次密码提示、无连接复用；异常由 no_log 任务保护，不启用 verbose/diff/debug。
- check/status 复用 setup、command、stat 查询事实；不运行安装、file/template/service 等收敛操作。check 对 Ubuntu/systemd/sudo/精确工具版本/Nginx 测试/证书/端口前提如实给出缺项并非零；status 只报告 current、后端和 Nginx 状态，运行不等于健康或已验收。Ansible 自身的临时模块传输可能产生受控临时文件，不代表服务器零文件写入，受管部署配置和数据保持不动。
- 生产布局固定为 /srv/atoms/{releases/<releaseId>,current,shared/data,shared/config,backups}；GEN-009 发布包 frontend/ 为静态根，backend/dist/server.js 为入口。声明目录及权限作为 DEP-003 输入，本步不创建远端目录。systemd 仅后端使用 atoms 用户，工作目录与配置/数据外置；releaseId 与运行配置指纹沿用 Lifecycle。
- Nginx 模板只新增独立站点，保留其他站点；IPv4 HTTPS 默认 8443 尚非已确认端口。API 保留 /api URI、含端口 Host、同源 Cookie/Origin，关闭流缓冲/重试/缓存并设置有界超时；SPA 与静态资源分路由，私有文件不可下载。证书路径必须在后续部署前实测，不默认生成不受信证书或假定 ACME 成功。
- 模板使用 Ansible/Jinja 原生渲染，离线验证与行为测试覆盖真实 Ansible 语法/渲染、秘密/权限/参数边界、未实现 apply、失败连接及重复命令。目标 Nginx/systemd 和公网行为仍须在 DEP-003/004 验证。

## Risks / Trade-offs

- 自动认证受阻 → 保留 DEP-001 状态，check/status 必须非零而不是模拟服务器结果。
- 目标缺 Python、工具或证书，端口可能已占用 → 报缺项，不自动安装、改站点或杀占用者。
- 本机缺 Nginx/systemd → 可验证模板渲染，不声称目标语法/启动/流式代理已通过。
- 单机版本切换需要停机且数据库可能不向后兼容 → DEP-003 采用冷备份及兼容性检查，不能自动覆盖当前库。

## Migration Plan

本步新增本地框架，不触发远端迁移。后续 DEP-003 在认证恢复、端口/证书确认和 GEN-009 产物可用后接入 builtin 文件/模板/systemd 收敛及健康检查；DEP-004 验证重复部署、代码更新、配置更新和失败保留数据。撤回本框架不删除持久数据或用户私有配置。
