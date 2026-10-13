import type { CameraEffects } from '../../../shared/types';
import { context2d, makeCanvas, resizeCanvas, sourceSize, type EffectsCanvas, type EffectsContext } from './canvas';
import { EffectsGpu } from './gpu';
import { applyCameraEffects } from './kernel';
import { BEAUTY_FIELDS, beautyValue, hasFaceEffects } from '../../../shared/beauty';
import { FaceTracker, faceResultRevision } from './face/tracker';
import { faceGeometry, type FaceGeometry } from './face/geometry';
import { FaceProcessor } from './face/processor';
import { FaceGpuUniforms } from './face/gpu-uniforms';
import { FACE_TEXTURE_SHADER } from './face/shader';
import { FacePreparation } from './face/preparation';
import { mediaFrameIdentity, sameMediaFrame, type MediaFrameIdentity } from '../media-frame-identity';

const unit = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
export type CameraEffectsBackend = 'bypass' | 'gpu' | 'cpu';

/** Shared by preview/export. Output is reusable and stays valid until render/dispose is called again. */
export class CameraEffectsRenderer {
  private input?: EffectsCanvas;
  private output?: EffectsCanvas;
  private inputContext?: EffectsContext;
  private outputContext?: EffectsContext;
  private cpuOutput?: ImageData;
  private gpu?: EffectsGpu;
  private attemptedGpu = false;
  private warnedCpu = false;
  private disposed = false;
  private lastBackend: CameraEffectsBackend = 'bypass';
  private tracker?: FaceTracker;
  private face?: FaceProcessor;
  private uniforms = new FaceGpuUniforms();
  private preparation?: FacePreparation;
  private rendered?: { frame: MediaFrameIdentity; key: string; source: CanvasImageSource };
  /** Export waits for this exact frame; no preview history can leak across cuts. */
  async prepare(source: CanvasImageSource, effects?: CameraEffects, outputIndex?: number): Promise<void> {
    if (!hasFaceEffects(effects)) return;
    this.preparation ??= new FacePreparation(() => new FaceTracker());
    await this.preparation.prepare(source, outputIndex);
  }
  /** The last completed frame's path; preview may lower CPU cadence without resizing pixels. */
  get backend(): CameraEffectsBackend { return this.lastBackend; }

