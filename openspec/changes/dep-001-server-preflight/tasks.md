# Tasks

任务：`DEP-001`，以下为本变更局部编号。

## 1. Read-only server preflight

- [x] 1.1 DEP-001 验证私有配置、SSH 连接及主机指纹记录，确认认证使用字面密码且无秘密输出；连接异常时如实分类，不尝试密码变体。
- [ ] 1.2 DEP-001 采集系统/资源、非交互 sudo、Node/pnpm、Nginx 状态与相关监听端口，并从本机检查相关公开端口/HTTPS；记录通过、缺失与未验证项，不进行安装或部署修改。

## 2. Evidence and handoff

- [x] 2.1 DEP-001 汇总私有环境报告和脱敏后续任务，核对 helper 清理、配置/秘密隔离、Git 与其他工作保留，执行 OpenSpec 严格校验与差异检查；不提交、推送或归档。

## Current blocker

- SSH 已匹配本机已有主机密钥；首次 ASKPASS、用户要求的原生终端复核、按手动成功反馈追加的默认配置复现均被服务器拒绝。字面值与原生终端输入自检通过，没有尝试密码变体。
- 用户反馈同一命令手动登录成功，本机也存在同一目标的 SSH 连接；自动路径失败的根因尚不明确。原有会话保持不动，未绕过工具的终端访问限制。
- 用户已提供日志：同账号曾 Accepted password，自动尝试对应时段存在 PAM authentication failure / Failed password；没有额外根因说明，自动探针仍未认证。
- 环境采集未运行，1.2 保持未完成；详见 [preflight-report.md](./preflight-report.md)。
