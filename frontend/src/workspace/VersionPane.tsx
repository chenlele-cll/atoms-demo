import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { WorkspaceController, WorkspaceState } from './controller';
import { SnapshotPreview } from '../preview/SnapshotPreview';
import styles from './Workspace.module.css';

function RestoreDialog({ state, app, trigger }: { state: WorkspaceState; app: WorkspaceController; trigger: RefObject<HTMLButtonElement | null> }) {
  const dialog = useRef<HTMLDialogElement>(null); const cancel = useRef<HTMLButtonElement>(null); const confirm = useRef<HTMLButtonElement>(null);
  const frozen = state.operation.frozen;
  useEffect(() => {
    const element = dialog.current; const origin = trigger.current;
    element?.showModal(); cancel.current?.focus();
    return () => {
      element?.close();
      if (origin?.isConnected) origin.focus();
      if (document.activeElement !== origin) document.getElementById('workspace-project-heading')?.focus();
    };
  }, [trigger]);
  if (!frozen) return null;
  return <dialog ref={dialog} className={styles.restoreDialog} aria-labelledby="restore-heading" aria-describedby="restore-effect"
    onCancel={event => { event.preventDefault(); app.cancelRestore(); }} onKeyDown={event => {
      if (event.key !== 'Tab') return;
      if (event.shiftKey && document.activeElement === cancel.current) { event.preventDefault(); confirm.current?.focus(); }
      else if (!event.shiftKey && document.activeElement === confirm.current) { event.preventDefault(); cancel.current?.focus(); }
    }}>
    <h2 id="restore-heading">恢复 v{frozen.sequence}？</h2>
    <p>{state.project?.project.title}</p>
    <dl><dt>项目 ID</dt><dd><code>{frozen.projectId}</code></dd><dt>目标版本</dt><dd><code>{frozen.target}</code></dd><dt>预期当前版本</dt><dd><code>{frozen.expected}</code></dd>
      <dt>快照摘要 · 预览轮次 {frozen.attempt}</dt><dd><code>{frozen.digest}</code></dd></dl>
    <p id="restore-effect">将当前代码切换到此快照，其他历史继续保留。预览内临时业务输入可能重置；此操作不恢复业务数据库。</p>
    <p>请先在真实预览中检查关键交互。浏览器编译完成不代表业务验收。</p>
    <div className={styles.switch}><button ref={cancel} type="button" onClick={() => app.cancelRestore()}>取消</button>
      <button ref={confirm} type="button" className={styles.primary} onClick={() => void app.submitRestore()}>确认恢复此版本</button></div>
  </dialog>;
}

