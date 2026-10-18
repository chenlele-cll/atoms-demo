import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react';
import { WorkspaceController } from './workspace/controller';
import { routeFor } from './workspace/routing';
import { internalClick } from './workspace/routing';
import { Creation, Navigation, ProjectWorkspace } from './workspace/Workspace';
import styles from './workspace/Workspace.module.css';
const TemplateBaseline = lazy(() => import('./template-baseline/TemplateBaseline').then(module => ({ default: module.TemplateBaseline })));
const CandidateReview = lazy(() => import('./candidate-review/CandidateReview').then(module => ({ default: module.CandidateReview })));
const ConnectionCheck = lazy(() => import('./diagnostics/ConnectionCheck').then(module => ({ default: module.ConnectionCheck })));

export function App() {
  const [app] = useState(() => {
    let storage: Storage | undefined;
    try { storage = window.sessionStorage; } catch { /* The controller explicitly reports memory-only recovery. */ }
    return new WorkspaceController({ ...(storage ? { storage } : {}), navigate: path => window.history.pushState(null, '', path) });
  });
  const state = useSyncExternalStore(app.subscribe, app.snapshot);
  useEffect(() => {
    const activate = () => app.activate(routeFor(window.location.pathname));
    const leaving = () => app.leave();
    const visibility = () => app.visibility(document.hidden);
    const link = (event: MouseEvent) => {
      if (event.defaultPrevented || !internalClick(event) || !(event.target instanceof Element)) return;
      const anchor = event.target.closest('a'); if (!anchor || anchor.target || anchor.hasAttribute('download')) return;
      const target = new URL(anchor.href); if (target.origin !== window.location.origin || target.hash) return;
      event.preventDefault(); if (target.pathname !== window.location.pathname) window.history.pushState(null, '', target.pathname);
      app.activate(routeFor(target.pathname));
    };
    activate(); window.addEventListener('popstate', activate); window.addEventListener('pagehide', leaving); document.addEventListener('visibilitychange', visibility); document.addEventListener('click', link);
    // Subscription replay in StrictMode must not dispose the application's task owner.
    return () => { window.removeEventListener('popstate', activate); window.removeEventListener('pagehide', leaving); document.removeEventListener('visibilitychange', visibility); document.removeEventListener('click', link); };
  }, [app]);
  const navigate = (path: string) => { if (window.location.pathname !== path) window.history.pushState(null, '', path); app.activate(routeFor(path)); };
  const route = state.route;
  return <Suspense fallback={<main><p role="status">正在加载页面…</p></main>}>
    {route.kind === 'template' ? <TemplateBaseline key={route.templateId} templateId={route.templateId} /> : route.kind === 'candidate' ? <CandidateReview key={route.path} projectId={route.projectId} versionId={route.versionId} />
      : route.kind === 'diagnostics' ? <ConnectionCheck /> : route.kind === 'home' || route.kind === 'project' ? <div className={styles.shell}>
        <Navigation state={state} app={app} navigate={navigate} />
        {route.kind === 'home' ? <Creation state={state} app={app} /> : <ProjectWorkspace key={state.activation} state={state} app={app} />}
      </div> : <main className={styles.projectLoading}><h1>页面不存在</h1><p>这个地址没有对应的工作台页面。</p><a href="/">返回创建首页</a><a href="/diagnostics/connection">连接诊断</a></main>}
  </Suspense>;
}
