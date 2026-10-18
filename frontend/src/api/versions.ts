import { adoptRequestSchema, adoptResponseSchema, errorSchema, idSchema, projectDetailSchema, restoreRequestSchema, restoreResponseSchema,
  VERSION_HISTORY_MAX_BYTES, versionHistoryQuerySchema, versionHistorySchema, versionReviewSchema } from '@atoms/contracts';
import type { z } from '@atoms/contracts';
export type { Restoration, VersionHistory } from '@atoms/contracts';

export class VersionApiError extends Error {
  constructor(readonly kind: 'http' | 'invalid' | 'tooLarge' | 'network' | 'cancelled' | 'timeout', message: string,
    readonly status: number | null = null, readonly code: string | null = null, readonly retryAfter: number | null = null) { super(message); this.name = 'VersionApiError'; }
}
export type ApiOptions = { signal?: AbortSignal; transport?: typeof fetch; timeoutMs?: number; onResponse?: (response: Response) => void;
  responseLimit?: number; safeErrorMessages?: boolean };
export type VersionHistoryOptions = ApiOptions & { limit?: number; beforeSequence?: number };
type Options = ApiOptions;
async function readText(response: Response, max: number, signal: AbortSignal): Promise<string> {
  if (Number(response.headers.get('content-length')) > max || !response.body) {
    void response.body?.cancel().catch(() => {}); throw new VersionApiError('tooLarge', '响应体积或内容无效。');
  }
  const reader = response.body.getReader(); const decoder = new TextDecoder('utf-8', { fatal: true }); let bytes = 0; let text = '';
  const decode = (value?: Uint8Array, stream = false) => {
    try { return decoder.decode(value, { stream }); } catch { throw new VersionApiError('invalid', '响应不是有效的 UTF-8。'); }
  };
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel();
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength;
      if (bytes > max) throw new VersionApiError('tooLarge', '响应超过大小限制。'); text += decode(part.value, true); }
    return text + decode();
  } finally { signal.removeEventListener('abort', cancel); void reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch { /* Abort already fences a pending read. */ } }
}
export async function versionRequest<T>(url: string, schema: z.ZodType<T>, options: Options = {}, body?: unknown): Promise<T> {
  const timeout = new AbortController(); const timer = setTimeout(() => timeout.abort(), options.timeoutMs ?? 10_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal;
  let readerResponse: Response | undefined;
  let rejectAbort: () => void = () => {};
  const abort = new Promise<never>((_, reject) => { rejectAbort = () => reject(new VersionApiError(options.signal?.aborted ? 'cancelled' : 'timeout',
    options.signal?.aborted ? '请求已取消。' : '请求超时，结果可能需要查询确认。')); });
  signal.addEventListener('abort', rejectAbort, { once: true }); if (signal.aborted) rejectAbort();
  const work = (async () => {
    if (signal.aborted) throw new VersionApiError('cancelled', '请求已取消。');
    const response = await (options.transport ?? fetch)(url, { method: body === undefined ? 'GET' : 'POST', signal, credentials: 'same-origin', cache: 'no-store',
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
    readerResponse = response;
    if (signal.aborted) { void response.body?.cancel().catch(() => {}); throw new VersionApiError('cancelled', '请求已结束。'); }
    options.onResponse?.(response);
    return readJsonResponse(response, schema, signal, options.responseLimit, options.safeErrorMessages);
  })();
  try { return await Promise.race([work, abort]); }
  catch (error) {
    if (error instanceof VersionApiError) throw error;
    throw new VersionApiError('network', '服务连接中断，请检查网络后重试。');
  } finally {
    clearTimeout(timer); signal.removeEventListener('abort', rejectAbort); timeout.abort();
    // Real fetch observes signal abort during reading; a late transport is also fenced by the race above.
    if (signal.aborted && readerResponse?.body && !readerResponse.body.locked) void readerResponse.body.cancel().catch(() => {});
  }
}
const projectPath = (projectId: string) => `/api/projects/${idSchema.parse(projectId)}`;
export async function getProject(projectId: string, options?: Options) {
  const value = await versionRequest(projectPath(projectId), projectDetailSchema, options);
  if (value.project.id !== projectId || value.currentVersion.projectId !== projectId || value.currentVersion.id !== value.project.currentVersionId) throw new VersionApiError('invalid', '项目关联校验失败。');
  return value;
}
export async function getVersion(projectId: string, versionId: string, options?: Options) {
  const value = await versionRequest(`${projectPath(projectId)}/versions/${idSchema.parse(versionId)}`, versionReviewSchema, options);
  if (value.version.id !== versionId || value.version.projectId !== projectId) throw new VersionApiError('invalid', '版本关联校验失败。');
  return value;
}
export async function adoptVersion(projectId: string, versionId: string, expectedCurrentVersionId: string, options?: Options) {
  const value = await versionRequest(`${projectPath(projectId)}/versions/${idSchema.parse(versionId)}/adopt`, adoptResponseSchema, options, adoptRequestSchema.parse({ expectedCurrentVersionId }));
  if (value.projectId !== projectId || value.currentVersionId !== versionId) throw new VersionApiError('invalid', '采用响应关联校验失败。');
  return value;
}

export async function getVersionHistory(projectId: string, options: VersionHistoryOptions = {}) {
  const { limit = 20, beforeSequence } = options;
  if (!Number.isSafeInteger(limit) || (beforeSequence !== undefined && !Number.isSafeInteger(beforeSequence))) {
    throw new VersionApiError('invalid', '历史分页参数无效。');
  }
  const query = versionHistoryQuerySchema.safeParse({ limit: String(limit), ...(beforeSequence === undefined ? {} : { beforeSequence: String(beforeSequence) }) });
  if (!query.success) throw new VersionApiError('invalid', '历史分页参数无效。');
  const value = await versionRequest(`${projectPath(projectId)}/versions?limit=${query.data.limit}${beforeSequence === undefined ? '' : `&beforeSequence=${query.data.beforeSequence}`}`,
    versionHistorySchema, { ...options, responseLimit: VERSION_HISTORY_MAX_BYTES, safeErrorMessages: true });
  if (value.projectId !== projectId || value.items.length > limit ||
    (beforeSequence !== undefined && value.items.some(item => item.sequence >= beforeSequence)) ||
    (value.nextBeforeSequence !== null && (value.items.length !== limit || (beforeSequence !== undefined && value.nextBeforeSequence >= beforeSequence)))) {
    throw new VersionApiError('invalid', '历史分页或项目关联校验失败。');
  }
  return value;
}

export async function restoreVersion(projectId: string, versionId: string, expectedCurrentVersionId: string, options?: Options) {
  const value = await versionRequest(`${projectPath(projectId)}/versions/${idSchema.parse(versionId)}/restore`, restoreResponseSchema,
    { ...options, responseLimit: 16 * 1024, safeErrorMessages: true }, restoreRequestSchema.parse({ expectedCurrentVersionId }));
  if (value.projectId !== projectId || value.currentVersionId !== versionId) throw new VersionApiError('invalid', '恢复响应关联校验失败。');
  return value;
}

export function retryAfter(headers: Headers): number | null {
  const raw = headers.get('retry-after'); if (!raw) return null;
  const seconds = /^\d+$/.test(raw) ? Number(raw) : Math.ceil((Date.parse(raw) - Date.now()) / 1000);
  return Number.isFinite(seconds) ? Math.max(1, Math.min(150, seconds)) : null;
}
const safeExplanations = {
  SESSION_REQUIRED: '会话已失效，请明确重新开始。', NOT_FOUND: '项目或版本不存在，或不属于当前会话。',
  INVALID_INPUT: '请求内容无效。', ORIGIN_NOT_ALLOWED: '请求来源不被允许。', BODY_TOO_LARGE: '请求内容超过大小限制。', JSON_REQUIRED: '请求必须使用 JSON。',
  CURRENT_VERSION_CONFLICT: '当前版本已改变，请刷新后重新确认。', PROJECT_BUSY: '项目正在执行其他任务。',
  RUN_STATE_UNCONFIRMED: '服务端无法确认原任务状态。', STORAGE_UNAVAILABLE: '存储暂不可用，结果需确认。',
  OWNERSHIP_UNAVAILABLE: '服务暂不可用，结果需确认。', SERVER_SHUTDOWN: '服务正在停止，结果需确认。',
  VERSION_NOT_RESTORABLE: '该版本无法恢复。', DATA_CORRUPT: '已存版本数据无法验证。', RATE_LIMITED: '请求频率过高，请稍后再查询。',
} as const;
export async function readJsonResponse<T>(response: Response, schema: z.ZodType<T>, signal: AbortSignal, limit = 16 * 1024 * 1024, safeErrorMessages = false): Promise<T> {
  const text = await readText(response, response.ok ? limit : Math.min(limit, 64 * 1024), signal);
  let data: unknown; try { data = JSON.parse(text); } catch { throw new VersionApiError('invalid', '服务器响应不是有效的 JSON。'); }
  if (!response.ok) {
    const error = errorSchema.safeParse(data);
    if (safeErrorMessages) {
      const code = error.success && Object.hasOwn(safeExplanations, error.data.error.code) ? error.data.error.code : null;
      const message: unknown = code ? Reflect.get(safeExplanations, code) : null;
      throw new VersionApiError('http', typeof message === 'string' ? message : `请求失败（HTTP ${response.status}）。`, response.status, code, retryAfter(response.headers));
    }
    throw new VersionApiError('http', error.success ? error.data.error.message.slice(0, 500) : `请求失败（HTTP ${response.status}）。`, response.status,
    error.success ? error.data.error.code : null, retryAfter(response.headers));
  }
  const result = schema.safeParse(data);
  if (!result.success) throw new VersionApiError('invalid', '版本结构或内容摘要校验失败。');
  return result.data;
}
