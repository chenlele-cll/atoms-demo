# Proposal

## Why

`DEP-002` 将已确认的单机部署方案落为可验证框架，避免每次更新重新拼装 SSH 命令。DEP-001 的自动认证仍受阻，不影响本地入口、模板及失败边界的交付。

## What Changes

- 增加 deploy.sh 和固定版本 Ansible Core，提供显式本地 bootstrap、离线 validate/test、只读 check/status；apply 在 DEP-003 接入真实发布前明确失败。
- 统一原生 YAML inventory、秘密隔离、Nginx IP HTTPS、systemd 后端服务及外置配置/持久目录模板。
- 接入行为验证、使用文档及任务证据；发布包复用 GEN-009，releaseId 规则沿用 Lifecycle。

## Capabilities

### New Capabilities

无产品能力变化；工程工具使用 skip_specs。

### Modified Capabilities

无。

## Impact

新增部署工具与模板，不修改应用 HTTP 契约、manager 或默认 CI。不安装或修改远端软件、文件、站点、认证或服务，不执行发布、模型调用、数据库操作、提交、推送或归档。DEP-003 负责首次发布/更新，DEP-004 负责真实幂等与故障验收。
