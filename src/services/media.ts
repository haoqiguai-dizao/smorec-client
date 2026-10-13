export function abortError() { return new DOMException('导出已取消', 'AbortError'); }

export function waitForMedia(element: HTMLMediaElement, event: string, signal?: AbortSignal, timeout = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer); element.removeEventListener(event, success);
      element.removeEventListener('error', error); signal?.removeEventListener('abort', abort);
    };
    const success = () => { cleanup(); resolve(); };
    const error = () => { cleanup(); reject(new Error(element.error?.message || '无法读取视频文件')); };
    const abort = () => { cleanup(); reject(abortError()); };
    element.addEventListener(event, success, { once: true });
    element.addEventListener('error', error, { once: true });
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { cleanup(); reject(new Error('读取视频超时，请检查原始文件')); }, timeout);
    if (signal?.aborted) abort();
  });
}

export async function seekVideo(video: HTMLVideoElement, time: number, signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
  const target = Math.max(0, Math.min(time, Math.max(0, video.duration - 0.001)));
  if (Math.abs(video.currentTime - target) < 0.0001 && video.readyState >= 2) return;
  const ready = waitForMedia(video, 'seeked', signal);
  video.currentTime = target;
  await ready;
}
