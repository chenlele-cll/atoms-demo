import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { WorkspaceState } from './controller';
import { companyTemplate, templateManifest } from '../templates/companyLanding';
import thumbnail from '../templates/company-landing-v1.png';
import styles from './TemplateSelectionPreview.module.css';

const TemplateAttempt = lazy(() => import('../template-baseline/TemplateBaseline').then(module => ({ default: module.TemplateAttempt })));
// Captured from the actual isolated template, not a generated application.
const thumbnailDigest = '44e5ae3cc6ad1faf92e9000108279abe533b903dc7ea9b04124466690c2133e6';
type Template = WorkspaceState['templates'][number];

function TemplateDialog({ template, close }: { template: Template; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const element = dialog.current;
    const origin = document.activeElement;
    element?.showModal();
    return () => { element?.close(); if (origin instanceof HTMLElement && origin.isConnected) origin.focus(); };
  }, []);
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="template-preview-heading" aria-describedby="template-preview-description" onCancel={event => { event.preventDefault(); close(); }}>
    <header className={styles.dialogHeader}><div><h2 id="template-preview-heading">{template.name}</h2><p id="template-preview-description">起始模板 · v{template.version} · 可直接操作，关闭后继续填写需求。</p></div>
      <div className={styles.actions}><button type="button" onClick={() => setAttempt(value => value + 1)}>重新加载预览</button><button type="button" autoFocus onClick={close}>关闭预览</button></div></header>
    <div className={styles.livePreview}><Suspense fallback={<p role="status">正在加载模板预览…</p>}><TemplateAttempt key={attempt} expected={template} /></Suspense></div>
    <p className={styles.disclaimer}>页面内容均为模板示例，未接入支付或联系服务。交互预览需联网加载，未发送你的项目需求。</p>
  </dialog>;
}

export function TemplateSelectionPreview({ template }: { template: Template }) {
  const [open, setOpen] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const trusted = templateManifest(template.id);
  const available = trusted && template.version === trusted.version && /^[a-f0-9]{64}$/.test(template.digest);
  const hasThumbnail = template.id === companyTemplate.id && template.version === companyTemplate.version && template.digest === thumbnailDigest;
  if (!available) return <p className={styles.unavailable}>所选模板 v{template.version} 暂无匹配的交互预览，请刷新模板列表后重试。</p>;
  return <>
    <button type="button" className={styles.card} onClick={() => setOpen(true)} aria-label={`放大预览：${template.name}`} aria-haspopup="dialog">
      {!hasThumbnail || imageFailed ? <span className={styles.imageFallback}>{imageFailed ? '外观图加载失败' : '暂无对应版本的外观图'}<br />点击查看交互预览</span> : <img className={styles.thumbnail} src={thumbnail} alt={`${template.name} v${template.version} 的实际首页外观`} width={1390} height={800} onError={() => setImageFailed(true)} />}
      <span className={styles.caption}><span className={styles.label}>已选模板 · v{template.version}</span><strong>{template.name}</strong><span className={styles.description}>固定起始模板 · 查看页面与实际交互</span><span className={styles.previewAction}>放大预览 <span aria-hidden="true">↗</span></span></span>
    </button>
    {open && <TemplateDialog template={template} close={() => setOpen(false)} />}
  </>;
}
