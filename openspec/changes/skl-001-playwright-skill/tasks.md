# Tasks

任务：`SKL-001`。编号为本变更的局部子任务，复选框仅在实际完成后更新。

## 1. Upstream skill and project entry

- [x] 1.1 SKL-001 使用官方安装器安装固定提交的 Playwright Skill；逐文件核对 Git blob、许可证、NOTICE 及配套资源。
- [x] 1.2 SKL-001 固定根 CLI 开发依赖、调用入口、Chrome 配置和忽略规则；执行 frozen install 与实际 wrapper 版本、帮助和产物路径检查。
- [x] 1.3 SKL-001 更新 Agent、README、技能来源和验证文档；检查相对链接、触发边界及同名全局技能限制。

## 2. Integration verification

- [x] 2.1 SKL-001 通过项目 CLI 的具名会话验证快照、连接检查点击、桌面与窄屏截图、后端离线反馈；关闭所属浏览器和服务并确认端口释放。
- [x] 2.2 SKL-001 运行 pnpm check、pnpm smoke（含生产构建与浏览器回归）以及 OpenSpec 严格校验，记录结果与未验证范围。
- [x] 2.3 SKL-001 对照入口快照确认其他任务文件、Git HEAD/index 和私有材料未变，本地产物均被忽略，记录交付证据。

## Verification results

- 官方安装器安装的九个文件与固定提交的 Git blob 逐一匹配，wrapper 执行权限与上游一致，保留 Apache-2.0 与 NOTICE。
- frozen install 通过；项目 wrapper 在禁用 npm 网络时返回 `0.1.22`。默认会话实际启动系统 Chrome 的无头进程；加 `--headed` 的应用会话也成功。
- CLI 实际执行快照、按快照编号点击健康检查、1280×800 和 375×812 截图及请求记录；目视检查两种尺寸内容完整。停止所属后端后，页面显示 HTTP 502，按钮恢复可用。控制台记录到现有 favicon 404 和该离线请求的 502，未将其报告为控制台零错误。
- `pnpm check` 通过，后端六个测试通过；`pnpm smoke` 内的 `pnpm build` 与完整浏览器回归通过，覆盖 320/375/768/1280px、错误响应、后端离线及生产后端和本地 preview；无未捕获页面运行错误。
- OpenSpec 严格校验通过；文档链接、产物忽略、其他既有文件、Git HEAD/index 及私有参考材料保护检查通过。浏览器会话已关闭，应用端口已释放。
- OpenCode 本次发现 `.agents/skills/playwright/SKILL.md`；保留按路径读取入口，不声称跨宿主自动发现、模型自动选择或新机器安装已验证。pnpm 提示 CLI 包自带技能待批准，未另装同职责技能，本仓库使用上述独立安装的 OpenAI Skill。
- 本地证据位于忽略的 `test-results/skl-001/` 与 `output/playwright/`；固定回归截图仍在 `test-results/smoke/`。未验证生成、持久化、生成应用预览、manager 或线上部署。

## Workflow follow-up

- 保留变更供审阅；归档、提交、推送或 PR 按后续明确请求执行。
