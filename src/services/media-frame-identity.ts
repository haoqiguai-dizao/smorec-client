export interface MediaFrameIdentity { token: unknown; time: number }
const identities = new WeakMap<object, MediaFrameIdentity>();

/** Pooled canvases change pixels without changing object identity. Stamp the decoded source frame. */
export function markMediaFrame(source: object, token: unknown, time: number): void {
  if (Number.isFinite(time)) identities.set(source, { token, time });
  else identities.delete(source);
}
export function mediaFrameIdentity(source: object): MediaFrameIdentity | undefined { return identities.get(source); }
export function sameMediaFrame(a?: MediaFrameIdentity, b?: MediaFrameIdentity): boolean {
  return !!a && !!b && a.token === b.token && a.time === b.time;
}

/** Media currentTime advances between decoded frames; effects need the frame's presentation timestamp. */
export function observeVideoFrames(video: HTMLVideoElement): () => void {
  if (typeof video.requestVideoFrameCallback !== 'function') return () => {};
  let callback = 0, stopped = false;
  let source = video.currentSrc || video.src, token = {};
  const update: VideoFrameRequestCallback = (_now, metadata) => {
    if (stopped) return;
    const nextSource = video.currentSrc || video.src;
    if (source !== nextSource) { source = nextSource; token = {}; }
    markMediaFrame(video, token, metadata.mediaTime);
    callback = video.requestVideoFrameCallback(update);
  };
  // Even a small forward seek crosses temporal tracking history, not just the pixel cache.
  const invalidate = () => { token = {}; markMediaFrame(video, video, NaN); };
  video.addEventListener('seeking', invalidate);
  video.addEventListener('emptied', invalidate);
  callback = video.requestVideoFrameCallback(update);
  return () => {
    stopped = true; video.cancelVideoFrameCallback(callback);
    video.removeEventListener('seeking', invalidate); video.removeEventListener('emptied', invalidate); invalidate();
  };
}
