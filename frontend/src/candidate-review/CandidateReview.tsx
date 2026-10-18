import { useEffect, useState } from 'react';
import type { ProjectDetail, VersionReview } from '@atoms/contracts';
import { getProject, getVersion, VersionApiError } from '../api/versions';
import { SnapshotPreview } from '../preview/SnapshotPreview';
import { useCandidateReview } from './useCandidateReview';
import styles from './CandidateReview.module.css';

const labels = { eligible: '基线一致，可在预览后采用', 'already-current': '当前已是此版本', stale: '候选基线已过期', busy: '项目正在生成，请稍后刷新',
  unconfirmed: '生成状态未确认，暂不能采用', 'not-candidate': '此版本不可作为生成候选采用' };
function Review({ initialProject, initialReview }: { initialProject: ProjectDetail; initialReview: VersionReview }) {
  const { authorized, projectId, project, review, view, attempt, adoption, refreshError, refreshing, selected, key, compiled, eligible, canSubmit, refresh, submit, switchView, setPreview, setAttempt } = useCandidateReview(initialProject, initialReview);
  if (!authorized) return <main className={styles.page}><h1>候选检查</h1><p role="alert">会话已失效（HTTP 401），已停止显示私有版本。</p><a href="/">返回首页</a></main>;
  const source = review.version.snapshot.source;
  return <main className={styles.page}>
    <header className={styles.header}><a href="/">← 返回首页</a><span className={styles.eyebrow}>ATOMS / VERSION REVIEW</span></header>
    <div className={styles.heading}><div><p className={styles.eyebrow}>候选检查</p><h1>{project.project.title}</h1><p className={styles.muted}>检查应用中的关键交互，然后决定是否使用这个版本。</p></div>
      <button className={styles.primary} type="button" disabled={!canSubmit} onClick={() => void submit()}>使用这个版本</button></div>
    <div className={styles.layout}>
      <aside className={styles.details} aria-label="版本信息">
        <h2>版本信息</h2><dl><dt>正在查看</dt><dd data-viewed-version={selected.id}>v{selected.sequence} · {view === 'candidate' ? '候选版本' : '当前版本'}</dd>
          <dt>当前持久版本</dt><dd data-current-version={project.project.currentVersionId}>v{project.currentVersion.sequence} · <code>{project.project.currentVersionId}</code></dd>
          <dt>候选状态</dt><dd data-adoption-availability={review.adoptionAvailability}>{labels[review.adoptionAvailability]}</dd></dl>
        <h2>修改文件</h2>{review.changedFiles.length ? <ul className={styles.paths}>{review.changedFiles.map(path => <li key={path}><code>{path}</code></li>)}</ul> : <p className={styles.muted}>没有相对父版本的修改。</p>}
        <h2>模板来源</h2><p className={styles.source}>{source.repository}<br />{source.license} · <code>{source.commit.slice(0, 7)}</code></p>
        <p className={styles.digest}>SHA-256 <code>{selected.snapshot.digest}</code></p>
        <button type="button" disabled={refreshing || adoption.status === 'submitting'} onClick={() => void refresh()}>{refreshing ? '刷新中…' : '刷新版本状态'}</button>
      </aside>
      <section className={styles.panel} aria-label="版本预览" data-attempt={attempt}>
        <div className={styles.toolbar}><div className={styles.switch} aria-label="选择预览版本">
          <button type="button" aria-pressed={view === 'candidate'} onClick={() => switchView('candidate')}>候选版本</button>
          <button type="button" aria-pressed={view === 'current'} onClick={() => switchView('current')}>当前版本</button></div>
          <button type="button" onClick={() => { setPreview(null); setAttempt(value => value + 1); }}>重新加载预览</button></div>
        <SnapshotPreview key={key} snapshot={selected.snapshot} projectId={projectId} versionId={selected.id} attempt={attempt}
          title={view === 'candidate' ? '候选版本隔离预览' : '当前版本隔离预览'} onState={state => { if (state.key === key) setPreview(state); }} />
      </section>
    </div>
    <section className={styles.confirmation} aria-label="采用结果"><p role="status" aria-live="polite" data-adoption-state={adoption.status}>{adoption.message}</p>
      {adoption.status === 'unknown' && <div className={styles.actions}><button type="button" disabled={refreshing} onClick={() => void refresh(true)}>查询采用结果</button>
        <button type="button" disabled={!compiled || !eligible} onClick={() => void submit(true)}>重试同一采用请求</button></div>}
      {refreshError && <p role="alert" className={styles.error}>{refreshError}</p>}
      <p className={styles.muted}>浏览器编译是本次本地观察，不代表业务已验收。预览由外部 Sandpack 服务接收代码并运行；切换或重试会重置预览内的临时输入。采用只保存代码与当前选择。</p>
    </section>
  </main>;
}
export function CandidateReview({ projectId, versionId }: { projectId: string; versionId: string }) {
  const [data, setData] = useState<{ project: ProjectDetail; review: VersionReview } | null>(null);
  const [error, setError] = useState(''); const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([getProject(projectId, { signal: controller.signal }), getVersion(projectId, versionId, { signal: controller.signal })])
      .then(([project, review]) => { if (!controller.signal.aborted) setData({ project, review }); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof VersionApiError
        ? cause.status === null ? cause.message : `${cause.message}（HTTP ${cause.status}）` : '版本加载失败。'); });
    return () => controller.abort();
  }, [projectId, versionId, attempt]);
  if (data) return <Review key={`${projectId}/${versionId}`} initialProject={data.project} initialReview={data.review} />;
  return <main className={styles.page}><header className={styles.header}><a href="/">← 返回首页</a></header><h1>候选检查</h1>
    <p role={error ? 'alert' : 'status'} data-preview-state={error ? 'loadError' : 'loadingSnapshot'}>{error || '正在加载并校验项目与版本…'}</p>
    {error && <button type="button" onClick={() => { setError(''); setAttempt(value => value + 1); }}>重试加载版本</button>}</main>;
}
