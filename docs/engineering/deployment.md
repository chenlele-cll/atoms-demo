# Deployment

本文件维护 `deploy.sh` 的操作方法与目标要求。开发起停继续使用 [Lifecycle](./lifecycle.md)；发布版本与更新规则统一由 [releaseId 规则](./lifecycle.md#deployment-release-identity) 维护。

## Current scope

`DEP-003` 已接入实际产物校验、目标缓存/构建、Ansible 传输、私有配置、互斥激活、冷备份、健康与兼容恢复。已有 Nginx 提供前端和同源 `/api`，systemd 管理 loopback Fastify，SQLite/配置放在包外。复用 GEN-009 生产者、清单与源码选择，没有第二种 release.json。

控制端、隔离事务和本机真实 Node/Nginx/HTTPS/SQLite 验证不代表 Ubuntu/systemd、公网访问或服务器更新已验收。目标场景仍由 [DEP-004](../../openspec/changes/dep-004-deployment-acceptance/tasks.md) 跟踪；本轮没有自动上线或新建真实 SSH 连接。

## Local tools

控制端需 `.nvmrc` 的精确 Node、`package.json` 的 pnpm、项目依赖、Git、tar、Python 3.12～3.14；目标 Python 为 3.9～3.14。固定 Ansible Core/psutil 见 [requirements.txt](../../deploy/requirements.txt)，使用 builtin 模块和原生 SSH，无常驻 Agent、第三方 collection 或新增依赖。

```sh
./deploy.sh bootstrap
./deploy.sh plan --json
./deploy.sh validate
./deploy.sh test
```

bootstrap 只显式准备忽略的 `.tools/deploy`，已匹配时不联网或升级，缺系统前提直接失败。validate 离线检查五个 playbook 语法与模板渲染。test 默认不连接真实服务器或模型；真实进程专项见 [Verification](./verification.md#deployment-framework)。

plan 从实际 apply.yml/integrations.yml 生成阶段和接点状态；implementationReady/canApply 只表示实现可分派，targetVerified/deploymentVerified 始终 false。无参数不读私有配置或产物；显式 `plan --release /absolute/linux-package --json` 会离线完整校验包，仍不连接服务器。

## Private configuration

```sh
# 已有私有文件时保留，不重复复制。
cp server.example server.local.yml
chmod 600 server.local.yml
```

在本地编辑 [server.example](../../server.example) 对应字段。私有 inventory 必须是当前用户拥有、恰为 0600 的普通 .yml/.yaml，只接受 all.hosts.atoms 一个 IPv4 主机，密码/私钥二选一。密码是 YAML 字面值，单引号内反斜杠也是值的一部分；不 source、不放命令参数。拒绝重复键、模板表达式、控制字符及任意连接/插件/sudo 参数，仓库内私有文件必须被 Git 忽略。

可覆盖 HTTPS/后端端口、Node/pnpm/Nginx 绝对路径、证书/私钥和独立站点路径 atoms_nginx_site_path；字段见示例。端口互异，路径无空白/模板/父目录段。根固定 /srv/atoms，服务固定 atoms-backend.service，不用参数接管其他实例。

可选模型设置单独放私有补丁：

```sh
cp deploy.env.example.yml deploy.env.local.yml
chmod 600 deploy.env.local.yml
# 本地填写需要修改的设置；未列出的既有设置保留。
./deploy.sh apply --env-file deploy.env.local.yml
```

补丁只接受 OPENAI_API_KEY、OPENAI_BASE_URL、MODEL_ID、MODEL_TIMEOUT_MS、MODEL_MAX_OUTPUT_TOKENS 的 YAML 字符串，未知/重复键拒绝。通过原样私有 JSON 文件传输，不作为 Ansible 模板变量，不执行 `$` 或 `{{...}}`。同样要求 owner/0600/普通文件和仓库内 Git 忽略。公开结果不含凭据、私有指纹、完整环境或原始工具输出。

目标 backend.env 保留未知键和既有模型设置；受管 HOST/PORT/DATABASE_PATH/NODE_ENV/APP_ORIGINS 由部署设置。支持普通单行值、单引号字面值和生成的 JSON 双引号值；拒绝复杂续行、重复键、含糊转义，不执行 shell source。更换 DATABASE_PATH 必须先专门迁移，本入口拒绝把旧库换成空库。

## Target prerequisites

目标为 Ubuntu + systemd，SSH 用户有非交互 sudo；已有 active Nginx 且 nginx -t 通过，主配置包含选定站点目录和 MIME 映射。只增加受管站点，不替换 nginx.conf，不删除其他站点或杀占用者。

- 系统级 Node 精确匹配 .nvmrc，root 所有且不可被组/其他用户改写；ProtectHome 下不能用 /home 或 /root 中的 NVM Node。
- 默认构建缓存未命中时，SSH 用户需要 Git、精确 pnpm、下载源和原生依赖安装前提。先 frozen pnpm fetch，再调用原生产者隔离 offline install/build；构建不以 root 运行。显式包/缓存包不重建，不隐式安装系统工具。
- IP 访问也用 HTTPS；需覆盖 IP、系统信任且至少一天有效的证书和可读私钥，支持常见 live 证书软链接。不自动签发/续期、降级 HTTP 或关闭 TLS 校验。
- 默认外部 8443、后端 3001，首次端口空闲；更新核对监听 PID 属于受管后端或 Nginx，不能凭 HTTP 响应推断归属。
- 既有根/current/unit/站点需有本部署的归属记录/标记。未知目录、配置、drop-in 或监听者拒绝，不自动采用人工旧部署。

SSH 严格验证已有 known_hosts；先正常 SSH 人工核对指纹。Ansible 用官方 SSH_ASKPASS，无自动重试、复用连接、关闭校验或外部 ANSIBLE_* 覆盖。

## Commands

```sh
./deploy.sh check
./deploy.sh status --json
# 冻结公开源快照，查目标有效缓存，未命中才在 Ubuntu 构建。
./deploy.sh apply --json
# 消费 Linux、相同架构/精确 Node/ABI 构建的完整包。
./deploy.sh apply --release /absolute/linux-package --json
# 选择目标已保留的包，也用于兼容旧版本回退；UUID 仅示例。
./deploy.sh apply --release-id 00000000-0000-4000-8000-000000000001 --json
./deploy.sh status --inventory /absolute/private/server.yml --json
```

release/release-id 互斥。Mac 包连接前拒绝；目标再次校验 OS/架构/ABI、每个字节/模式/内部链接、模板/共享契约和真实 SQLite 原生读写。缺包、篡改、同 ID 不同内容或源快照变化失败。默认快照复用 GEN-009 白名单，排除 .env/inventory/密钥/DB/.git/输出/缓存；并行修改导致不一致则失败重试，不移动其他改动。

check 只读诊断前提，不证明上线。status 读取受管 current/成功记录，实际检查后端、HTTPS、静态页、JSON API 404。healthy/deploymentVerified 仅代表当次有限健康，不含浏览器、SSE、数据基线、公网客户端或完整 DEP-004；缺成功记录或未完成事务明确显示不健康/需恢复。

## Transaction and recovery

Ansible 原生 import_tasks/block/rescue/always 管预检、私有暂存、传输/构建、模板和清理。目标 Python helper 负责跨阶段内核 flock 和原子文件/服务操作；无第三方远端依赖、常驻程序或测试模式入口。

| 情况 | 行为 |
| --- | --- |
| 同包/同配置且真实健康 | no-op；不重建、生成 UUID、切换或重启，重新确认健康 |
| 新包 | 校验/发布不可变目录；停所属后端、冷备份、原子切 current、启动验收，保留旧包 |
| 仅后端环境/unit 变化 | 保持 releaseId，仅重启后端，保留模型设置/数据库 |
| 仅代理/证书变化 | nginx -t 后只 reload 代理，不重启后端 |
| 同包服务不健康 | 仅修复受影响服务，仍须验收 |
| 并发 | 控制端/目标非阻塞进程锁；竞争者非零，不删除锁目录解锁 |
| 失败且旧包兼容 | 停本次新后端，恢复代码/配置，原库重开验收；命令仍非零 |
| 新库 schema 超旧包能力 | 拒绝自动回退，保留新指向/配置、停止新后端，成功记录不前移；下次用兼容新包前向修复 |

激活前确认受管站点被 Nginx 实际 include，坏配置在停健康后端前拒绝。健康通过才原子写成功记录，每事务保留阶段/恢复日志。停服冷备份含 DB 和存在的 WAL/SHM，执行 quick_check；任何失败均不恢复旧备份覆盖当前库、不降级 schema、不清数据。

| 路径 | 内容 |
| --- | --- |
| /srv/atoms/.atoms-deployment.json | 根目录/机器归属标记 |
| /srv/atoms/releases/&lt;releaseId&gt; | root 管理的不可变完整包 |
| /srv/atoms/current | 原子选择的包；是否成功另看成功记录 |
| /srv/atoms/shared/data | atoms 所有、0700，持久库与应用锁 |
| /srv/atoms/shared/config/backend.env | root:root 0600，外置运行设置 |
| /srv/atoms/shared/config/deployment.json | 最近一次健康成功记录，0600 |
| /srv/atoms/shared/config/operation.json | 当前/最近事务检查点，0600 |
| /srv/atoms/backups/&lt;runId&gt; | 0700，配置快照/冷备份；不自动删除 |

systemd 使用非 root atoms、只读应用、仅数据目录可写、外置环境与 journal，禁用 NODE_OPTIONS/NODE_PATH。前端只暴露 current/frontend。API 保留 URI/Host/同源头，关闭缓存/缓冲/重试/错误拦截，API 错误不回退 HTML。

## Failure evidence and limits

控制端证据在忽略的 .runtime/deploy/runs/&lt;runId&gt;（0700），含私有请求/补丁、Ansible 日志及白名单结果。不要公开整个目录；stdout JSON 只含有限状态、UUID/摘要、runId 和证据相对路径，错误用固定代码。目标只清理本命令临时目录，包/备份/数据保留。

check 预算 90 秒、bootstrap 300 秒、test 600 秒；apply/status 控制端总预算 2100 秒，远端构建/事务各有界。取消/超时只清理所属控制进程。网络断开或强杀不能承诺 rescue/always 已运行；异步事务可能继续，应先 status 再重试。内核自动释放进程锁；下次 apply 核验 journal/current/成功记录/schema 再修复，不凭残留锁文件或 releaseId 猜成功。

## Sources

- [Ansible builtin SSH](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/ssh_connection.html)、[block/rescue 的边界](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_blocks.html)
- [Nginx 代理](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)、[TLS 模块](https://nginx.org/en/docs/http/ngx_http_ssl_module.html)
- [systemd EnvironmentFile](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html#EnvironmentFile=)、[OpenSSL IP 校验](https://docs.openssl.org/3.0/man1/openssl-verify/)
