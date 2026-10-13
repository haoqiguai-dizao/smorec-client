import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import type { CameraEffectsRenderer } from '../src/services/camera-effects/renderer';
import type { markMediaFrame } from '../src/services/media-frame-identity';

test('future preparation cannot replace current landmarks, including an intervening frame without effects', async () => {
  const state = { detected: [] as number[], rendered: [] as number[] };
  const bundled = await build({ stdin: { resolveDir: process.cwd(), contents: `
    export { CameraEffectsRenderer } from './src/services/camera-effects/renderer';
    export { markMediaFrame } from './src/services/media-frame-identity';` },
    bundle: true, write: false, platform: 'node', format: 'cjs', plugins: [{ name: 'face-lookahead', setup(builder) {
      builder.onResolve({ filter: /^\.\/gpu$|^\.\/face\/(tracker|processor|geometry)$/ }, args => ({ path: args.path, namespace: 'face-lookahead' }));
      builder.onLoad({ filter: /.*/, namespace: 'face-lookahead' }, ({ path }) => ({ contents:
        path.endsWith('/tracker') ? `export const faceResultRevision = () => 0; export class FaceTracker {
          async detect(source) { state.detected.push(source.time); return [{x:source.time,y:0}]; }
          preview() { throw Error('Exact export must never use preview landmarks'); } dispose() {} }`
          : path.endsWith('/geometry') ? 'export const faceGeometry = points => {state.rendered.push(points[0].x);return points;};'
            : path.endsWith('/processor') ? `export class FaceProcessor {
              backend='gpu'; render(source, effects, geometry) { state.rendered.push(geometry[0].x); return source; } dispose() {} }`
              : 'export class EffectsGpu { render(source) { return source; } dispose() {} }' }));
    } }] });
  const canvas = (time = -1) => ({ width: 10, height: 10, time, getContext: () => ({ drawImage() {}, clearRect() {} }) });
  const module = { exports: {} as { CameraEffectsRenderer: typeof CameraEffectsRenderer; markMediaFrame: typeof markMediaFrame } };
  new Function('require', 'module', 'exports', 'state', 'document', bundled.outputFiles[0].text)(
    createRequire(import.meta.url), module, module.exports, state, { createElement: () => canvas() });
  const renderer = new module.exports.CameraEffectsRenderer(), token = {};
  const first = canvas(1) as unknown as CanvasImageSource, next = canvas(2) as unknown as CanvasImageSource;
  module.exports.markMediaFrame(first, token, 1); module.exports.markMediaFrame(next, token, 2);
  const effects = { enabled: true, smoothing: .4, brightness: 0, intensity: 0, filter: 'natural' as const, faceSlim: .3 };
  try {
    await renderer.prepare(first, effects); await renderer.prepare(next, effects);
    renderer.render(first, effects);
    renderer.render(first, { ...effects, enabled: false });
    renderer.render(next, effects);
    assert.deepEqual(state.rendered, [1, 2]);
    await renderer.prepare(next, effects);
    assert.deepEqual(state.detected, [1, 2], 'Identical source frames still reuse inference');
  } finally { renderer.dispose(); }
});
