import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { WebcamFrameMonitor } from '../src/services/webcam-frame-monitor';

class Video {
  style = {};
  dataset: Record<string, string> = {};
  srcObject: unknown;
  readyState = 4;
  plays = 0;
  removed = false;
  private next = 1;
  private callbacks = new Map<number, VideoFrameRequestCallback>();
  setAttribute() {}
  play() { this.plays++; return Promise.resolve(); }
  pause() {}
  remove() { this.removed = true; }
  requestVideoFrameCallback(callback: VideoFrameRequestCallback) { const id = this.next++; this.callbacks.set(id, callback); return id; }
  cancelVideoFrameCallback(id: number) { this.callbacks.delete(id); }
  frame(presentedFrames: number, mediaTime: number) {
    const entry = this.callbacks.entries().next().value!;
    this.callbacks.delete(entry[0]);
    entry[1](0, { presentedFrames, mediaTime } as VideoFrameCallbackMetadata);
  }
}

async function fixture(context: TestContext, run: (value: { monitor: WebcamFrameMonitor; video: Video; advance: (ms: number) => void; stops: () => number }) => Promise<void>) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const video = new Video(); let now = 0, stops = 0;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => video, body: { append() {} } } });
  context.mock.method(performance, 'now', () => now);
  context.mock.method(console, 'warn', () => {});
  context.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const stream = { getVideoTracks: () => [{ readyState: 'live', muted: false, stop: () => { stops++; } }] } as unknown as MediaStream;
  const monitor = new WebcamFrameMonitor(stream);
  try { await run({ monitor, video, advance: ms => { now += ms; context.mock.timers.tick(ms); }, stops: () => stops }); }
  finally {
    monitor.dispose();
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor); else Reflect.deleteProperty(globalThis, 'document');
  }
}

test('readiness requires two new presented frames; unchanged scene pixels are irrelevant', async context => {
  await fixture(context, async ({ monitor, video }) => {
    let ready = false;
    const pending = monitor.ready().then(() => { ready = true; });
    video.frame(1, 0.033); await Promise.resolve(); assert.equal(ready, false);
    video.frame(1, 0.033); await Promise.resolve(); assert.equal(ready, false);
    video.frame(2, 0.067); await pending; assert.equal(ready, true);
  });
});

test('stalled frames rebind the same stream without stopping the recording track', async context => {
  await fixture(context, async ({ monitor, video, advance, stops }) => {
    const stream = video.srcObject;
    monitor.watch(); advance(5000);
    assert.equal(video.plays, 2); assert.equal(video.srcObject, stream); assert.equal(stops(), 0);
    advance(5000); assert.equal(video.plays, 3);
    advance(10000); assert.equal(video.plays, 3);
    video.frame(1, 20.03); advance(1000);
    assert.equal(video.dataset.frames, '1'); assert.equal(stops(), 0);
  });
});

test('absence of frames rejects startup, and disposing rejects an outstanding readiness wait', async context => {
  await fixture(context, async ({ monitor, advance }) => {
    const rejected = assert.rejects(monitor.ready(), /没有持续送来画面/);
    advance(5000); await rejected;
    const canceled = assert.rejects(monitor.ready(), /取消/);
    monitor.dispose(); await canceled;
  });
});
