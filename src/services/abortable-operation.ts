import { abortError } from './media';

/** Stop waiting without depending on a codec, IPC, or iterator honoring cancellation. */
export function abortableOperation<T>(operation: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener('abort', abort, { once: true });
    // Keep both handlers attached after cancellation so late failures remain handled.
    Promise.resolve(operation).then(value => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) reject(abortError()); else resolve(value);
    }, error => {
      signal.removeEventListener('abort', abort);
      reject(signal.aborted ? abortError() : error);
    });
    if (signal.aborted) { signal.removeEventListener('abort', abort); abort(); }
  });
}
