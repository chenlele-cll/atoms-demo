# Proposal

## Why

`DEP-001` 按用户授权只读预检已提供的 Ubuntu 服务器，为后续幂等部署取得实际环境依据。连接配置已保存在本地私有 inventory，尚无登录或运行事实。

## What Changes

- 验证私有配置、SSH 连接与认证，记录主机公钥指纹和检查范围。
- 只读检查系统/架构、sudo 能力、CPU/内存/磁盘、工具链、Nginx 服务与相关端口，核对 IP HTTPS 前提。
- 形成脱敏结论与后续待处理项，原始环境证据仅留在忽略且权限受限的本地目录。

## Capabilities

### New Capabilities

无；运维预检与记录，使用 skip_specs。

### Modified Capabilities

无产品契约变化。

## Impact

仅新增本预检工件与本地证据。不安装或升级软件，不修改服务器文件/站点/服务，不重启、部署、调用模型或改数据库；不提交、推送或归档。常规 SSH/系统命令的访问审计日志不等于部署修改。
