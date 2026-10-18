import { useEffect, useState } from 'react';
import { SnapshotPreview } from '../preview/SnapshotPreview';
import { snapshotSchema } from '@atoms/contracts';
import type { TemplateBundle } from '../../../templates/bundle.mjs';
import { companyTemplate, loadTemplate, templateManifest, templateManifests } from '../templates/companyLanding';
import type { TemplateIdentity } from '../templates/companyLanding';
import styles from './TemplateBaseline.module.css';

export function TemplateAttempt({ expected, templateId = expected?.id ?? companyTemplate.id }: { expected?: TemplateIdentity; templateId?: string }) {
  return <TemplateAttemptContent key={`${templateId}:${expected?.id}:${expected?.version}:${expected?.digest}`} templateId={templateId} {...(expected ? { expected } : {})} />;
}

function TemplateAttemptContent({ templateId, expected }: { templateId: string; expected?: TemplateIdentity }) {
  const [bundle, setBundle] = useState<TemplateBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { id, version, digest } = expected ?? {};
  useEffect(() => {
    const controller = new AbortController();
    loadTemplate(templateId, controller.signal, id !== undefined && version !== undefined && digest !== undefined ? { id, version, digest } : undefined).then((value) => {
      if (!controller.signal.aborted) setBundle(value);
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error && cause.name !== 'TimeoutError' && cause.name !== 'TypeError'
        ? cause.message : '模板资源请求失败或超时。请检查网络后重试。');
    });
    return () => controller.abort();
  }, [templateId, id, version, digest]);

  if (error) return <p className={styles.error} role="alert" data-preview-state="error">{error}</p>;
  if (!bundle) return <p className={styles.status} role="status" data-preview-state="loading">正在加载并校验模板资源…</p>;
  return (
    <>
      <SnapshotPreview snapshot={snapshotSchema.parse(bundle)} projectId="template" versionId={`${bundle.id}-v${bundle.version}`} attempt={0}
        title={`${bundle.name}模板隔离预览`} baseline />
      <p className={styles.digest}>{Object.keys(bundle.files).length} 个文件 · SHA-256 <code>{bundle.digest}</code></p>
    </>
  );
}

export function TemplateBaseline({ templateId = companyTemplate.id }: { templateId?: string }) {
  const [attempt, setAttempt] = useState(0);
  const template = templateManifest(templateId);
  if (!template) return <main className={styles.page}><h1>模板不存在</h1><a href="/">返回首页</a></main>;
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <a href="/" className={styles.back}>← 返回首页</a>
        <span className={styles.badge}>模板原版 · 预览适配版</span>
      </header>
      <nav className={styles.templates} aria-label="模板原版">{templateManifests.map(item => <a key={item.id} href={`/templates/${item.id}`} aria-current={item.id === template.id ? 'page' : undefined}>{item.name}</a>)}</nav>
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>{template.category} / v{template.version}</p>
          <h1>{template.name}</h1>
          <p className={styles.description}>先操作模板，了解生成的起点。这里展示固定模板，不是 AI 生成结果。</p>
        </div>
        <button type="button" onClick={() => setAttempt((value) => value + 1)} className={styles.retry}>重新加载预览</button>
      </div>
      <p className={styles.source}>
        来源：<a href={`${template.source.repository}/tree/${template.source.commit}`} target="_blank" rel="noreferrer noopener">{template.source.repository.replace('https://github.com/', '')}</a>
        <span><a href={`${template.source.repository}/blob/${template.source.commit}/LICENSE`} target="_blank" rel="noreferrer noopener">{template.source.license}</a> · 固定提交 {template.source.commit.slice(0, 7)}</span>
      </p>
      <section className={styles.panel} aria-label="模板预览" data-attempt={attempt}>
        <TemplateAttempt key={`${template.id}:${attempt}`} templateId={template.id} />
      </section>
      <p className={styles.note}>页面内容均为模板示例，未接入注册、支付、订阅或联系服务。预览依赖外部 Sandpack 与包下载网络；重新加载会重置预览内的临时状态。</p>
    </main>
  );
}
