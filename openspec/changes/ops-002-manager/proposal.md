# Why

用户指定执行 `OPS-002`：在已有 Process Compose 原生配置上提供一致的 start、stop、restart、status，补齐重复与并发调用、整体就绪截止时间和失败回滚。

# What Changes

- 根 `manager.sh` 提供入口，Node 辅助脚本调用官方 Process Compose，不自建进程守护器。
- 复用 `proper-lockfile` 串行修改操作；按仓库隔离控制 socket 与实例状态，验证进程和接口归属。
- 真正就绪后 start 才成功，超时或中断清理新实例；重复健康 start 和重复 stop 成功，restart 最终保留一组实例。
- 记录统一状态、退出码、运行文件和恢复方式，并实测真实进程。

# Capabilities

## New Capabilities

无产品契约变化，使用 `skip_specs: true`。

## Modified Capabilities

无。

# Impact

开发脚本、一个具体用于并发互斥的根开发依赖及工程文档。沿用既有应用、端口和工具版本，不实施 `OPS-003` 的 bootstrap/doctor/logs、基础设施或生产运行。
