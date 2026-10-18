import { useLayoutEffect, useRef } from 'react';
import type { WorkspaceController, WorkspaceState } from './controller';
import styles from './Workspace.module.css';

export function HistoryPane({ state, app }: { state: WorkspaceState; app: WorkspaceController }) {
  const list = useRef<HTMLElement>(null); const { history, project } = state;
  useLayoutEffect(() => { if (list.current) list.current.scrollTop = history.scrollTop; }, [history.epoch, history.scrollTop]);
  return <section ref={list} className={styles.history} aria-labelledby="workspace-history-heading"
    onScroll={event => app.historyPosition(event.currentTarget.scrollTop)}>
    <header><h2 id="workspace-history-heading" tabIndex={-1}>版本历史</h2>
      <button type="button" onClick={() => void app.loadHistory(false, true)}>刷新历史</button></header>
    <p>选择只查看代码。请切换到预览检查关键交互后，再明确恢复。其他历史继续保留。</p>
    {history.error && <div role="alert" className={styles.error}><p>{history.error}</p>
      <button type="button" disabled={history.loading} onClick={() => void app.loadHistory(history.loaded)}>重试读取历史</button></div>}
    {history.loading && <p role="status">正在读取版本历史…</p>}
    {history.loaded && !history.items.length && <p role="status">没有可显示的历史版本。</p>}
    <ol className={styles.historyList}>{history.items.map(item => <li key={item.id} data-history-version={item.id}>
      <button type="button" aria-pressed={state.viewedVersionId === item.id} onClick={() => void app.viewVersion('history', item.id)}>
        <strong>v{item.sequence} · {item.kind === 'template' ? '模板' : '生成快照'}</strong>
        <span>{item.id === project?.project.currentVersionId ? '当前版本' : '已保存'}{item.id === state.viewedVersionId ? ' · 正在查看' : ''}{item.id === state.review?.version.id && state.review.successfulRun ? ' · 生成候选' : ''}</span>
        <time dateTime={item.createdAt}>{item.createdAt}</time><code title={item.id}>{item.id.slice(0, 8)}</code>
      </button>
      <p className={styles.excerpt}>{item.request ? `请求摘录${item.request.truncated ? '（已截断）' : ''}：${item.request.excerpt}` : '无关联请求'}</p>
      <p className={styles.excerpt}>{item.summary.source === 'stored' ? '已存摘要' : '事实回退摘要'}：{item.summary.text}</p>
      <details><summary>展开元数据 · {item.changedFiles.length} 个修改文件</summary>
        <dl><dt>完整版本 ID</dt><dd><code>{item.id}</code></dd><dt>父版本</dt><dd>{item.parentVersionId ?? '无（模板起点）'}</dd>
          <dt>运行 ID</dt><dd>{item.runId ?? '无关联运行'}</dd></dl>
        {item.request && <><p>请求消息：{item.request.messageId}</p><p className={styles.fullText}>请求摘录{item.request.truncated ? '（服务器已截断，展开不恢复完整需求）' : ''}：{item.request.excerpt}</p></>}
        <p className={styles.fullText}>{item.summary.source === 'stored' ? '已存摘要' : '事实回退摘要'}：{item.summary.text}</p>
        {item.changedFiles.length ? <ul>{item.changedFiles.map(path => <li key={path}><code>{path}</code></li>)}</ul> : <p>{item.kind === 'template' ? '模板起点，无修改文件。' : '无修改文件。'}</p>}
      </details>
    </li>)}</ol>
    {history.loaded && history.before !== null && <button type="button" disabled={history.loading} onClick={() => void app.loadHistory(true)}>加载更早版本</button>}
    {history.loaded && history.before === null && history.items.length > 0 && <p>已到最早版本。</p>}
  </section>;
}
