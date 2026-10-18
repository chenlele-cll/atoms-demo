import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createServer, request } from 'node:http';
import { setTimeout as delay, setImmediate as tick } from 'node:timers/promises';
import { GenerationStream, streamLimits } from '../src/generation/stream.js';
import { generationEventSchema, generationStatusSchema } from '../src/contracts/generations.js';
import type { GenerationEvent } from '../src/contracts/generations.js';

const association = { projectId: randomUUID(), requestId: randomUUID(), runId: randomUUID(), baseVersionId: randomUUID() };
const accepted: GenerationEvent = { ...association, event: 'accepted', seq: 1, at: new Date().toISOString() };
const activity = (seq: number): GenerationEvent => ({ ...association, event: 'activity', seq, at: accepted.at,
  activity: { type: 'validated', step: 3, changedFiles: ['/src/generated/Fixture.tsx'] } });
const state = generationStatusSchema.parse({ ...association, status: 'cancelled', startedAt: accepted.at, finishedAt: accepted.at,
  errorCode: 'USER_CANCELLED', cancellationRequested: true, terminalStatePersisted: true, candidateVersionId: null,
  changedFiles: [], previewStatus: 'unverified', usage: null });
const terminal: GenerationEvent = { ...association, event: 'terminal', seq: 2, at: accepted.at, state };

test('public schema rejects incoherent states, fields and terminal association; transport enforces stream sequence', () => {
  for (const invalid of [{ ...state, prompt: 'PRIVATE' }, { ...state, status: 'succeeded' }, { ...state, terminalStatePersisted: false },
    { ...state, status: 'unknown' }, { ...state, candidateVersionId: randomUUID() }]) assert.equal(generationStatusSchema.safeParse(invalid).success, false);
  assert.equal(generationEventSchema.safeParse({ ...terminal, state: { ...state, runId: randomUUID() } }).success, false);
  for (const invalid of [activity(2), { ...accepted, seq: 2 }, { ...terminal, seq: 1 }]) {
    const codes: string[] = []; const stream = new GenerationStream(code => codes.push(code));
    assert.equal(stream.send(invalid as GenerationEvent), false); assert.deepEqual(codes, ['STREAM_WRITE_FAILED']);
    assert.equal(stream.diagnostics.timerActive, false);
  }
  const stream = new GenerationStream(() => {}); stream.send(accepted);
  assert.equal(stream.send(activity(3)), false); assert.equal(stream.diagnostics.closed, true);
});

test('8 KiB frame and business frame/byte totals are bounded and abort explicitly', async t => {
  for (const kind of ['frame', 'count', 'total'] as const) await t.test(kind, () => {
    const codes: string[] = []; const stream = new GenerationStream(code => codes.push(code),
      { frames: kind === 'count' ? 1 : 128, totalBytes: kind === 'total' ? 400 : 256 * 1024 });
    stream.send(accepted);
    const next = activity(2);
    if (kind === 'frame' && next.event === 'activity') next.activity.changedFiles = Array.from({ length: 80 }, (_, i) => `/src/generated/${i}${'x'.repeat(190)}.tsx`);
    assert.equal(stream.send(next), false); assert.deepEqual(codes, ['STREAM_WRITE_FAILED']);
    assert.equal(stream.diagnostics.queuedBytes, 0); assert.equal(stream.diagnostics.timerActive, false);
    assert.ok(stream.diagnostics.bufferedBytes <= streamLimits.highWaterMark + streamLimits.frameBytes);
  });
});

test('queue frame/byte overflow and send deadline clean timers and abort once', async t => {
  for (const kind of ['queue-count', 'queue-bytes', 'wait', 'terminal-wait', 'write-error'] as const) await t.test(kind, async () => {
    const codes: string[] = []; const stream = new GenerationStream(code => codes.push(code),
      { highWaterMark: 1, queueFrames: 2, queueBytes: kind === 'queue-bytes' ? 1 : 64 * 1024, waitMs: 20, heartbeatMs: 5 });
    stream.send(accepted);
    if (kind === 'queue-count' || kind === 'queue-bytes') {
      for (let i = 2; i < 8; i++) stream.send(activity(i));
    } else if (kind === 'write-error') stream.readable.destroy(new Error('PRIVATE_WRITE_ERROR'));
    else if (kind === 'terminal-wait') { stream.send(terminal); stream.end(); }
    await stream.completion;
    assert.equal(codes.length, 1); assert.equal(codes[0], kind === 'write-error' ? 'STREAM_WRITE_FAILED' : 'SLOW_CONSUMER');
    assert.deepEqual({ ...stream.diagnostics, bufferedBytes: 0 }, { closed: true, queuedFrames: 0, queuedBytes: 0, bufferedBytes: 0, timerActive: false });
    stream.fail(); stream.end(); await delay(10); assert.equal(codes.length, 1);
  });
});

test('real slow HTTP reader triggers bounded backpressure while an unrelated stream completes', async t => {
  let stream: GenerationStream | undefined; const codes: string[] = [];
  let producer: Promise<void> | undefined;
  const server = createServer((req, res) => {
    if (req.url === '/healthy') { res.end('healthy'); return; }
    stream = new GenerationStream(code => codes.push(code), { waitMs: 30, frames: 10_000, totalBytes: 32 * 1024 * 1024 });
    stream.bind(res); res.setHeader('Content-Type', 'text/event-stream'); stream.readable.pipe(res); stream.send(accepted);
    const current = stream;
    producer = (async () => {
      for (let seq = 2; seq < 10_000 && !current.diagnostics.closed; seq++) {
        const frame = activity(seq);
        if (frame.event === 'activity') frame.activity.changedFiles = Array.from({ length: 20 }, (_, i) => `/src/generated/${i}${'x'.repeat(180)}.tsx`);
        current.send(frame); if (seq % 8 === 0) await tick();
      }
    })();
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { stream?.fail(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await producer; });
  const address = server.address(); assert.ok(address && typeof address !== 'string'); const url = `http://127.0.0.1:${address.port}`;
  const client = request(url, response => { response.pause(); response.on('error', () => {}); });
  client.on('error', () => {}); client.end(); t.after(() => client.destroy());
  for (let i = 0; i < 200 && !codes.length; i++) await delay(10);
  assert.deepEqual(codes, ['SLOW_CONSUMER']); assert.ok(stream);
  assert.equal(stream.diagnostics.queuedBytes, 0); assert.equal(stream.diagnostics.timerActive, false);
  assert.ok(stream.diagnostics.bufferedBytes <= streamLimits.highWaterMark + streamLimits.frameBytes);
  assert.equal(await (await fetch(url + '/healthy')).text(), 'healthy');
});
