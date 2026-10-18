import { createParser } from 'eventsource-parser';
import { generationBodySchema, generationEventSchema, generationStatusSchema, idSchema, utf8Bytes } from '@atoms/contracts';
import type { GenerationEvent, GenerationStatus, z } from '@atoms/contracts';
import { readJsonResponse, VersionApiError } from './versions';
import { workspaceError } from './workspace-error';

export class GenerationStreamError extends Error {
  constructor(readonly code: 'protocol' | 'disconnected' | 'timeout' | 'cancelled') {
    super({ protocol: '任务流协议校验失败，需查询原请求。', disconnected: '连接结束但未确认结果，需查询原请求。', timeout: '任务连接超时，需查询原请求。', cancelled: '任务连接已结束，结果需查询确认。' }[code]);
    this.name = 'GenerationStreamError';
  }
}
export type GenerationBody = z.infer<typeof generationBodySchema>;
export async function generate(projectId: string, input: GenerationBody, options: {
  signal?: AbortSignal; transport?: typeof fetch; onEvent: (event: GenerationEvent) => void;
  limits?: { headersMs?: number; idleMs?: number; totalMs?: number; bytes?: number; frames?: number };
}): Promise<GenerationStatus> {
  idSchema.parse(projectId); const body = generationBodySchema.parse(input);
  const controller = new AbortController(); let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const stop = (code: 'cancelled' | 'timeout') => { if (!controller.signal.aborted) controller.abort(code); };
  const external = () => stop('cancelled'); options.signal?.addEventListener('abort', external, { once: true }); if (options.signal?.aborted) external();
  const total = setTimeout(() => stop('timeout'), options.limits?.totalMs ?? 150_000);
  const headersTimer = setTimeout(() => stop('timeout'), options.limits?.headersMs ?? 10_000);
  let idle: ReturnType<typeof setTimeout> | undefined;
  let rejectAbort: () => void = () => {};
  const abort = new Promise<never>((_, reject) => { rejectAbort = () => {
    void reader?.cancel().catch(() => {}); reject(new GenerationStreamError(controller.signal.reason === 'timeout' ? 'timeout' : 'cancelled'));
  }; });
  controller.signal.addEventListener('abort', rejectAbort, { once: true }); if (controller.signal.aborted) rejectAbort();
  const check = () => { if (controller.signal.aborted) throw new GenerationStreamError(controller.signal.reason === 'timeout' ? 'timeout' : 'cancelled'); };
  const validateAssociation = (value: GenerationStatus) => {
    if (value.projectId !== projectId || value.requestId !== body.requestId || value.baseVersionId !== body.baseVersionId) throw new GenerationStreamError('protocol');
    return value;
  };
  const work = (async () => {
    check(); const response = await (options.transport ?? fetch)(`/api/projects/${projectId}/generations`, { method: 'POST', signal: controller.signal,
      credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify(body) });
    clearTimeout(headersTimer);
    if (controller.signal.aborted) void response.body?.cancel().catch(() => {});
    check();
    if (!response.ok || response.headers.get('content-type')?.includes('application/json')) {
      idle = setTimeout(() => stop('timeout'), options.limits?.headersMs ?? 10_000);
      const state = validateAssociation(await readJsonResponse(response, generationStatusSchema, controller.signal, 256 * 1024));
      if (![200, 202].includes(response.status) || (response.status === 202) !== (state.status === 'running')) throw new GenerationStreamError('protocol');
      return state;
    }
    if (response.status !== 200 || !response.headers.get('content-type')?.includes('text/event-stream') || !response.body) throw new GenerationStreamError('protocol');
    reader = response.body.getReader(); const decoder = new TextDecoder('utf-8', { fatal: true });
    let sequence = 0; let runId: string | undefined; let terminal: GenerationStatus | undefined; let bytes = 0; let tail = '';
    const fail = () => { throw new GenerationStreamError('protocol'); };
    const parser = createParser({ maxBufferSize: 8192, onError: fail, onId: fail, onRetry: fail,
      onEvent: message => {
        check(); if (terminal || utf8Bytes(message.data) + 16 + (message.event?.length ?? 0) > 8192 || sequence >= (options.limits?.frames ?? 128)) fail();
        let data: unknown; try { data = JSON.parse(message.data); } catch { return fail(); }
        const parsed = generationEventSchema.safeParse(data); if (!parsed.success) return fail(); const event = parsed.data;
        if (message.event !== event.event || event.seq !== sequence + 1 || event.projectId !== projectId || event.requestId !== body.requestId || event.baseVersionId !== body.baseVersionId) fail();
        if (sequence === 0 ? event.event !== 'accepted' : event.event === 'accepted' || event.runId !== runId) fail();
        runId = event.runId; sequence = event.seq;
        if (event.event === 'terminal') terminal = validateAssociation(event.state);
        options.onEvent(event);
      } });
    const resetIdle = () => { clearTimeout(idle); idle = setTimeout(() => stop('timeout'), options.limits?.idleMs ?? 25_000); };
    resetIdle();
    try {
      for (;;) {
        const chunk = await reader.read(); check(); if (chunk.done) break; resetIdle(); bytes += chunk.value.byteLength;
        if (bytes > (options.limits?.bytes ?? 320 * 1024)) fail();
        const text = decoder.decode(chunk.value, { stream: true }); tail = (tail + text).slice(-4); parser.feed(text);
      }
      const last = decoder.decode(); tail = (tail + last).slice(-4); parser.feed(last);
      if (!tail.replace(/\r\n/g, '\n').replace(/\r/g, '\n').endsWith('\n\n')) fail();
      parser.reset({ consume: true });
      if (!terminal) throw new GenerationStreamError('disconnected'); return terminal;
    } finally { parser.reset(); }
  })();
  try { return await Promise.race([work, abort]); }
  catch (error) {
    if (error instanceof GenerationStreamError) throw error;
    if (error instanceof VersionApiError) throw workspaceError(error);
    throw new GenerationStreamError('protocol');
  } finally {
    clearTimeout(total); clearTimeout(headersTimer); clearTimeout(idle); options.signal?.removeEventListener('abort', external);
    controller.signal.removeEventListener('abort', rejectAbort); controller.abort('cancelled');
    if (reader) { void reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch { /* Cancellation already fences a pending read. */ } }
  }
}