export function VersionPane({ state, app }: { state: WorkspaceState; app: WorkspaceController }) {
  const [choice, setChoice] = useState('');
  const restoreTrigger = useRef<HTMLButtonElement>(null);
  const { project, selected, review, operation } = state;
  if (!project) return null;
  const key = app.previewIdentity();
  const candidate = review?.version.kind === 'generated' && review.successfulRun !== null;
  const path = selected && Object.hasOwn(selected.snapshot.files, choice) ? choice : selected?.snapshot.entry;
  const mode = state.view;
  return <section className={styles.version} aria-label="预览与版本" data-current-version={project.project.currentVersionId}>
    <div className={styles.versionToolbar}>
      <div className={styles.switch} aria-label="选择预览版本">
        {candidate && <button type="button" aria-pressed={state.intent === 'candidate'} onClick={() => void app.viewVersion('candidate')}>候选版本</button>}
        <button type="button" aria-pressed={state.intent === 'current'} onClick={() => void app.viewVersion('current')}>当前版本</button>
      </div>
      <button type="button" disabled={!selected} onClick={() => app.retryPreview()}>重新加载预览</button>
      {state.intent === 'candidate' && candidate && <button type="button" className={styles.primary} disabled={!app.versionWriteAvailable('adopt')} onClick={() => void app.submitAdoption()}>使用这个版本</button>}
      {state.intent === 'history' && <button ref={restoreTrigger} type="button" className={styles.primary} disabled={!app.versionWriteAvailable('restore')} onClick={() => app.openRestore()}>恢复此版本</button>}
    </div>
    <p className={styles.versionLabel} data-viewed-version={state.viewedVersionId ?? ''}>查看 {selected ? `v${selected.sequence}` : state.viewedVersionId ?? '未选择'} · {state.intent === 'history' ? '历史查看' : state.intent === 'candidate' ? '候选查看' : '当前查看'}
      {selected?.id === project.project.currentVersionId ? ' · 当前已保存版本' : ' · 不改变当前代码'}{selected?.id === review?.version.id && candidate ? ' · 生成候选' : ''}</p>
    {state.detailLoading && <p role="status">正在读取所选版本完整快照…</p>}
    {state.detailError && <div className={styles.error} role="alert"><p>{state.detailError}</p>{state.viewedVersionId && <button type="button" onClick={() => void app.viewVersion(state.intent, state.viewedVersionId ?? undefined)}>重试读取版本</button>}</div>}
    {selected && key && <>
      <div hidden={mode === 'code'} className={styles.previewHost}>
        <SnapshotPreview key={key} projectId={project.project.id} versionId={selected.id} snapshot={selected.snapshot} attempt={state.previewAttempt}
          title={`${project.project.title} · v${selected.sequence} · ${state.intent === 'history' ? '历史' : state.intent === 'candidate' ? '候选' : '当前'}版本隔离预览`}
          onState={preview => app.previewState(preview, state.activation)} />
      </div>
      <section hidden={mode !== 'code'} className={styles.code} aria-label="只读源码">
        <label>选择文件<select aria-label="选择文件" value={path} onChange={event => setChoice(event.target.value)}>
          {Object.keys(selected.snapshot.files).sort().map(name => <option key={name} value={name}>{name}</option>)}</select></label>
        <p className={styles.fileName}>v{selected.sequence} · <code>{path}</code> · 只读 · 摘要 {selected.snapshot.digest}</p>
        <pre tabIndex={0} aria-label="文件源码"><code>{path ? selected.snapshot.files[path] : ''}</code></pre>
      </section>
      <details className={styles.versionMetadata}><summary>版本来源与修改文件</summary>
        <p>版本 ID：{selected.id} · {selected.kind === 'template' ? '模板' : '生成快照'} · {selected.createdAt}</p>
        <p>模板来源：{selected.snapshot.id} · {selected.snapshot.version} · {selected.snapshot.source.repository} · {selected.snapshot.source.commit}</p>
        <p>父版本：{selected.parentVersionId ?? '无（模板起点）'}</p>
        <p>成功运行：{state.selectedReview ? state.selectedReview.successfulRun?.id ?? '无关联运行' : '尚未读取版本元数据'}</p>
        <p>修改文件：{state.selectedReview ? state.selectedReview.changedFiles.length : '尚未读取版本元数据'}</p>
        <ul>{state.selectedReview?.changedFiles.map(name => <li key={name}><code>{name}</code></li>)}</ul>
      </details>
    </>}
    <section className={styles.adoption} aria-label="版本操作结果">
      <p role="status" aria-live="polite" data-adoption-state={operation.kind === 'adopt' ? operation.status : undefined} data-restore-state={operation.kind === 'restore' ? operation.status : undefined}>{operation.message}</p>
      {operation.status === 'unknown' && operation.kind === 'adopt' && <button type="button" disabled={operation.querying} onClick={() => void app.submitAdoption(true)}>重试同一采用请求</button>}
      <button type="button" disabled={operation.querying || operation.status === 'submitting'} onClick={() => void app.refreshCurrent()}>{operation.status === 'unknown' ? operation.kind === 'restore' ? '查询恢复结果' : '查询采用结果' : '刷新版本状态'}</button>
      {operation.refreshError && <p className={styles.error} role="alert">{operation.refreshError}</p>}
    </section>
    <p className={styles.note}>预览由外部 Sandpack 接收代码并运行。编译是本轮浏览器观察；切换版本、重试或恢复可能重置预览临时业务输入。平台未提交草稿继续保留。</p>
    {operation.status === 'confirming' && <RestoreDialog state={state} app={app} trigger={restoreTrigger} />}
  </section>;
}
