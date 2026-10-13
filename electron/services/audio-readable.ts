import type { Readable } from 'node:stream';

/** Byte-bounded pulling also prevents an in-flight Node read from enqueueing after browser cancellation. */
export function audioReadable(stream: Readable): ReadableStream<Uint8Array> {
  const iterator = stream[Symbol.asyncIterator](); let canceled = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next(); if (canceled) return;
        if (next.done) controller.close(); else controller.enqueue(next.value as Uint8Array);
      } catch (error) { if (!canceled) controller.error(error); }
    },
    cancel() { canceled = true; stream.destroy(); void iterator.return?.().catch(() => {}); },
  }, { highWaterMark: 64 * 1024, size: bytes => bytes.byteLength });
}
