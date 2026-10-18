# Why

用户指定执行 `OPS-003`。已有 manager 起停核心仍要求手动安装工具，缺少统一环境诊断和按服务读取日志的入口。

# What Changes

- 提供无需已有 node_modules 的 bootstrap / doctor，使用官方固定安装器和 frozen install。
- 补齐按服务的日志快照、在线跟随和停止后的本地日志读取，复用 Process Compose。
- 记录已实现入口、环境前提、失败语义与来源，增加真实行为验证。

# Capabilities

## New Capabilities

无产品契约变化，使用 `skip_specs: true`。

## Modified Capabilities

无。

# Impact

仅修改开发工具、测试、官方安装器副本和工程导航。不修改应用源码或环境文件，不引入基础设施、生产部署或新 npm 依赖，不提交或推送。
