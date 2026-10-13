import { EffectsGpu } from '../src/services/camera-effects/gpu';
import { FaceProcessor } from '../src/services/camera-effects/face/processor';
import { FaceGpuUniforms } from '../src/services/camera-effects/face/gpu-uniforms';
import { FACE_TEXTURE_SHADER } from '../src/services/camera-effects/face/shader';
import { faceGeometry, type Point } from '../src/services/camera-effects/face/geometry';
import { ORIGINAL_CAMERA_EFFECTS } from '../shared/camera-effects';

const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const canvas = (width: number, height: number) => { const result = document.createElement('canvas'); result.width = width; result.height = height; return result; };
const pixels = (source: CanvasImageSource, width: number, height: number) => {
  const target = canvas(width, height), context = target.getContext('2d')!;
  context.drawImage(source, 0, 0); return context.getImageData(0, 0, width, height).data;
};

/** Compare the new texture chain to the previous two-WebGL-context/canvas chain. */
export async function verifyGpuPipeline(portrait: HTMLCanvasElement, points: Point[]) {
  const legacyFace = new FaceProcessor(), legacyColor = new EffectsGpu(), combined = new EffectsGpu(), uniforms = new FaceGpuUniforms();
  const values = { ...ORIGINAL_CAMERA_EFFECTS, enabled: true, faceSlim: .45, eyeEnlarge: .3, skinWhitening: .2,
    teethWhitening: .5, smoothing: .65, brightness: .12, filter: 'warm' as const, intensity: .4 };
  const cases = [];
  try {
    for (const [name, width, height, alpha, facial] of [
      ['opaque', 320, 320, false, true], ['alpha', 320, 320, true, true],
      ['resize', 640, 360, false, true], ['no-face-after-face', 640, 360, false, false],
      ['face-after-no-face', 320, 320, false, true],
    ] as const) {
      const source = canvas(width, height), input = canvas(width, height), context = input.getContext('2d')!;
      const ctx = source.getContext('2d')!; ctx.drawImage(portrait, 0, 0, width, height);
      if (alpha) {
        const image = ctx.getImageData(0, 0, width, height);
        for (let i = 3; i < image.data.length; i += 4) image.data[i] = Math.floor((i / 4 % width) / width * 255);
        ctx.putImageData(image, 0, 0);
      }
      context.drawImage(source, 0, 0);
      const geometry = facial ? faceGeometry(points, width / height, values) : undefined;
      if (geometry) {
        const shaped = legacyFace.render(input, values, geometry);
        assert(legacyFace.backend === 'gpu', 'Reference face shader uses GPU');
        context.clearRect(0, 0, width, height); context.drawImage(shaped, 0, 0);
      }
      const legacy = legacyColor.render(input, values); assert(legacy, 'Reference color shader uses GPU');
      const before = pixels(legacy!, width, height);
      uniforms.geometry = geometry;
      const result = combined.render(source, values, geometry ? { shader: FACE_TEXTURE_SHADER, configure: uniforms.configure } : undefined);
      assert(result, 'Shared texture shader uses GPU');
      const after = pixels(result!, width, height);
      let sum = 0, max = 0, alphaMax = 0;
      for (let i = 0; i < before.length; i++) {
        const diff = Math.abs(before[i] - after[i]); sum += diff; max = Math.max(max, diff);
        if (i % 4 === 3) alphaMax = Math.max(alphaMax, diff);
      }
      const mean = sum / before.length;
      assert(mean < (alpha ? .5 : .2) && (alpha || max <= 3) && alphaMax <= 1,
        `Texture chain parity ${name}: mean=${mean}, max=${max}, alpha=${alphaMax}`);
      cases.push({ name, width, height, mean, max, alphaMax });
    }
    const gl = combined.canvas.getContext('webgl') as WebGLRenderingContext, extension = gl.getExtension('WEBGL_lose_context');
    assert(extension, 'Context-loss verification supported');
    const lost = new Promise<void>(resolve => combined.canvas.addEventListener('webglcontextlost', () => resolve(), { once: true }));
    extension!.loseContext(); await lost;
    assert(combined.render(portrait, values) === null, 'Lost context returns fallback signal');
    await new Promise(resolve => setTimeout(resolve, 50)); // Finish lost-event dispatch before requesting restoration.
    const restored = new Promise<void>(resolve => combined.canvas.addEventListener('webglcontextrestored', () => resolve(), { once: true }));
    extension!.restoreContext(); await restored;
    uniforms.geometry = faceGeometry(points, 1, values);
    assert(combined.render(portrait, values, { shader: FACE_TEXTURE_SHADER, configure: uniforms.configure }), 'Recreate texture chain after restoration');
    return { cases, contextRestored: true };
  } finally { combined.dispose(); legacyFace.dispose(); legacyColor.dispose(); }
}
