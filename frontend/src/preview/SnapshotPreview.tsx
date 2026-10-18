import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SandpackProvider, useSandpackClient } from '@codesandbox/sandpack-react';
import type { Snapshot } from '@atoms/contracts';
import { initialPreview, previewKey, previewTransition } from './state';
import type { PreviewEvent, PreviewState } from './state';
import styles from './SnapshotPreview.module.css';

export const BUNDLER_URL = 'https://2-19-8-sandpack.codesandbox.io/';
type Props = { snapshot: Snapshot; projectId: string; versionId: string; attempt: number; title: string; onState?: (state: PreviewState) => void; baseline?: boolean };
function SnapshotFrame({ instanceKey, title, onState, baseline }: { instanceKey: string; title: string; onState?: Props['onState']; baseline?: boolean | undefined }) {
  const { iframe, listen, sandpack, getClient } = useSandpackClient();
  const runSandpack = sandpack.runSandpack;
  const [state, setState] = useState(() => initialPreview(instanceKey));
  const current = useRef(state); const mounted = useRef(false); const started = useRef(false);
  const deadline = useRef<number | null>(null); const report = useRef(onState);
  useEffect(() => { report.current = onState; }, [onState]);
  const transition = useCallback((event: PreviewEvent) => {
    if (!mounted.current) return;
    current.current = previewTransition(current.current, event);
    setState(current.current); report.current?.(current.current);
  }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active || started.current) return;
      started.current = true;
      report.current?.(current.current);
      runSandpack().then(() => { if (!mounted.current) getClient()?.destroy(); }).catch(() => {
        transition({ key: instanceKey, type: 'compileError', message: '预览客户端初始化失败，请重新加载。' });
      });
    });
    return () => { active = false; };
  }, [runSandpack, getClient, instanceKey, transition]);
  useEffect(() => {
    let active = true; deadline.current ??= Date.now() + 60_000;
    const timer = current.current.status === 'compiling' ? window.setTimeout(() => transition({ key: instanceKey, type: 'timeout' }), Math.max(0, deadline.current - Date.now())) : undefined;
    const unsubscribe = listen(message => {
      if (!active) return;
      if (message.type === 'done' && typeof message.compilatonError === 'boolean') {
        transition({ key: instanceKey, type: 'done', compilationError: message.compilatonError });
      } else if (message.type === 'action' && (message.action === 'show-error' || (message.action === 'notification' && message.notificationType === 'error'))) {
        transition({ key: instanceKey, type: 'runtimeError', message: '预览编译或运行失败。请重试；持续失败时检查候选文件与依赖网络。' });
      }
    });
    return () => { active = false; clearTimeout(timer); unsubscribe(); };
  }, [listen, instanceKey, transition]);
  const failed = !['compiling', 'compiled'].includes(state.status);
  return <>
    <p className={failed ? styles.error : styles.status} role={failed ? 'alert' : 'status'} aria-live="polite"
      data-preview-state={baseline ? failed ? 'error' : state.status === 'compiled' ? 'ready' : 'compiling' : state.status}>
      {state.message}
    </p>
    <iframe src={BUNDLER_URL} ref={iframe} title={title} sandbox="allow-scripts allow-same-origin" allow="" referrerPolicy="no-referrer"
      className={styles.frame} aria-busy={state.status === 'compiling'} hidden={failed}
      onLoad={() => transition({ key: instanceKey, type: 'load' })} />
  </>;
}
export function SnapshotPreview(props: Props) {
  const key = previewKey(props.projectId, props.versionId, props.snapshot.digest, props.attempt);
  const files = useMemo(() => Object.fromEntries(Object.entries(props.snapshot.files).map(([filename, code]) => [filename, { code }])), [props.snapshot.files]);
  // The fixed external bundler must never share the platform's origin.
  if (new URL(BUNDLER_URL).origin === window.location.origin) throw new Error('Preview origin must be isolated');
  return <SandpackProvider key={key} files={files}
    customSetup={{ entry: props.snapshot.entry, environment: 'create-react-app', dependencies: props.snapshot.dependencies }}
    options={{ bundlerURL: BUNDLER_URL, initMode: 'immediate', autorun: false, autoReload: false }} className={styles.preview}>
    <SnapshotFrame instanceKey={key} title={props.title} onState={props.onState} baseline={props.baseline} />
  </SandpackProvider>;
}
