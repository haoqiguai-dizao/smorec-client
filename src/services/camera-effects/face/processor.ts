import type { CameraEffects } from '../../../../shared/types';
import { EffectsGpu } from '../gpu';
import { context2d, makeCanvas, resizeCanvas, type EffectsCanvas } from '../canvas';
import { FACE_SHADER } from './shader';
import { applyFaceEffects } from './kernel';
import type { FaceGeometry } from './geometry';
import { FaceGpuUniforms } from './gpu-uniforms';

export class FaceProcessor {
  backend: 'gpu' | 'cpu' = 'cpu';
  private output = makeCanvas();
  private context = context2d(this.output);
  private cpu?: ImageData;
  private gpu?: EffectsGpu;
  private uniforms = new FaceGpuUniforms();
  constructor() { try { this.gpu = new EffectsGpu(FACE_SHADER, this.uniforms.configure); } catch { /* CPU preserves effects. */ } }
  render(source: EffectsCanvas, effects: CameraEffects, face: FaceGeometry): EffectsCanvas {
    this.uniforms.geometry = face;
    if (resizeCanvas(this.output, source.width, source.height)) this.cpu = undefined;
    let gpu: EffectsCanvas | null = null;
    try { gpu = this.gpu?.render(source, effects) ?? null; } catch { /* Preserve via CPU. */ }
    this.backend = gpu ? 'gpu' : 'cpu';
    if (gpu) { this.context.clearRect(0, 0, source.width, source.height); this.context.drawImage(gpu, 0, 0); }
    else {
      this.cpu ??= this.context.createImageData(source.width, source.height);
      applyFaceEffects(context2d(source).getImageData(0, 0, source.width, source.height), this.cpu, effects, face);
      this.context.putImageData(this.cpu, 0, 0);
    }
    return this.output;
  }
  dispose() { this.gpu?.dispose(); this.output.width = 1; this.output.height = 1; this.cpu = undefined; }
}
