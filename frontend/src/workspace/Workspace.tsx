import { lazy, Suspense, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import type { WorkspaceController, WorkspaceState } from './controller';
import { internalClick } from './routing';
import styles from './Workspace.module.css';
import { HistoryPane } from './HistoryPane';
import { operationBlocks } from './history-state';
import { TemplateSelectionPreview } from './TemplateSelectionPreview';
const VersionPane = lazy(() => import('./VersionPane').then(module => ({ default: module.VersionPane })));

function Icon({ name }: { name: 'spark' | 'plus' | 'arrow' | 'project' | 'grid' }) {
  const paths = { spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z', plus: 'M12 5v14M5 12h14', arrow: 'M5 12h14m-6-6 6 6-6 6', project: 'M4 5h6l2 3h8v12H4V5Z', grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z' };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export function ProductLink({ href, navigate, children, className }: { href: string; navigate: (path: string) => void; children: ReactNode; className?: string | undefined }) {
  const click = (event: MouseEvent<HTMLAnchorElement>) => { if (internalClick(event)) { event.preventDefault(); navigate(href); } };
  return <a href={href} onClick={click} className={className}>{children}</a>;
}
export function Navigation({ state, app, navigate }: { state: WorkspaceState; app: WorkspaceController; navigate: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  return <aside className={styles.navigation}>
    <div className={styles.brand}><ProductLink href="/" navigate={navigate}><span className={styles.brandMark}><Icon name="spark" /></span>atoms<span className={styles.brandCaption}>创作工作台</span></ProductLink>
      <button className={styles.menu} type="button" aria-expanded={open} aria-controls="project-navigation" onClick={() => setOpen(value => !value)}>项目导航</button></div>
    <nav id="project-navigation" aria-label="项目导航" data-open={open}>
      <ProductLink href="/" navigate={path => { setOpen(false); navigate(path); }} className={styles.newProject}><Icon name="plus" />新建项目</ProductLink>
      <p className={styles.eyebrow}>最近项目</p>
      {state.projects.length === 0 ? <p className={styles.muted}>当前会话还没有项目。</p> : state.projects.map(project => <ProductLink key={project.id} href={`/projects/${project.id}`}
        navigate={path => { setOpen(false); navigate(path); }} className={state.route.kind === 'project' && state.route.projectId === project.id ? styles.selectedProject : styles.projectLink}>
        <span title={project.title}>{project.title}</span><small>项目工作台</small></ProductLink>)}
      {state.cursor && <button type="button" onClick={() => void app.refreshProjects(true)}>加载更多项目</button>}
      <div className={styles.navFooter}><ProductLink href="/templates/company-landing" navigate={navigate}><Icon name="grid" />模板原版</ProductLink><ProductLink href="/diagnostics/connection" navigate={navigate}>连接诊断<span aria-hidden="true">↗</span></ProductLink><p>从想法出发，一步步构建。</p></div>
    </nav>
  </aside>;
}
const examples = [
  ['在线报价工具', '为企业官网添加一个在线报价工具：选择服务类型和页面数量，实时计算报价，并保留原有导航与常见问题。'],
  ['产品筛选目录', '在企业官网中添加产品目录，支持按分类筛选和关键词搜索，并显示真实的筛选数量。'],
];
export function Creation({ state, app }: { state: WorkspaceState; app: WorkspaceController }) {
  const composing = useRef(false);
  const selectedTemplate = state.templates.find(template => template.id === state.home.templateId);
  const shortcut = (event: KeyboardEvent<HTMLTextAreaElement>) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing && !composing.current) { event.preventDefault(); void app.create(); } };
  return <main className={styles.creation}>
    <header className={styles.homeHeader}><span>你的创作空间</span><a href="/templates/company-landing"><Icon name="grid" />浏览起始模板<Icon name="arrow" /></a></header>
    <section className={styles.creationHero} aria-labelledby="creation-heading">
    <div className={styles.heroHeading}><p className={styles.eyebrow}><Icon name="spark" />让想法开始生长</p><h1 id="creation-heading">你想把什么想法<br />变成现实？</h1>
    <p className={styles.intro}>用自然语言描述，让你的下一个应用从这里开始。</p></div>
    <form className={styles.composer} onSubmit={event => { event.preventDefault(); if (!composing.current) void app.create(); }}>
      <label className={styles.promptLabel} htmlFor="home-prompt">你想创建什么？</label>
      <textarea id="home-prompt" maxLength={4000} rows={3} value={state.home.prompt} onChange={event => app.editHome({ prompt: event.target.value })}
        onKeyDown={shortcut} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        placeholder="描述你的想法，例如：为我的品牌官网添加一个在线报价工具，选择服务后就能实时计算价格…" disabled={state.home.status === 'submitting'} />
      <div className={styles.creationOptions}><div><label htmlFor="project-title">项目名称 <span className={styles.muted}>（可选）</span></label>
      <input id="project-title" maxLength={120} value={state.home.title} onChange={event => app.editHome({ title: event.target.value })} placeholder="为你的想法起个名字" disabled={state.home.status === 'submitting'} /></div><div>
      <label htmlFor="template-choice">起始模板</label>
      <select id="template-choice" value={state.home.templateId} onChange={event => app.editHome({ templateId: event.target.value })} disabled={state.home.status === 'submitting' || !state.templates.length}>
        {!state.templates.length && <option value="">{state.loading ? '正在读取模板…' : '暂无可用模板'}</option>}
        {state.templates.map(template => <option key={template.id} value={template.id}>{template.name} · v{template.version}</option>)}
      </select></div></div>
      {selectedTemplate && <TemplateSelectionPreview key={`${selectedTemplate.id}:${selectedTemplate.version}:${selectedTemplate.digest}`} template={selectedTemplate} />}
      <div className={styles.composerActions}><span className={styles.note}>Enter 换行 · Ctrl/Cmd + Enter 提交</span>
        <button className={styles.primary} type="submit" disabled={!state.home.sessionReady || !state.templates.length || state.home.status === 'submitting' || !state.home.prompt.trim()}>
          {state.home.status === 'submitting' ? '正在创建…' : '创建并生成'}<Icon name="arrow" /></button></div>
    </form>
    <div className={styles.examples} aria-label="示例需求"><span>试试这些想法</span>{examples.map(([label, prompt]) => <button type="button" key={label} onClick={() => app.editHome({ prompt: prompt ?? '' })}><Icon name="plus" />{label}</button>)}</div>
    {state.home.message && <p role="status" aria-live="polite" data-create-state={state.home.status}>{state.home.message}</p>}
    {state.error && <section className={styles.error} role="alert"><p>{state.error}</p><button type="button" onClick={() => app.activate(state.route, true)}>重试读取</button></section>}
    {!state.home.sessionReady && !state.loading && <button type="button" onClick={() => app.restartSession()}>重新开始会话</button>}
    </section>
    <section className={styles.recent} aria-label="最近项目"><div className={styles.sectionHeading}><div><p className={styles.eyebrow}>你的作品</p><h2>继续已有项目</h2></div><button type="button" onClick={() => void app.refreshProjects()}>刷新项目列表</button></div>
      {state.projects.length ? <div className={styles.projectGrid}>{state.projects.map(project => <a className={styles.projectCard} key={project.id} href={`/projects/${project.id}`}><span className={styles.projectCardIcon}><Icon name="project" /></span><h3 title={project.title}>{project.title}</h3><p>打开项目，继续创作</p><span className={styles.cardArrow}><Icon name="arrow" /></span></a>)}</div>
        : <div className={styles.emptyProjects}><span className={styles.projectCardIcon}><Icon name="project" /></span><div><h3>{state.loading ? '正在读取你的项目…' : '你的第一个作品，从这里开始'}</h3><p>{state.loading ? '正在读取当前会话。' : '在上方描述想法，创建后的项目会保存在这里。'}</p></div></div>}
    </section>
    <footer className={styles.homeFooter}>描述想法<span aria-hidden="true">/</span>预览与调整<span aria-hidden="true">/</span>选择满意的版本</footer>
  </main>;
}
const activityNames = { 'request-started': '模型请求已发出', 'request-finished': '模型请求已结束', 'tool-started': '工具开始', 'tool-finished': '工具完成', 'agent-started': 'OpenCode 已开始实现', 'agent-finished': 'OpenCode 已完成代码修改', 'agent-tool-finished': 'OpenCode 工具完成', validated: '候选结构已校验', saved: '候选已保存', ended: '任务已结束' };
function Conversation({ state, app }: { state: WorkspaceState; app: WorkspaceController }) {
  const container = useRef<HTMLDivElement>(null); const stick = useRef(true); const composing = useRef(false);
  const projectId = state.project?.project.id ?? ''; const activation = state.activation;
  const initial = useRef(false);
  useLayoutEffect(() => {
    const element = container.current; if (!element) return;
    if (!initial.current) { element.scrollTop = app.reading.get(projectId) ?? element.scrollHeight; stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 64; initial.current = true; }
    else if (stick.current) element.scrollTop = element.scrollHeight;
  }, [state.messages.length, state.task?.events.length, app, projectId]);
  const earlier = async () => {
    const element = container.current; if (!element) return; const top = element.scrollTop; const height = element.scrollHeight; stick.current = false;
    await app.earlier(); requestAnimationFrame(() => { if (element.isConnected) { element.scrollTop = top + element.scrollHeight - height; app.reading.set(projectId, element.scrollTop); } });
  };
  const task = state.task; const runId = task?.state?.runId ?? task?.events[0]?.runId;
  const busy = task && !['terminal','unknown'].includes(task.phase);
  const wrongBase = state.selected?.id !== state.project?.project.currentVersionId;
  const locked = busy || task?.phase === 'unknown' || wrongBase || operationBlocks(state.operation) || Boolean(state.operation.refreshError);
  const submit = () => { if (!composing.current && !locked) void app.start(); };
  return <section className={styles.conversation} aria-label="对话">
    <div className={styles.messages} ref={container} onScroll={event => { const element = event.currentTarget; stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 64; app.reading.set(projectId, element.scrollTop); }}>
      {state.before && <button type="button" onClick={() => void earlier()}>加载更早消息</button>}
      {!state.messages.length && !task && <div className={styles.empty}><h2>从第一条需求开始</h2><p>这里会显示服务端保存的对话；当前模板可以先预览。</p></div>}
      {state.messages.map(message => <article className={message.role === 'user' ? styles.userMessage : styles.assistantMessage} key={message.id} data-message-id={message.id} data-message-sequence={message.sequence}>
        <span>{message.role === 'user' ? '你' : '已保存的结果摘要'}</span><p>{message.content}</p></article>)}
      {task?.accepted && task.payload.prompt && runId && !state.messages.some(message => message.runId === runId && message.role === 'user') &&
        <article className={styles.userMessage} data-pending-user="true"><span>你 · 已受理，正在校准记录</span><p>{task.payload.prompt}</p></article>}
      {task && <section className={styles.task} aria-label="本次任务" data-task-phase={task.phase}>
        <p role="status" aria-live="polite">{task.message}</p>
        {task.events.length > 0 && <details open><summary>本次真实活动 · {task.events.length} 条</summary><ol>
          {task.events.map(event => <li key={event.seq}>{event.event === 'accepted' ? '需求已受理并保存' : event.event === 'activity' ? `${activityNames[event.activity.type]}${event.activity.agentTool || event.activity.tool ? ` · ${event.activity.agentTool ?? event.activity.tool}` : ''}${event.activity.step > 0 ? ` · 第 ${event.activity.step} 步` : ''}` : '终态已确认'}</li>)}
        </ol></details>}
        <div className={styles.switch}>
          {busy && <button type="button" onClick={() => void app.cancel()} disabled={task.phase === 'cancelling'}>{task.phase === 'cancelling' ? '正在取消…' : '取消生成'}</button>}
          {task.phase !== 'terminal' && <button type="button" onClick={() => void app.query()}>查询结果</button>}
          {task.phase === 'unknown' && task.local && <button type="button" disabled={operationBlocks(state.operation)} onClick={() => void app.start(task.payload.prompt, undefined, true)}>重试原请求</button>}
          {task.phase === 'terminal' && task.state?.status !== 'succeeded' && <button type="button" onClick={() => { app.setDraft(task.payload.prompt); }}>使用上次需求</button>}
        </div>
      </section>}
    </div>
    <form className={styles.prompt} onSubmit={event => { event.preventDefault(); submit(); }}>
      <p className={styles.note} data-input-base={state.project?.project.currentVersionId}>生成基线：当前 v{state.project?.currentVersion.sequence}</p>
      {wrongBase && <p className={styles.warning}>正在查看其他版本。请先采用或恢复，或切换“当前版本”再提交。</p>}
      {(operationBlocks(state.operation) || state.operation.refreshError) && <p className={styles.warning}>版本操作尚未结束或当前事实待核对，请先查询版本状态。</p>}
      <label htmlFor={`project-prompt-${activation}`}>描述下一步需求</label>
      <textarea id={`project-prompt-${activation}`} rows={4} maxLength={4000} value={state.draft} disabled={Boolean(busy)} onChange={event => app.setDraft(event.target.value)}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing && !composing.current) { event.preventDefault(); submit(); } }} />
      <div className={styles.composerActions}><span className={styles.note}>Enter 换行 · Ctrl/Cmd + Enter 提交</span><button className={styles.primary} type="submit" disabled={Boolean(locked) || !state.draft.trim()}>生成候选</button></div>
    </form>
  </section>;
}
export function ProjectWorkspace({ state, app }: { state: WorkspaceState; app: WorkspaceController }) {
  const resultPane = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (resultPane.current) resultPane.current.scrollTop = 0; }, [state.view]);
  if (!state.project) return <main className={styles.projectLoading}><h1>项目工作台</h1><p role={state.error ? 'alert' : 'status'}>{state.error || '正在读取项目、最新对话与已保存版本…'}</p>
    {state.operation.status === 'confirmed' && <p role="status">{state.operation.message}</p>}
    <button type="button" onClick={() => app.activate(state.route, true)}>重新读取项目</button></main>;
  return <main className={styles.workspace}>
    <header className={styles.projectHeader}><div><h1 id="workspace-project-heading" tabIndex={-1}>{state.project.project.title}</h1><p>当前已保存 v{state.project.currentVersion.sequence} · {state.project.project.templateId}</p></div>
      <div className={styles.viewTabs} aria-label="工作台视图">{(['chat','history','preview','code'] as const).map(view => <button type="button" key={view} aria-pressed={state.view === view} onClick={() => app.setView(view)}>{view === 'chat' ? '聊天' : view === 'history' ? '历史' : view === 'preview' ? '预览' : '代码'}</button>)}</div>
    </header>
    {state.error && <p role="alert" className={styles.error}>{state.error}</p>}
    {state.storageWarning && <p role="status" className={styles.warning}>{state.storageWarning}</p>}
    <div className={styles.workspacePanes} data-mobile-view={state.view}>
      <div className={styles.chatPane}><div hidden={state.view === 'history'} className={styles.paneContent}><Conversation state={state} app={app} /></div>
        <div hidden={state.view !== 'history'} className={styles.paneContent}><HistoryPane state={state} app={app} /></div></div>
      <div className={styles.resultPane} ref={resultPane}><Suspense fallback={<p role="status">正在加载预览与源码视图…</p>}><VersionPane key={state.activation} state={state} app={app} /></Suspense></div>
    </div>
  </main>;
}
