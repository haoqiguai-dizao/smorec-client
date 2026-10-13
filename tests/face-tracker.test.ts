import assert from 'node:assert/strict';
import test from 'node:test';
import { FaceTracker, currentFaceStatus } from '../src/services/camera-effects/face/tracker';

test('preview tracking bounds work, drops stale faces and cannot reuse geometry after a source change or seek', async () => {
  const workers: FakeWorker[] = [];
  class FakeWorker {
    onmessage?: (event: { data: { id: number; points?: { x: number; y: number }[]; error?: string } }) => void;
    onerror?: () => void;
    request?: { id: number };
    terminated = false;
    constructor() { workers.push(this); }
    postMessage(request: { id: number }) { this.request = request; }
    terminate() { this.terminated = true; }
    respond(points: { x: number; y: number }[]) { this.onmessage?.({ data: { id: this.request!.id, points } }); }
  }
  const fakeCanvas = () => ({ width: 1, height: 1, getContext: () => ({ clearRect() {}, drawImage() {} }) });
  const replacements = { document: { baseURI: 'https://local.test/', createElement: fakeCanvas }, Worker: FakeWorker,
    createImageBitmap: async () => ({ close() {} }) };
  const originals = Object.fromEntries(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const tick = () => new Promise(resolve => setTimeout(resolve, 70));
  const tracker = new FaceTracker(), source = { width: 640, height: 480 } as CanvasImageSource;
  const points = [{ x: 0.2, y: 0.4 }];
  try {
    assert.deepEqual(tracker.preview(source, 'camera-a', 1), []);
    await tick(); assert.equal(workers.length, 1);
    const firstId = workers[0].request!.id;
    for (let i = 0; i < 20; i++) tracker.preview(source, 'camera-a', 1.01);
    assert.equal(workers[0].request!.id, firstId, 'Do not queue stale frames during inference');
    workers[0].respond(points); await tick();
    assert.deepEqual(tracker.preview(source, 'camera-a', 1.01), points, 'Current frame repaints after inference');
    assert.equal(currentFaceStatus(), 'tracking');
    assert.deepEqual(tracker.preview(source, 'camera-b', 1), [], 'Camera change cannot inherit an old face');
    await tick(); workers[0].respond([]); await tick();
    assert.deepEqual(tracker.preview(source, 'camera-b', 1), []);
    assert.equal(currentFaceStatus(), 'no-face');
    tracker.preview(source, 'camera-a', 2); await tick(); workers[0].respond(points); await tick();
    assert.deepEqual(tracker.preview(source, 'camera-a', 1.8), [], 'Backward seek discards previous geometry');
    await tick(); workers[0].respond(points); await tick();
    tracker.preview(source, 'camera-a', 2.25);
    assert.equal(tracker.previewGeometryStrength, 0, 'Expired geometry must not deform a frame');
    await tick(); workers[0].onerror?.(); await tick();
    assert.equal(currentFaceStatus(), 'error');
    tracker.retry(); tracker.preview(source, 'camera-a', 2.1); await tick();
    assert.equal(workers.length, 2); workers[1].respond(points); await tick();
    assert.equal(currentFaceStatus(), 'tracking');
    const broken = new FaceTracker();
    Object.defineProperty(globalThis, 'Worker', { configurable: true, value: class { constructor() { throw new Error('Worker blocked'); } } });
    await assert.rejects(broken.detect(source), /Worker blocked/);
    assert.equal(broken.status, 'error', 'Synchronous initialization failure offers retry');
    broken.dispose();
  } finally {
    tracker.dispose(); assert.ok(workers.every(worker => worker.terminated));
    for (const key of Object.keys(replacements)) {
      if (originals[key]) Object.defineProperty(globalThis, key, originals[key]!);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
  assert.equal(currentFaceStatus(), 'idle');
});
