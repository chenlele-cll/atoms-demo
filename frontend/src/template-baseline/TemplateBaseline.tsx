import { useEffect, useState } from 'react';
import { SnapshotPreview } from '../preview/SnapshotPreview';
import { snapshotSchema } from '@atoms/contracts';
import type { TemplateBundle } from '../../../templates/bundle.mjs';
import { companyTemplate, loadCompanyTemplate } from '../templates/companyLanding';
import styles from './TemplateBaseline.module.css';

function TemplateAttempt() {
  const [bundle, setBundle] = useState<TemplateBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    loadCompanyTemplate(controller.signal).then((value) => {
      if (!controller.signal.aborted) setBundle(value);
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error && cause.name !== 'TimeoutError' && cause.name !== 'TypeError'
        ? cause.message : '模板资源请求失败或超时。请检查网络后重试。');
    });
    return () => controller.abort();
  }, []);

  if (error) return <p className={styles.error} role="alert" data-preview-state="error">{error}</p>;
  if (!bundle) return <p className={styles.status} role="status" data-preview-state="loading">正在加载并校验模板资源…</p>;
  return (
    <>
      <SnapshotPreview snapshot={snapshotSchema.parse(bundle)} projectId="template" versionId="company-landing-v1" attempt={0}
        title="企业官网模板隔离预览" baseline />
      <p className={styles.digest}>{Object.keys(bundle.files).length} 个文件 · SHA-256 <code>{bundle.digest}</code></p>
    </>
  );
}

export function TemplateBaseline() {
  const [attempt, setAttempt] = useState(0);
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <a href="/" className={styles.back}>← 返回首页</a>
        <span className={styles.badge}>模板原版 · 预览适配版</span>
      </header>
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>COMPANY WEBSITE / v{companyTemplate.version}</p>
          <h1>{companyTemplate.name}</h1>
          <p className={styles.description}>先操作模板，了解生成的起点。这里展示固定模板，不是 AI 生成结果。</p>
        </div>
        <button type="button" onClick={() => setAttempt((value) => value + 1)} className={styles.retry}>重新加载预览</button>
      </div>
      <p className={styles.source}>
        来源：<a href={`${companyTemplate.source.repository}/tree/${companyTemplate.source.commit}`} target="_blank" rel="noreferrer noopener">leoMirandaa / shadcn-landing-page</a>
        <span><a href={`${companyTemplate.source.repository}/blob/${companyTemplate.source.commit}/LICENSE`} target="_blank" rel="noreferrer noopener">MIT</a> · 固定提交 {companyTemplate.source.commit.slice(0, 7)}</span>
      </p>
      <section className={styles.panel} aria-label="模板预览" data-attempt={attempt}>
        <TemplateAttempt key={attempt} />
      </section>
      <p className={styles.note}>团队、评价与价格均为模板示例，未接入注册、支付、订阅或联系服务。预览依赖外部 Sandpack 与包下载网络；重新加载会重置预览内的临时状态。</p>
    </main>
  );
}
