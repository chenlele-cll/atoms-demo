# Implementation Evidence

2026-10-18 实施 REV-004。所有模型请求均为实际 SDK 连接 loopback 受控上游，source=fixture、realModelCalls=0；数据库为测试自有临时 SQLite。未执行真实付费模型、部署、归档或本任务提交。

## Evidence Matrix

| 断言 | 实际证据 |
| --- | --- |
| 血缘自身与祖先、无关历史排除 | `backend/test/restored-version-continuation.test.ts` 实际首个 SDK input；T/A/B/C、非成功/无关联/跨项目及错误 base/result 哨兵；恢复此前未采用成功候选仍含自身历史 |
| 预算与需求一次 | 同文件验证过滤先于 LIMIT、十条、UTF-8 16 KiB 精确/超一字节、不补第十一条、受理前省略数及 256 KiB 累计限制 |
| 损坏有限失败 | 缺失、跨项目 parent、环、非法模板/终点/序号，2000 节点长链；存储及生成结果 DATA_CORRUPT，零 SDK/无受理部分写入 |
| 冻结工具与不可变分支 | 同文件实际 list/read/submit、A 独特正文进入后续请求、D.parent=A/max+1/unverified/current=A；完整旧版本/run/消息前后及 SQLite 重开比较 |
| 失败不改 current | 拒绝/截断/文件校验/取消/超时/基线变化/候选/摘要/成功状态/终态故障及事务末截止时间；第二连接在模型等待时可写 |
| 原请求与费用边界 | 恢复后 B 原请求先于基线/config 重放、原候选及未知指标 null、零请求/消息/版本增长；改 prompt/base 冲突，已知失败仅明确新 ID 可再受理 |
| 恢复与生成准入 | 复用并重跑 `version-restoration-network.test.ts`：真实 accepted/gate/取消 Map、恢复先完成旧 base 拒绝、running unconfirmed；浏览器第二标签旧 B 请求拒绝且零新增 SDK 请求 |
| 恢复零自动生成及未知确认 | `frontend/test/restored-continuation.test.ts` 11 项；workspace dev/preview 实际恢复响应丢失、首次 GET 失败、手动只读确认，无第二次恢复 POST/生成 |
| 预览与采用重开 | workspace dev/preview 实际恢复 A→明确生成→Sandpack 报价→明确采用→所属后端重启刷新；3 个旧版本、6 条旧消息不变；新增候选 parent=A、sequence=3/旧 max=2 |
| 断流、未知采用 | 原 workspace 丢末帧只查询原 requestId；candidate 专项丢响应、同载荷手动重试、CAS 和未知查询；客户端未知恢复/生成不分配新 ID |

## Commands And Reports

命令均从仓库根执行，PATH 前置 `/Users/cll/.nvm/versions/node/v22.22.2/bin`。

| 命令 | 实际结果 |
| --- | --- |
| `pnpm --filter @atoms/backend test` | 内核阶段 274/274；最后完整 check 中 276/276，含同期并行新增测试 |
| `pnpm --filter @atoms/frontend test` | 最后 79/79；REV-004 新增 11 项 |
| `pnpm check` | 最终退出 0，包含 lint/types、release/verification/contract 准备及两应用测试；早期并行前端类型未完成曾阻塞，未作为通过 |
| `pnpm build` | 退出 0；已随 smoke 多次构建。Vite 原有大 chunk 提示保留 |
| `pnpm smoke` | 等待并行 history-smoke 释放端口后退出 0；此前三次端口预检拒绝保留为未运行浏览器，不停止占用者 |
| `pnpm smoke:workspace` | 退出 0，30/30；`test-results/workspace/fda02a02-86df-4efd-8b26-f20cdef5d994/report.json` |
| `pnpm smoke:generation-stream` | 退出 0，8/8；`test-results/generation-stream/2ca5d791-e7d0-4c46-862f-cfbef036136b/report.json` |
| `pnpm smoke:candidate` | 退出 0，21/21；`test-results/candidate-review/fc1b3bfe-44af-49c3-8f97-403cebf36249/report.json` |
| `pnpm openspec validate rev-004-restored-version-continuation --strict --no-interactive` | 退出 0，scoped 严格校验通过；status 工件齐备 |
| `git diff --check` | 退出 0 |

上述三个浏览器专项串行运行且清理通过。workspace 初次 28 通过/2 失败报告保留在 `test-results/workspace/fe32abf4-bc24-422d-b81c-9859f61b3adb/report.json`：手动查询的滚动后点击时序失败，脚本改为先滚入视口等待两帧并移除 reload 兜底后，dev/preview 均通过。初步归因应用故障已纠正。candidate 曾被工具 120 秒时限取消，最终完整重跑通过。端口占用的启动拒绝不停止占用者，也不计成功。

## REV-005 Handoff

受控证据证明上下文、传输、存储和实际预览交互边界；不能证明真实供应商对恢复后需求的理解与生成质量。REV-005 仍需独立真实模型验收：从已明确恢复的版本续写、读取该快照、排除未来需求、检验业务交互、明确采用并重开；未知用量保持 null，不自动补跑或重计费。本次不修改 REV-005 的完成状态。
