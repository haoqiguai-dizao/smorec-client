import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForEncoderCapacity } from '../src/services/export-encoder-capacity';

class Encoder extends EventTarget {
  state = 'configured'; encodeQueueSize = 2;
  drain() { this.encodeQueueSize--; this.dispatchEvent(new Event('dequeue')); }
}
test('hardware capacity resumes on dequeue without requiring a flush or dropping a frame', async () => {
  const encoder = new Encoder(), controller = new AbortController();
  let resumed = false;
  const waiting = waitForEncoderCapacity(encoder as unknown as VideoEncoder, 2, controller.signal, () => null).then(() => { resumed = true; });
  await Promise.resolve(); assert.equal(resumed, false);
  encoder.drain(); await waiting; assert.equal(resumed, true);
});
test('a full queue is cancellable and observes encoder failures even without a dequeue event', async () => {
  const encoder = new Encoder(), controller = new AbortController();
  const waiting = waitForEncoderCapacity(encoder as unknown as VideoEncoder, 2, controller.signal, () => null);
  controller.abort(); await assert.rejects(waiting, { name: 'AbortError' });
  let failure: Error | null = null;
  const failed = waitForEncoderCapacity(encoder as unknown as VideoEncoder, 2, new AbortController().signal, () => failure);
  failure = new Error('Device lost'); await assert.rejects(failed, /Device lost/);
});
