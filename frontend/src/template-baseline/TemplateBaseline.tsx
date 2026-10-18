import { useEffect, useRef, useState } from 'react';
import { SandpackProvider, useSandpackClient } from '@codesandbox/sandpack-react';
import type { TemplateBundle } from '../../../templates/bundle.mjs';
import { companyTemplate, loadCompanyTemplate } from '../templates/companyLanding';
import styles from './TemplateBaseline.module.css';

const BUNDLER_URL = 'https://2-19-8-sandpack.codesandbox.io/';
const PREVIEW_TIMEOUT_MS = 60000;
type PreviewState = { status: 'compiling' | 'ready' | 'error'; message: string };

function TemplateFrame() {
  const { iframe, listen, sandpack, getClient } = useSandpackClient();
  const runSandpack = sandpack.runSandpack;
  const [state, setState] = useState<PreviewState>({ status: 'compiling', message: '正在编译模板，首次加载需要下载预览依赖…' });
  const failed = useRef(false);
  const deadline = useRef<number | null>(null);
  const ready = useRef(false);
  const started = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    // React StrictMode replays mount effects. Start after that replay so the
    // pinned client's asynchronous registration creates only one live client.
    queueMicrotask(() => {
      if (!active || started.current) return;
      started.current = true;
      runSandpack().then(() => {
        // Client module loading can finish after a retry unmounted this attempt.
        // Its provider cleanup ran before creation, so dispose that late client.
        if (!mounted.current) getClient()?.destroy();
      }).catch(() => {
        if (!mounted.current) return;
        failed.current = true;
        setState({ status: 'error', message: '预览客户端初始化失败，请重新加载。' });
      });
    });
    return () => { active = false; };
  }, [runSandpack, getClient]);

  useEffect(() => {
    deadline.current ??= Date.now() + PREVIEW_TIMEOUT_MS;
    let active = true;
    const fail = (message: string) => {
      if (!active || failed.current) return;
      failed.current = true;
      setState({ status: 'error', message });
    };
    const timer = window.setTimeout(() => {
      if (!ready.current) fail('预览服务在 60 秒内未完成编译。请检查网络后重新加载。');
    }, Math.max(0, deadline.current - Date.now()));
    const unsubscribe = listen((message) => {
      if (!active || failed.current) return;
      if ((message.type === 'action' && message.action === 'show-error') ||
          (message.type === 'action' && message.action === 'notification' && message.notificationType === 'error') ||
          (message.type === 'done' && message.compilatonError === true)) {
        fail('模板预览编译或运行失败。请重新加载；持续失败时检查模板文件与依赖网络。');
      } else if (message.type === 'done' && message.compilatonError === false) {
        ready.current = true;
        window.clearTimeout(timer);
        setState({ status: 'ready', message: '预览可运行 · 可在下方操作模板' });
      }
    });
    return () => {
      active = false;
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [listen]);

  return (
    <>
      <p className={state.status === 'error' ? styles.error : styles.status} role="status" data-preview-state={state.status}>
        {state.message}
      </p>
      <iframe
        src={BUNDLER_URL}
        ref={iframe}
        title="企业官网模板隔离预览"
        sandbox="allow-scripts allow-same-origin"
        allow=""
        referrerPolicy="no-referrer"
        className={styles.frame}
        aria-busy={state.status === 'compiling'}
        hidden={state.status === 'error'}
      />
    </>
  );
}

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
  const files = Object.fromEntries(Object.entries(bundle.files).map(([filename, code]) => [filename, { code }]));
  return (
    <>
      <SandpackProvider
        files={files}
        customSetup={{ entry: bundle.entry, environment: 'create-react-app', dependencies: bundle.dependencies }}
        options={{ bundlerURL: BUNDLER_URL, initMode: 'immediate', autorun: false, autoReload: false }}
        className={styles.preview}
      >
        <TemplateFrame />
      </SandpackProvider>
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
