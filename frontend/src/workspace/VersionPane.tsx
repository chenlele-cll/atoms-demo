import type { ProjectDetail, Version, VersionReview } from '@atoms/contracts';
import { useCandidateReview } from '../candidate-review/useCandidateReview';
import { SnapshotPreview } from '../preview/SnapshotPreview';
import { useState } from 'react';
import styles from './Workspace.module.css';

function Source({ version }: { version: Version }) {
  const [choice, setChoice] = useState(version.snapshot.entry);
  const path = Object.hasOwn(version.snapshot.files, choice) ? choice : version.snapshot.entry;
  return <section className={styles.code} aria-label="只读源码">
    <label>选择文件<select aria-label="选择文件" value={path} onChange={event => setChoice(event.target.value)}>
      {Object.keys(version.snapshot.files).sort().map(name => <option key={name} value={name}>{name}</option>)}</select></label>
    <p className={styles.fileName}>v{version.sequence} · <code>{path}</code> · 只读</p>
    <pre tabIndex={0} aria-label="文件源码"><code>{version.snapshot.files[path]}</code></pre>
  </section>;
}
export function VersionPane({ project, review, mode, onProject, onSelection, onUnauthorized }: {
  project: ProjectDetail; review: VersionReview; mode: 'chat' | 'preview' | 'code'; onProject: (value: ProjectDetail) => void; onSelection: (value: Version) => void; onUnauthorized: () => void;
}) {
  const control = useCandidateReview(project, review, { onProject, onSelection, onUnauthorized });
  const { selected, key, view, attempt, canSubmit, adoption, refreshing, compiled, eligible } = control;
  if (!control.authorized) return <p role="alert">会话已失效，已停止显示私有预览。</p>;
  const candidate = review.version.kind === 'generated' && review.successfulRun !== null;
  return <section className={styles.version} aria-label="预览与版本" data-current-version={control.project.project.currentVersionId}>
    <div className={styles.versionToolbar}>
      <div className={styles.switch} aria-label="选择预览版本">
        {candidate && <button type="button" aria-pressed={view === 'candidate'} onClick={() => control.switchView('candidate')}>候选版本</button>}
        <button type="button" aria-pressed={!candidate || view === 'current'} onClick={() => control.switchView('current')}>当前版本</button>
      </div>
      <button type="button" onClick={() => { control.setPreview(null); control.setAttempt(value => value + 1); }}>重新加载预览</button>
      {candidate && <button type="button" className={styles.primary} disabled={!canSubmit} onClick={() => void control.submit()}>使用这个版本</button>}
    </div>
    <p className={styles.versionLabel} data-viewed-version={selected.id}>查看 v{selected.sequence} · {selected.id === control.project.project.currentVersionId ? '当前已保存版本' : '候选已保存 · 未采用'}</p>
    <div hidden={mode === 'code'} className={styles.previewHost}>
      <SnapshotPreview key={key} projectId={project.project.id} versionId={selected.id} snapshot={selected.snapshot} attempt={attempt}
        title={selected.id === control.project.project.currentVersionId ? '当前版本隔离预览' : '候选版本隔离预览'} onState={state => { if (state.key === key) control.setPreview(state); }} />
    </div>
    <div hidden={mode !== 'code'}><Source key={project.project.id} version={selected} /></div>
    {candidate && <section className={styles.adoption} aria-label="采用结果">
      <p role="status" aria-live="polite" data-adoption-state={adoption.status}>{adoption.message}</p>
      {adoption.status === 'unknown' && <div className={styles.switch}>
        <button type="button" disabled={refreshing} onClick={() => void control.refresh(true)}>查询采用结果</button>
        <button type="button" disabled={refreshing || !compiled || !eligible} onClick={() => void control.submit(true)}>重试同一采用请求</button>
      </div>}
      <button type="button" disabled={refreshing || adoption.status === 'submitting'} onClick={() => void control.refresh()}>刷新版本状态</button>
      {control.refreshError && <p className={styles.error} role="alert">{control.refreshError}</p>}
    </section>}
    <p className={styles.note}>预览由外部 Sandpack 接收代码并运行。编译是本轮浏览器观察；切换版本或重试会重置预览临时输入。</p>
  </section>;
}
