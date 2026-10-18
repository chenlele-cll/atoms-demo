export type PreviewStatus = 'compiling' | 'compiled' | 'compileError' | 'runtimeError' | 'timeout';
export type PreviewState = { key: string; status: PreviewStatus; message: string };
export type PreviewEvent = { key: string } & ({ type: 'done'; compilationError: boolean } |
  { type: 'connected' | 'load' | 'compileError' | 'runtimeError' | 'timeout'; message?: string });
export const previewKey = (projectId: string, versionId: string, digest: string, attempt: number) => JSON.stringify([projectId, versionId, digest, attempt]);
export const initialPreview = (key: string): PreviewState => ({ key, status: 'compiling', message: '正在编译预览，首次加载需要下载依赖…' });
export function previewTransition(state: PreviewState, event: PreviewEvent): PreviewState {
  if (event.key !== state.key || ['compileError', 'runtimeError', 'timeout'].includes(state.status)) return state;
  if (event.type === 'connected') return state;
  if (event.type === 'load') return state.status === 'compiled' ? { ...state, status: 'runtimeError', message: '预览文档已重新加载，请重试以重新检查编译。' } : state;
  if (event.type === 'timeout') return state.status === 'compiling' ? { ...state, status: 'timeout', message: '预览服务在 60 秒内未完成编译。请检查网络后重新加载。' } : state;
  if (event.type === 'compileError' || event.type === 'runtimeError') return { ...state, status: event.type, message: event.message?.slice(0, 1200) || '预览编译或运行失败，请重试。' };
  if (event.type === 'done') return event.compilationError ? { ...state, status: 'compileError', message: '预览编译或运行失败，请检查候选或重试。' }
    : { ...state, status: 'compiled', message: '浏览器编译完成 · 请检查关键交互后再采用' };
  return state;
}
