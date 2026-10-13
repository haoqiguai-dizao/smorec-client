import { abortError } from './media';

/** Bound queued raw frames without flushing the hardware encoder's pipeline after every batch. */
export function waitForEncoderCapacity(encoder: VideoEncoder, limit: number, signal: AbortSignal,
  failure: () => Error | null): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  const error = failure();
  if (error) return Promise.reject(error);
  if (encoder.encodeQueueSize < limit) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearInterval(timer); encoder.removeEventListener('dequeue', check); signal.removeEventListener('abort', check);
    };
    const check = () => {
      const error = failure();
      if (signal.aborted || error || encoder.state === 'closed') {
        cleanup(); reject(signal.aborted ? abortError() : error ?? new Error('视频编码器已关闭'));
      } else if (encoder.encodeQueueSize < limit) { cleanup(); resolve(); }
    };
    // A codec error callback may close the encoder without a dequeue event.
    const timer = setInterval(check, 50);
    encoder.addEventListener('dequeue', check); signal.addEventListener('abort', check, { once: true }); check();
  });
}
