# Proposal

## Why

GEN-001～008 规划了模板生成与产品回归，但 Vite dev/preview 通过仍不能证明交付产物能够经真实静态服务器和反向代理独立运行。`GEN-009` 补齐本机构建、部署、代理和持久化验收，为 GEN-010 的真实模型演示提供已核验的运行入口。

## What Changes

- 新增计划入口 `pnpm release:build`，从隔离源副本构建一次，生成前端静态文件、独立后端生产依赖、共享契约及模板资产和内容清单；复用固定 pnpm 的 deploy，不手写依赖复制器。
- 复用 README 已选用的 Nginx，提供非特权 loopback 本地配置与实际服务器合并指引；明确 SPA/API/资源路由、同源会话、SSE 缓冲和断线规则，不以 Vite preview 替代部署验收。
- 新增计划入口 `pnpm smoke:deployment --release <path>`，复制并搬迁指定产物，在不依赖源码、开发依赖和真实模型凭据的目录运行；先验收真实生产入口，再以测试专用 SDK 传输完成生成与代理专项。
- 验证模板预览、项目创建与重开、会话归属、真实编译/交互、候选采用、SSE 首帧/心跳/取消/断线，以及停启后的数据和任务恢复；业务断言复用 GEN-007/008 的辅助。
- 持久目录与版本产物分离，提供停机备份、兼容产物切换与失败后重新启用原产物的操作步骤；不自动降级数据库或覆盖现有服务。
- 复用 GEN-008 的输入身份、所属进程清理及脱敏报告，单独记录本地部署、测试模型传输、真实模型和公网 HTTPS 的验证状态。
- 本轮只生成规划。GEN-001～008 尚待实施；当前本机未发现 Nginx，实际服务器的系统、域名、TLS 和进程管理信息也未核验，均不能写成已部署。

## Capabilities

### New Capabilities

无。本变更提供构建发布工具、配置、操作文档和工程验收，不新增产品能力；设置 `skip_specs: true`，不创建产品 spec。

### Modified Capabilities

无。沿用 GEN-003～007 的 HTTP、会话、生成、持久化和候选规则，不增加部署 API、生产假模型开关或新的代理信任策略。

## Impact

- 工程文件：根 package scripts、具体 release/deployment 脚本与 Node 控制测试、Nginx 模板；复用 GEN-008 的隔离/报告/进程辅助及现有 Chrome/playwright-core。
- 发布内容：backend 和共享契约包的 `files` 白名单、生产运行依赖及构建模板资产；SQLite 原生绑定在目标平台安装和实测，不跨操作系统复制 node_modules。
- 环境：本地已安装的 Nginx、项目固定 Node/pnpm 和外部 Sandpack 网络；不新增 Docker、云服务、常驻部署管理器或默认 CI 部署。
- 文档：README 维护最短运行步骤，Lifecycle 维护产物起停/持久目录/切换，Verification 维护覆盖和证据，Monorepo 维护产物边界。远端系统配置、发布与 GEN-010 的付费真实调用不包含在本轮规划实施动作中。
