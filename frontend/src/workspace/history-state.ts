import type { VersionHistory } from '@atoms/contracts';

export type HistoryItem = VersionHistory['items'][number];
export type HistoryState = {
  epoch: number; loaded: boolean; loading: boolean; items: HistoryItem[]; before: number | null; error: string; scrollTop: number;
};
export const initialHistory = (epoch = 0): HistoryState => ({ epoch, loaded: false, loading: false, items: [], before: null, error: '', scrollTop: 0 });
export function mergeHistory(old: HistoryItem[], incoming: HistoryItem[], current: string): HistoryItem[] {
  const items = [...old];
  for (const item of incoming) {
    // Version metadata is immutable. Overlapping pages cannot replace an inspected record.
    if (!items.some(existing => existing.id === item.id || existing.sequence === item.sequence)) items.push(item);
  }
  return items.sort((a, b) => b.sequence - a.sequence).map(item => ({ ...item, isCurrent: item.id === current }));
}
export type FrozenRestore = {
  projectId: string; activation: number; target: string; sequence: number; expected: string; digest: string; attempt: number;
};
export type VersionOperation = {
  kind: 'restore' | 'adopt'; status: 'idle' | 'confirming' | 'submitting' | 'confirmed' | 'conflict' | 'busy' | 'unconfirmed' | 'unknown' | 'error';
  target: string; expected: string; message: string; refreshError: string; querying: boolean; frozen: FrozenRestore | null;
};
export const initialOperation = (): VersionOperation => ({ kind: 'restore', status: 'idle', target: '', expected: '', message: '', refreshError: '', querying: false, frozen: null });
export const operationBlocks = (operation: VersionOperation) => operation.querying || ['confirming', 'submitting', 'unknown', 'busy', 'unconfirmed'].includes(operation.status);
