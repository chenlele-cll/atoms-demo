export type AdoptionState = { status: 'idle' | 'submitting' | 'confirmed' | 'conflict' | 'unknown' | 'error'; message: string };
export const initialAdoption: AdoptionState = { status: 'idle', message: '先检查候选中的关键交互，再明确选择使用。' };
export function confirmation(current: string, target: string, expected: string): AdoptionState {
  return current === target ? { status: 'confirmed', message: '已确认使用这个版本。' } : current !== expected
    ? { status: 'conflict', message: '当前版本已被其他操作更改，此候选不会覆盖新选择。' }
    : { status: 'unknown', message: '当前仍是原版本，原采用请求的结果尚未确认。可再次查询或使用相同请求手动重试。' };
}
