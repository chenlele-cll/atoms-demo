# Tasks

任务：`CI-001`，以下为本变更局部编号。

## 1. GitHub Actions adoption

- [x] 1.1 CI-001 核对官方 Actions、固定提交及 runner 前提，接入日常 Ubuntu 与手动 macOS 生命周期 job；用 actionlint 和上游输入元数据验证触发、权限、缓存、超时、并发与证据上传范围。
- [x] 1.2 CI-001 更新 README、Agent、文档索引、Monorepo 和验证规范，说明实际覆盖、运行前提、固定来源、手动入口与首次远端验证边界；核对英文路径及链接。
- [x] 1.3 CI-001 在本地执行日常 job 对应的 frozen install、check、infra、构建/浏览器 smoke 和 OpenSpec 严格校验，记录源码与结果；完整生命周期未变则核对并复用 VER-001 的实测证据，明确远端未运行。

## 2. Handoff verification

- [x] 2.1 CI-001 复查工作流与工件一致性、差异、忽略范围、私有资料、依赖/lockfile、运行清理和 Git HEAD/index，保留并行工作并交付结果；不提交、推送、触发远端运行、修改仓库设置或归档。

## Workflow follow-up

- 配置按后续授权发布后，核对首次 quality 云端运行；按需手动运行 full_lifecycle，取得真实 runner 证据。
- Linux 全生命周期、必需检查与分支保护随实际结果和明确任务接入，不在本步预设完成。

## Verification results

- `.github/workflows/ci.yml` 已落盘：PR、main push、手动触发执行 Ubuntu 日常检查，full_lifecycle=true 时另启 macOS arm64 完整回归；没有新增依赖、测试框架、工作区脚本或 Skill。
- 四个官方 Actions 标签已解析到完整提交 SHA，工作流八处引用及输入均与固定上游 action.yml 核对。只读权限、独立缓存、取消分组、超时、条件 job 与限定证据上传由工作流直接表达。
- 固定 actionlint 1.7.12 的官方发布归档 SHA-256 与实际版本已核对，工具仅位于忽略的 .tools；最终 YAML 与表达式校验退出 0。元数据辅助校验已在严格失败门禁下重新通过后才完成任务勾选。
- 本机 Node 22.22.2 / pnpm 12.11.2 对应命令全部退出 0，合计 9.211 秒：frozen install（复用现有依赖）、check（含后端六项）、infra 四项、两应用构建与真实浏览器 smoke，以及执行时十项 OpenSpec 全仓严格校验。
- 完整生命周期运行源码逐项匹配 VER-001 的 hash，因此复用其 13 项 manager 回归和完整验收证据，没有再次重复耗时场景；不据此声称 hosted macOS 或 Linux 已验证。实际云端安装、缓存与 job 行为仍待配置发布后的首次运行。
- 99 个本地链接及适用标题锚点、差异空白检查通过；应用端口 3001/5173/4173 已释放，无 manager 记录或操作锁。依赖、lockfile、版本 pin、环境模板、技能及私有参考资料保持原样。
- 本地原始证据在忽略的 `test-results/ci-001/`。保留并行新增的 GEN-003 工件，未修改其他任务内容；本步未暂存、提交、推送、触发远端工作流、修改分支保护或归档，Git HEAD/index 保持入口状态。
