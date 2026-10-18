# Design

## Context

本变更先按用户要求完成可离线检查的部署框架，保留缺失接点；该阶段的任务和证据仍在 tasks.md/framework 记录。用户现要求依赖实现后补全第一批能力，GEN-009 生产者/产物校验已存在，因此恢复真实 apply 的全部接点。本轮只实现并隔离验证，不自动上线；真实 Ubuntu/systemd/公网结果继续归 DEP-004。

## Goals / Non-Goals

**Goals:** 复用固定 Ansible 和 GEN-009，提供首次安装、缓存复用、幂等更新、配置保留、锁内切换、冷备份、健康和兼容恢复，给出可复核本机证据。

**Non-Goals:** 不另造清单/构建器，不修改产品 HTTP/模型逻辑，不自动安装系统软件或证书，不改 SSH 认证/防火墙，不覆盖旧库、不替用户执行真实发布或 Git 写操作。

## Decisions

- 控制端 deploy.sh/scripts/deploy.py 管参数/固定工具/私有 inventory，controller.py 形成私有请求和 Ansible 调用。plan 从实际主流程和接点声明生成 implementationReady，不把声明当部署证明；直接 playbook 必须有控制端准备的请求，缺失时在连接前拒绝。
- Ansible 原生 import_tasks/block/rescue/always 与 builtin 模块负责预检、私有暂存、传输/提取、非 root 构建、模板和收尾，不增加 role/collection 或连接器。受管配置先在每次独立暂存目录渲染，不在锁外写入 live 文件。
- 产物 bridge 直接导入 GEN-009 validateRelease，源码快照直接调用 copyInputs/releaseInput；没有第二份清单实现。校验器的 SHA256/路径原语提为无依赖模块，接口不变，使目标不必从未验证包加载依赖。只运输该校验器、原语和小型部署 kit。
- 默认先冻结公开构建源，目标按 sourceDigest 寻找并重新校验完整包；没有匹配才以 SSH 用户 frozen fetch，并调用原 scripts/release.mjs 隔离 offline 构建。支持显式 Linux 包和保留 UUID，拒绝将 Mac 原生包上传 Ubuntu；目标复验精确 Node/pnpm/OS/架构/ABI、字节/链接/模式、运行可读权限和原生 SQLite 读写。
- 目标 Python 标准库 helper 是跨操作持有内核 flock 的事务边界，非第二个常驻部署系统。它在同一锁内管理 immutable publish、环境合并、配置/数据库快照、原子 current、服务、健康和成功元数据，避免 Ansible 每任务独立进程导致锁提前释放。控制端也持非阻塞锁；不删除锁目录模拟解锁。
- 归属要求固定 /srv/atoms 的机器/根标记、current 指向 releases、带根标记的 unit/站点，无 drop-in/其他 FragmentPath，监听 PID 属于本后端或 Nginx。未知归属拒绝，不杀进程、不替换全局 Nginx 配置。
- 生产已有 Ubuntu/systemd/Nginx、非交互 sudo、系统级精确 Node、可信 IP HTTPS 是前提；自动构建还需 Git/精确 pnpm/下载与原生构建前提。证书允许 live 软链接并检查 IP/信任/期限，不自动降级 HTTP 或安装工具。
- 私有模型补丁是 owner/0600、Git 忽略的 YAML 字符串映射，单独 copy 原样 JSON，避免 Ansible 对值进行 Jinja 求值。环境从普通文件解析/合并后生成 systemd EnvironmentFile，保留未知键和未指定模型值，受管字段固定；拒绝复杂续行、歧义转义、重复键和 DATABASE_PATH 变化，不 source。凭据/指纹仅留私有文件，不放 manifest/公开日志。
- 幂等 policy 继续只消费可信身份/私有配置指纹和实际健康。健康同包同配置不重建/切换/重启；后端与代理分别处理；代码更新保留旧包。证书续期按最近成功加载指纹触发 reload。发布目录不可覆盖，同 ID 不同内容失败。
- 激活前安装受管候选站点并 nginx -t/-T 验证实际 include，失败恢复配置且不停止健康后端。需重启时先停所属后端再冷备份 DB/WAL/SHM、quick_check，环境/unit 和 current 原子更新，再启动/reload 受影响服务。
- 健康需 PID/cwd 对应正确发布包、直接及严格 IP HTTPS 的 /api/health、JSON API 404，以及首页 bytes 匹配当前包；禁止跳转和 SPA 吞 API。只有通过后原子写 deployment.json。operation.json 保留准备/激活/完成/失败及恢复结果；stdout 只白名单投影固定代码、有限状态、UUID/摘要与证据路径。
- 失败先停新后端，比较现库 user_version 与旧包实际 migrations 能力；兼容才切回代码/配置、用原库重开验收。高 schema 不自动回退，保留新指向/配置、停止服务，成功记录不前移；后续兼容包可前向修复。绝不恢复旧备份覆盖当前库。
- 网络断开/强杀不能承诺 Ansible rescue/always 执行，目标异步事务可能继续。信号可处理时 helper 在持锁期间恢复；强杀后内核释放锁，下次核验 current/journal/最近成功及 schema，避免凭旧状态猜成功。只清理本次临时目录，保留包、备份和数据。

## Verification

控制端测试真实 Ansible 配置渲染/失败/认证脱敏和取消保护，新增分派/请求/源码隐私/原生包平台拒绝；事务单测用明确 OS 替身、真实生产者清单/文件/SQLite 覆盖更新、互斥、配置、备份、恢复、不兼容及前向修复。显式本机专项用两份实际 GEN-009 包、真实 Node/SQLite/Nginx TLS、生产模板和健康逻辑，只替换 Ubuntu 服务管理；测试 CA 仅在测试适配器注入，生产无该开关。真实目标 OS/权限/systemd/公网/SSE 仍须 DEP-004。

## Risks / Trade-offs

- 源变化/缺 offline 依赖或精确工具链会失败；不以修改 lockfile、搬 Mac 依赖或 root 构建绕过。
- 未知旧部署不自动接管，需要先专门审阅迁移；既有配置不会静默覆盖。
- 成功记录和实际指向可能因中断暂时不同，必须结合 journal/健康/schema 验证；数据库永远不随代码回退。
- 并行核心工作继续，保留现有未提交改动，不改应用实现/依赖声明/lockfile。本轮不创建分支、提交、推送或新建服务器连接。

## Migration Plan

先完成实现及本机隔离验收和文档，DEP-003 可记录代码接点完成；再在用户选择的专用真实目标确认 SSH/sudo、系统工具、IP 证书、服务/站点/端口归属和目标平台包后运行 DEP-004 全矩阵。不以本机成功提前勾选目标验收任务。