  render(source: CanvasImageSource, effects: CameraEffects, frame?: { token: unknown; time: number }): CanvasImageSource {
    if (this.disposed) throw new Error('摄像头画面处理器已释放');
    const values: CameraEffects = { ...effects, enabled: effects.enabled, smoothing: unit(effects.smoothing),
      brightness: unit(effects.brightness), intensity: unit(effects.intensity), filter: effects.filter };
    const facial = hasFaceEffects(values);
    // Keep the idle model warm during hold-to-compare/toggle; teardown still releases the worker.
    if (!values.enabled || !(values.smoothing || values.brightness || values.intensity || facial)) {
      this.rendered = undefined;
      this.lastBackend = 'bypass'; return source;
    }
    const { width, height } = sourceSize(source);
    // Preview landmarks can finish asynchronously for an unchanged video frame; its outer cache handles invalidation.
    const exactFrame = typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement ? undefined : mediaFrameIdentity(source);
    const key = JSON.stringify([width, height, values, facial ? faceResultRevision() : 0]);
    if (sameMediaFrame(this.rendered?.frame, exactFrame) && this.rendered?.key === key) return this.rendered.source;
    this.rendered = undefined;
    const remember = (result: CanvasImageSource) => {
      if (exactFrame) this.rendered = { frame: exactFrame, key, source: result };
      return result;
    };
    let geometry: FaceGeometry | undefined;
    let renderValues = values;
    if (facial) {
      const identity = frame ?? cameraFrameIdentity(source);
      const prepared = this.preparation?.points(source);
      const preview = !prepared;
      const tracker = this.tracker ??= new FaceTracker();
      const points = prepared ?? tracker.preview(source, identity.token, identity.time);
      const strength = preview ? tracker.previewStrength : 1;
      const geometryStrength = preview ? tracker.previewGeometryStrength : 1;
      const facialValues = strength === 1 && geometryStrength === 1 ? values : { ...values, ...Object.fromEntries(
        BEAUTY_FIELDS.map(field => [field, beautyValue(values[field])
          * (field === 'skinWhitening' || field === 'rosiness' ? strength : geometryStrength)])) };
      renderValues = facialValues;
      if (!exactFrame) this.preparation?.consumeUnstamped(source);
      geometry = faceGeometry(points, width / height, facialValues);
    }
    if (!this.output) { this.output = makeCanvas(); this.outputContext = context2d(this.output); }
    if (resizeCanvas(this.output, width, height)) this.cpuOutput = undefined;
    const output = this.outputContext!;
    if (!this.attemptedGpu) {
      this.attemptedGpu = true;
      try { this.gpu = new EffectsGpu(); } catch { this.warnCpu(); }
    }
    try {
      this.uniforms.geometry = geometry ?? undefined;
      const direct = typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement
        || typeof OffscreenCanvas !== 'undefined' && source instanceof OffscreenCanvas;
      // CanvasSink pixels are normalized already; other media keep the existing crop/orientation conversion.
      const processed = this.gpu?.render(direct ? source : this.stage(source, width, height), renderValues, geometry
        ? { shader: FACE_TEXTURE_SHADER, configure: this.uniforms.configure } : undefined);
      if (processed) {
        // Copy synchronously before WebGL's non-preserved drawing buffer can be cleared.
        output.clearRect(0, 0, width, height); output.drawImage(processed, 0, 0);
        this.lastBackend = 'gpu';
        return remember(this.output);
      }
    } catch { /* Preserve the requested effects with the identical CPU kernel below. */ }
    this.warnCpu();
    this.stage(source, width, height);
    const input = this.inputContext!;
    if (geometry) {
      this.face ??= new FaceProcessor();
      const shaped = this.face.render(this.input!, renderValues, geometry);
      input.clearRect(0, 0, width, height); input.drawImage(shaped, 0, 0);
    }
    this.cpuOutput ??= output.createImageData(width, height);
    applyCameraEffects(input.getImageData(0, 0, width, height), this.cpuOutput, renderValues);
    output.putImageData(this.cpuOutput, 0, 0);
    this.lastBackend = 'cpu';
    return remember(this.output);
  }
  private stage(source: CanvasImageSource, width: number, height: number): EffectsCanvas {
    if (!this.input) { this.input = makeCanvas(); this.inputContext = context2d(this.input); }
    resizeCanvas(this.input, width, height);
    this.inputContext!.clearRect(0, 0, width, height);
    this.inputContext!.drawImage(source, 0, 0, width, height);
    return this.input;
  }
  private warnCpu(): void {
    if (this.warnedCpu) return;
    this.warnedCpu = true;
    console.warn('摄像头画面效果已切换为 CPU 处理，效果参数保持不变。');
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.gpu?.dispose(); this.gpu = undefined;
    this.tracker?.dispose(); this.face?.dispose(); this.preparation?.dispose();
    this.rendered = undefined;
    if (this.input) { this.input.width = 1; this.input.height = 1; }
    if (this.output) { this.output.width = 1; this.output.height = 1; }
    this.input = undefined; this.output = undefined; this.cpuOutput = undefined;
    this.inputContext = undefined; this.outputContext = undefined;
  }
}

export function cameraFrameIdentity(source: CanvasImageSource): { token: unknown; time: number } {
  const stamped = mediaFrameIdentity(source);
  if (stamped) return stamped;
  if (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement)
    return { token: source.srcObject ?? source.currentSrc ?? source, time: source.currentTime };
  return { token: source, time: typeof VideoFrame !== 'undefined' && source instanceof VideoFrame ? source.timestamp / 1e6 : performance.now() / 1000 };
}
