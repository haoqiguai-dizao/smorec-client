import type { CameraEffects } from '../../../shared/types';
import { makeCanvas, resizeCanvas, sourceSize, type EffectsCanvas, type EffectsContext, context2d } from './canvas';
import { cameraPreviewSize } from './preview-budget';
import { CameraEffectsRenderer, cameraFrameIdentity } from './renderer';
import { hasFaceEffects } from '../../../shared/beauty';
import { mediaFrameIdentity, sameMediaFrame, type MediaFrameIdentity } from '../media-frame-identity';
import { faceResultRevision } from './face/tracker';

/** Display-only renderer. Neither the MediaRecorder track nor the export renderer passes through this class. */
export class CameraPreviewRenderer {
  private readonly effects = new CameraEffectsRenderer();
  private staging?: EffectsCanvas;
  private context?: EffectsContext;
  private cached?: { frame: MediaFrameIdentity; key: string; result: { width: number; height: number; source: CanvasImageSource } };
  get backend() { return this.effects.backend; }

  render(source: CanvasImageSource, values: CameraEffects, display: { width: number; height: number }, density: number) {
    const intrinsic = sourceSize(source), size = cameraPreviewSize(intrinsic, display, density);
    if (!size) return null;
    const frame = cameraFrameIdentity(source), key = JSON.stringify([size.width, size.height, values, faceResultRevision()]);
    const stable = !!mediaFrameIdentity(source) || typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement
      || typeof VideoFrame !== 'undefined' && source instanceof VideoFrame;
    if (stable && sameMediaFrame(this.cached?.frame, frame) && this.cached?.key === key) return this.cached.result;
    const processing = values.enabled && (values.smoothing || values.brightness || values.intensity || hasFaceEffects(values));
    let input = source;
    if (processing && (size.width !== intrinsic.width || size.height !== intrinsic.height)) {
      if (!this.staging) { this.staging = makeCanvas(); this.context = context2d(this.staging); }
      resizeCanvas(this.staging, size.width, size.height);
      this.context!.drawImage(source, 0, 0, size.width, size.height);
      input = this.staging;
    }
    const result = { ...size, source: this.effects.render(input, values, frame) };
    this.cached = stable ? { frame, key, result } : undefined;
    return result;
  }

  dispose() {
    this.cached = undefined;
    this.effects.dispose();
    if (this.staging) { this.staging.width = 1; this.staging.height = 1; }
    this.staging = undefined; this.context = undefined;
  }
}
