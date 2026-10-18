import { Readable } from 'node:stream';
import type { ServerResponse } from 'node:http';
import { generationEventSchema } from '../contracts/generations.js';
import type { GenerationEvent } from '../contracts/generations.js';

export const streamLimits = { frameBytes: 8192, frames: 128, totalBytes: 256 * 1024, queueFrames: 32,
  queueBytes: 64 * 1024, highWaterMark: 16 * 1024, waitMs: 5000, heartbeatMs: 10_000 };
export type StreamLimits = typeof streamLimits;
type Failure = 'CLIENT_DISCONNECTED' | 'SLOW_CONSUMER' | 'STREAM_WRITE_FAILED';

// Readable's own buffer and the explicit pending queue have independent bounds.
export class GenerationStream {
  readonly readable: Readable;
  readonly completion: Promise<void>;
  private complete: () => void = () => {};
  private readonly limits: StreamLimits;
  private queue: Buffer[] = [];
  private queuedBytes = 0;
  private frames = 0;
  private totalBytes = 0;
  private blocked = false;
  private ending = false;
  private closed = false;
  private waitTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private response: ServerResponse | undefined;
  private previous: GenerationEvent | undefined;
  private readonly onClose = () => { if (!this.response?.writableFinished) this.fail('CLIENT_DISCONNECTED'); else this.cleanup(); };
  private readonly onError = () => this.fail('STREAM_WRITE_FAILED');
  constructor(private readonly abort: (code: Failure) => void, limits: Partial<StreamLimits> = {}) {
    this.completion = new Promise(resolve => { this.complete = resolve; });
    this.limits = { ...streamLimits, ...limits };
    this.readable = new Readable({ highWaterMark: this.limits.highWaterMark, read: () => {
      this.blocked = false; clearTimeout(this.waitTimer); this.waitTimer = undefined; this.pump();
    } });
    this.readable.on('error', this.onError);
    this.readable.once('close', () => { if (!this.closed && !this.readable.readableEnded) this.fail('CLIENT_DISCONNECTED'); });
    this.heartbeat = setInterval(() => {
      if (!this.closed && !this.ending && !this.blocked && !this.queue.length) this.enqueue(Buffer.from(': keep-alive\n\n'));
    }, this.limits.heartbeatMs);
    this.heartbeat.unref();
  }
  bind(response: ServerResponse) {
    this.response = response;
    response.once('close', this.onClose); response.once('error', this.onError);
    response.once('finish', this.onFinish);
  }
  private readonly onFinish = () => this.cleanup();
  send(input: GenerationEvent): boolean {
    if (this.closed || this.ending) return false;
    const parsed = generationEventSchema.safeParse(input);
    if (!parsed.success) { this.fail('STREAM_WRITE_FAILED'); return false; }
    const event = parsed.data;
    if ((!this.previous && event.event !== 'accepted') || (this.previous &&
      (this.previous.event === 'terminal' || event.event === 'accepted' || event.seq !== this.previous.seq + 1 ||
        event.projectId !== this.previous.projectId || event.requestId !== this.previous.requestId ||
        event.runId !== this.previous.runId || event.baseVersionId !== this.previous.baseVersionId))) {
      this.fail('STREAM_WRITE_FAILED'); return false;
    }
    const bytes = Buffer.from(`event: ${parsed.data.event}\ndata: ${JSON.stringify(parsed.data)}\n\n`, 'utf8');
    if (bytes.length > this.limits.frameBytes || ++this.frames > this.limits.frames ||
      (this.totalBytes += bytes.length) > this.limits.totalBytes) { this.fail('STREAM_WRITE_FAILED'); return false; }
    this.previous = event;
    return this.enqueue(bytes);
  }
  private enqueue(bytes: Buffer) {
    if (this.queue.length >= this.limits.queueFrames || this.queuedBytes + bytes.length > this.limits.queueBytes) {
      this.fail('SLOW_CONSUMER'); return false;
    }
    this.queue.push(bytes); this.queuedBytes += bytes.length; this.pump(); return !this.closed;
  }
  private deadline() {
    if (!this.waitTimer) this.waitTimer = setTimeout(() => this.fail('SLOW_CONSUMER'), this.limits.waitMs);
  }
  private pump() {
    if (this.closed || this.blocked) return;
    while (this.queue.length) {
      const bytes = this.queue.shift(); if (!bytes) break;
      this.queuedBytes -= bytes.length;
      if (!this.readable.push(bytes)) { this.blocked = true; this.deadline(); return; }
    }
    if (this.ending) { this.readable.push(null); this.deadline(); }
  }
  end() { if (this.closed || this.ending) return; this.ending = true; clearInterval(this.heartbeat); this.pump(); this.deadline(); }
  fail(code: Failure = 'STREAM_WRITE_FAILED') {
    if (this.closed) return;
    this.cleanup(); this.abort(code); this.readable.destroy(); this.response?.destroy(); this.response = undefined;
  }
  private cleanup() {
    if (this.closed) return;
    this.closed = true; clearInterval(this.heartbeat); clearTimeout(this.waitTimer); this.waitTimer = undefined;
    this.queue = []; this.queuedBytes = 0;
    this.response?.off('close', this.onClose); this.response?.off('error', this.onError); this.response?.off('finish', this.onFinish);
    this.complete();
    // Keep the harmless error handler until the stream is destroyed by Fastify.
  }
  get diagnostics() { return { closed: this.closed, queuedFrames: this.queue.length, queuedBytes: this.queuedBytes,
    bufferedBytes: this.readable.readableLength, timerActive: this.waitTimer !== undefined && !this.closed }; }
}
