import { CameraEffectsRenderer } from '../src/services/camera-effects/renderer';
import { ORIGINAL_CAMERA_EFFECTS } from '../shared/camera-effects';
import { observeVideoFrames, mediaFrameIdentity } from '../src/services/media-frame-identity';

/** Real decoded video clock, seek invalidation and paused repaint through the editor's renderer. */
export async function verifyCameraPlayback() {
  const video = document.createElement('video');
  video.src = 'portrait.mp4'; video.muted = true;
  const output = document.createElement('canvas'), raw = document.createElement('canvas');
  output.width = raw.width = output.height = raw.height = 384;
  document.querySelector('#frames')!.replaceChildren(video, output);
  const context = output.getContext('2d', { willReadFrequently: true })!;
  const original = raw.getContext('2d', { willReadFrequently: true })!;
  const effects = { ...ORIGINAL_CAMERA_EFFECTS, enabled: true, skinWhitening: .85 };
  const renderer = new CameraEffectsRenderer(), unobserve = observeVideoFrames(video);
  const sample = () => {
    original.drawImage(video, 0, 0, 384, 384);
    context.drawImage(renderer.render(video, effects), 0, 0, 384, 384);
    const a = original.getImageData(0, 0, 384, 384).data, b = context.getImageData(0, 0, 384, 384).data;
    let gain = 0;
    for (let i = 0; i < a.length; i += 4) gain += b[i] + b[i + 1] + b[i + 2] - a[i] - a[i + 1] - a[i + 2];
    return gain / (384 * 384 * 3);
  };
  try {
    await video.play();
    const samples: { time: number; gain: number }[] = [];
    while (video.currentTime < 4 && !video.ended) {
      await new Promise<void>(resolve => video.requestVideoFrameCallback(() => resolve()));
      samples.push({ time: video.currentTime, gain: sample() });
    }
    video.pause();
    const before = mediaFrameIdentity(video)?.token;
    await new Promise<void>(resolve => { video.addEventListener('seeked', () => resolve(), { once: true }); video.currentTime = 1; });
    const resetGain = sample();
    const reset = before !== mediaFrameIdentity(video)?.token;
    let pausedGain = 0;
    const waitingAt = performance.now();
    // Seek resets the graph; allow its explicit loading state, then require a stable exact frame.
    while (pausedGain <= .05 && performance.now() - waitingAt < 5000) {
      await new Promise(resolve => setTimeout(resolve, 100)); pausedGain = sample();
    }
    const pausedReadyMs = performance.now() - waitingAt;
    await new Promise(resolve => setTimeout(resolve, 600));
    const heldGain = sample();
    const firstEffectAt = samples.find(item => item.gain > .05)?.time ?? Infinity;
    const stable = samples.filter(item => item.time > Math.max(2, firstEffectAt + .3)).map(item => item.gain).sort((a, b) => a - b);
    const median = stable[Math.floor(stable.length / 2)];
    if (stable.length < 20 || median <= .05 || stable[0] < median * .6)
      throw new Error('Playback whitening dropped out: ' + JSON.stringify({ stable }));
    if (!reset || Math.abs(resetGain) > .01 || pausedGain <= .05 || Math.abs(pausedGain - heldGain) > .01)
      throw new Error('Seek/paused repaint failed: ' + JSON.stringify({ reset, resetGain, pausedGain, heldGain }));
    return { actualDecodedVideo: true, firstEffectAt, frames: samples.length, minGain: stable[0], medianGain: median,
      seekReset: reset, pausedReadyMs, pausedGain, heldGain, backend: renderer.backend };
  } finally { video.pause(); unobserve(); renderer.dispose(); video.removeAttribute('src'); video.load(); }
}
