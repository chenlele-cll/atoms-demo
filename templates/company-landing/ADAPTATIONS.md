# Company landing template

模板标识 `company-landing`，版本 `1`。来源为 [leoMirandaa/shadcn-landing-page](https://github.com/leoMirandaa/shadcn-landing-page/tree/ae3716dbce5c8a26815222bb743994b5717938f1)，固定提交 `ae3716dbce5c8a26815222bb743994b5717938f1`，保留原 [MIT LICENSE](./LICENSE)。这是已有模板的预览适配，不是模型生成成果。

## Source and selection

[manifest.json](./manifest.json) 记录所选 39 个上游文件的原始 Git blob SHA-1、SHA-256 和本地路径。引入时使用固定提交的 Git tree 逐文件比对下载内容；这些值描述适配前的上游文件，不能用于断言适配后文件没有变化。

保留 App、Hero/HeroCards、导航、服务/特点/统计、评价/团队、价格、FAQ、Footer、回到顶部及其实际使用的 shadcn/Radix 组件和五张 PNG。未引入上游开发应用、部署工具、锁文件、未使用的图标、Newsletter 或其 input 组件。新增的内嵌头像为本地 SVG 图形。

固定提交的 package-lock 与其 package.json 部分范围不一致，因此直接运行依赖采用 package.json 的版本下界精确固定（React/React DOM 均为 18.3.1），逐项核对 npm 发布元数据；具体值以 manifest 为准。运行依赖只属于隔离预览，不安装到宿主。Tailwind 3.4.4、PostCSS 8.4.38、Autoprefixer 10.4.19 和 tailwindcss-animate 1.0.7 是仓库准备依赖。

## Adaptations

- `@/` 改为可解析的相对导入；main 仅加载合并编译后的 styles.css，显式检查 root，保留 React 18 入口。Tailwind 配置改为 .cjs，由仓库准备脚本执行；保留上游样式与主题。
- 五张 PNG 和本地 SVG 在准备时转换为 data URI 虚拟模块，替换 GitHub/pravatar 远程头像，不依赖外部图片请求。未使用运行时 Tailwind CDN。
- 删除 Newsletter，不保留无服务的订阅表单或 `Subscribed!` 日志。套餐/CTA 改为真实的价格、FAQ、特点等页内导航，Footer 明确样例价格、团队和评价及未连接服务。
- 预览中的外部社交占位链接改为样例团队说明/页内导航，避免受限 iframe 中伪装可用的外部跳转。
- 主题改为预览实例内存，监听系统主题变化并清理监听，不读写 `vite-ui-theme` 或其他 localStorage 键。
- 手机菜单和关闭/回到顶部控件有可访问名称，补充对话框说明；使用 Radix 的键盘/焦点恢复行为。回到顶部清理滚动监听。
- 保留 HeroCards 布局，宽度从固定 700px 改为容器内自适应；手机端缩小 Hero/标识字号，价格使用单列零最小宽度轨道、徽章可换行及简短按钮，避免窄屏溢出。补充 44px 控件、焦点和 reduced-motion。没有新增报价、筛选或其他应由后续模型生成的功能。

## Preparation and handoff

仓库根运行 `pnpm prepare:template`；前端 dev/build 自动执行同一脚本。固定输入生成 `frontend/public/template-assets/company-landing.bundle.json`，含入口、预编译 CSS、内嵌资源、精确直接依赖和 LICENSE。该输出被忽略，构建复制进 frontend/dist/template-assets/；准备失败不发布新文件。

纯数据格式/校验与 SHA-256 内容标识由 [bundle.mjs](../bundle.mjs) 统一维护，限制 64 个文件、正文合计 2 MiB；虚拟源码位于 /src/，其他文件仅为固定的 package.json、HTML 和 LICENSE，不接受宿主路径。digest 是内容标识，不是安全签名。新 Tailwind 类不会自动存在于基线 CSS；后续生成应按 GEN-004 的文件策略使用普通 CSS。

运行 `pnpm test:template` 检查准备与文件集合边界。隔离预览及浏览器验收将在后续提交接入。
