# Tasks

任务：`OPS-003`，以下为本变更局部编号。

## 1. Developer commands

- [x] 1.1 OPS-003 接入官方固定安装器及 bootstrap；核对来源/许可证，在无 node_modules 的副本验证真实安装、重复执行及环境文件保护。
- [x] 1.2 OPS-003 实现 doctor 和 JSON 结果；验证停止/健康实例、缺失或错误版本、配置与端口错误，确认诊断不启动服务或泄露秘密。
- [x] 1.3 OPS-003 接入 logs 的服务/行数限制、在线跟随和停止后读取；用真实服务验证输出及取消跟随不停止应用。
- [x] 1.4 OPS-003 更新 README、生命周期、Agent 和验证导航；核对命令、前提、来源及后续 INF 边界。

## 2. Integration verification

- [x] 2.1 OPS-003 添加并执行聚焦行为测试，覆盖安装校验失败、失败清理及现有 manager 回归；运行 pnpm check、pnpm build 和 OpenSpec 严格校验，记录覆盖范围。
- [x] 2.2 OPS-003 核对任务范围、文档链接、Git HEAD/index、私有资料和本地产物忽略；停止验证实例并交付实际结果，不提交、推送或归档。

## Workflow follow-up

- 后续按既有计划推进 `INF-001` 空基础设施接口及 `VER-001` 综合验收。
- 归档与版本控制操作遵循后续明确请求。

## Verification results

- 官方安装器与 LICENSE 已逐文件核对固定提交的 Git blob，保持上游原样；使用明确的 `v1.122.0`，没有新建下载协议、Skill 或 npm 依赖。
- 干净、带空格和深路径的副本没有 node_modules/工具时，真实官方网络下载、校验和 frozen install 成功；重复 bootstrap 复用工具且不改变其 mtime，环境文件、声明与 lockfile 保留。
- 错误二进制版本和错误 pnpm/Node 版本被拒绝，原目录不被覆盖；受控下载替身触发 SHA-256 失败和中断，工具目录未安装、暂存目录及下载子进程已清理。
- doctor 在无依赖时能给出诊断；在停止/健康实例、配置错误、外部端口占用、无效环境路径及未知控制 socket 时给出对应结果。环境与管理认证值未出现在 JSON 诊断中，诊断不启动或停止应用。
- logs 按服务调用官方 CLI 并汇总输出，避免补充验证发现的原生多服务快照遗漏一路问题；回归显式覆盖 backend/frontend/all、行数限制、在线读取和停止后当前文件读取，以及取消多服务跟随不停止应用。非法服务/路径及非法行数被拒绝，停止实例的跟随明确失败。
- 最后一次当前代码回归实际执行 12 组场景、Node runner 共 13 项，全部通过且无跳过，包含原 manager 的并发、故障、陈旧锁、PID 与强制清理。曾有一轮定向命令与尚未结束的回归争用端口，被安全拒绝，之后已串行重跑通过。
- pnpm check、后端六个测试、pnpm build、shell/Node 语法、文档链接及 OpenSpec 严格校验通过。最后根目录 doctor 通过；验证实例、安装暂存目录、锁、socket 与监听端口已清理。
- 声明、lockfile、环境模板和私有参考资料未被本任务修改，本地证据保持忽略；本步未执行提交、推送或归档。并行工作修改了选型/产品文档并推进 Git 分支和提交，保留其现状并在范围报告中单独记录，不声称 HEAD/index 全程未变。
- 证据在 `test-results/ops-003/` 与 `test-results/manager/`。仅实测 macOS arm64；未验证 Linux/Windows、新机器完全离线安装、生产部署、基础设施或模型生成，也未重跑无 UI 改动的浏览器 smoke。
