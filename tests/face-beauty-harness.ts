import { FaceTracker } from '../src/services/camera-effects/face/tracker';
import { FaceProcessor } from '../src/services/camera-effects/face/processor';
import { faceGeometry } from '../src/services/camera-effects/face/geometry';
import { applyFaceEffects } from '../src/services/camera-effects/face/kernel';
import { CameraEffectsRenderer } from '../src/services/camera-effects/renderer';
import { BEAUTY_FIELDS, BEAUTY_ZERO } from '../shared/beauty';
import { ORIGINAL_CAMERA_EFFECTS } from '../shared/camera-effects';
import { verifyGpuPipeline } from './camera-gpu-pipeline-harness';

const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const canvas = (width: number, height: number) => { const c = document.createElement('canvas'); c.width = width; c.height = height; return c; };
async function portrait(name: string) {
  const img = new Image(); img.src = 'face-fixtures/' + name; await img.decode();
  const c = canvas(Math.round(img.width * 320 / img.height), 320); c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height); return c;
}
const data = (source: CanvasImageSource, width: number, height: number) => {
  const c = canvas(width, height), ctx = c.getContext('2d')!; ctx.drawImage(source, 0, 0); return ctx.getImageData(0, 0, width, height);
};
const effects = { ...ORIGINAL_CAMERA_EFFECTS, ...BEAUTY_ZERO, enabled: true };
Object.assign(window, { runFaceTests: async () => {
  const tracker = new FaceTracker(), processor = new FaceProcessor(), renderer = new CameraEffectsRenderer();
  const results: Record<string, unknown> = {}, images: Record<string, string> = {};
  try {
    for (const name of ['astronaut.png', 'grace_hopper.jpg']) {
      const source = await portrait(name), start = performance.now();
      const points = await tracker.detect(source), inference = performance.now() - start;
      assert(points.length === 478, 'Real model must return 478 landmarks: ' + name);
      const input = data(source, source.width, source.height), individual: Record<string, unknown> = {};
      for (const key of BEAUTY_FIELDS) {
        const values = { ...effects, [key]: 0.75 }, face = faceGeometry(points, source.width / source.height, values)!;
        assert(face, 'Face geometry valid');
        const gpu = data(processor.render(source, values, face), source.width, source.height);
        assert(processor.backend === 'gpu', 'Facial shader must compile and run on GPU');
        const cpu = new ImageData(source.width, source.height); applyFaceEffects(input, cpu, values, face);
        let max = 0, changed = 0, sum = 0;
        for (let i = 0; i < gpu.data.length; i++) {
          max = Math.max(max, Math.abs(gpu.data[i] - cpu.data[i]));
          sum += Math.abs(gpu.data[i] - cpu.data[i]);
          if (gpu.data[i] !== input.data[i]) changed++;
        }
        assert(max <= 3 && sum / gpu.data.length < 0.15, 'CPU/GPU face parity ' + key + ': ' + max);
        if (key !== 'teethWhitening' || face.mouthOpen > 0.1) assert(changed > 3, 'Individual control must affect real pixels: ' + key);
        if (key === 'teethWhitening' && face.mouthOpen === 0) assert(changed === 0, 'Closed lips must remain unchanged');
        individual[key] = { changed, maxDifference: max, meanDifference: sum / gpu.data.length };
      }
      const values = { ...effects, faceSlim: 0.45, eyeEnlarge: 0.3, jaw: 0.25, skinWhitening: 0.2, rosiness: 0.15, teethWhitening: 0.5, eyeBrightening: 0.25, smoothing: 0.65, brightness: 0.12 };
      await renderer.prepare(source, values);
      const processed = renderer.render(source, values);
      const comparison = canvas(source.width * 2, source.height), ctx = comparison.getContext('2d')!;
      ctx.drawImage(source, 0, 0); ctx.drawImage(processed, source.width, 0);
      images[name] = comparison.toDataURL('image/png');
      results[name] = { landmarks: points.length, inferenceMs: inference, individual, pipeline: await verifyGpuPipeline(source, points) };
      if (name === 'astronaut.png') {
        const performanceReport = [];
        for (const [width, height] of [[1280, 720], [1920, 1080], [3840, 2160]]) {
          const large = canvas(width, height); large.getContext('2d')!.drawImage(source, 0, 0, width, height);
          const timings = [];
          for (let i = 0; i < 9; i++) {
            const started = performance.now(); await renderer.prepare(large, values);
            data(renderer.render(large, values), width, height); // Include GPU synchronization and exact-frame inference.
            if (i) timings.push(performance.now() - started);
          }
          timings.sort((a, b) => a - b);
          performanceReport.push({ width, height, medianMs: timings[4], p95Ms: timings[7], samples: timings.length });
        }
        results.fullFramePerformance = performanceReport;
      }
      // Exact preparation is deterministic and independent of preceding images/cuts.
      await renderer.prepare(source, values);
      const first = data(renderer.render(source, values), source.width, source.height);
      const blank = canvas(source.width, source.height); blank.getContext('2d')!.fillRect(0, 0, blank.width, blank.height);
      await renderer.prepare(blank, values); renderer.render(blank, values);
      await renderer.prepare(source, values);
      const again = data(renderer.render(source, values), source.width, source.height);
      assert(first.data.every((v, i) => v === again.data[i]), 'Export frame remains deterministic across cuts');
    }
    const blank = canvas(320, 240); blank.getContext('2d')!.fillRect(0, 0, 320, 240);
    assert((await tracker.detect(blank)).length === 0, 'No-face frame must clear geometry');
    await renderer.prepare(blank, { ...effects, faceSlim: 1, teethWhitening: 1 });
    const output = data(renderer.render(blank, { ...effects, faceSlim: 1, teethWhitening: 1 }), 320, 240);
    assert(output.data.every((v, i) => v === (i % 4 === 3 ? 255 : 0)), 'No-face pixels unchanged');
    return { results, images, noFace: true, exactFramePreparation: true };
  } finally { tracker.dispose(); processor.dispose(); renderer.dispose(); }
} });
