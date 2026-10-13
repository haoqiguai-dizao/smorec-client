import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import type { CameraPreviewRenderer } from '../src/services/camera-effects/preview-renderer';
import type { markMediaFrame } from '../src/services/media-frame-identity';

test('paused preview refreshes completed landmarks before event listener order can return a stale cached image', async () => {
  const state = { revision: 0, rendered: 0 };
  const bundle = await build({ stdin: { contents: `export {CameraPreviewRenderer} from './src/services/camera-effects/preview-renderer';
    export {markMediaFrame} from './src/services/media-frame-identity';`, resolveDir: process.cwd() },
    bundle: true, write: false, platform: 'node', format: 'cjs', plugins: [{ name: 'preview-probe', setup(builder) {
      builder.onResolve({ filter: /^\.\/renderer$|^\.\/face\/tracker$/ }, args => ({ path: args.path, namespace: 'preview-probe' }));
      builder.onLoad({ filter: /.*/, namespace: 'preview-probe' }, args => ({ resolveDir: process.cwd(), contents: args.path === './renderer'
        ? `import {mediaFrameIdentity} from './src/services/media-frame-identity';
          export const cameraFrameIdentity=source=>mediaFrameIdentity(source);
          export class CameraEffectsRenderer { render(source){state.rendered++;return source;} dispose(){} }`
        : 'export const faceResultRevision=()=>state.revision;' }));
    } }] });
  const module = { exports: {} as { CameraPreviewRenderer: typeof CameraPreviewRenderer; markMediaFrame: typeof markMediaFrame } };
  new Function('require', 'module', 'exports', 'state', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports, state);
  const renderer = new module.exports.CameraPreviewRenderer();
  const source = { width: 640, height: 480 } as CanvasImageSource, token = {};
  const settings = { enabled: true, smoothing: .45, brightness: .45, intensity: .18, filter: 'natural' as const };
  const paint = () => renderer.render(source, settings, { width: 640, height: 480 }, 1);
  try {
    module.exports.markMediaFrame(source, token, 1);
    paint(); paint(); assert.equal(state.rendered, 1);
    state.revision++; paint(); assert.equal(state.rendered, 2, 'Completed inference repaints the same paused frame');
    paint(); assert.equal(state.rendered, 2);
    settings.brightness = .6; paint(); assert.equal(state.rendered, 3);
    module.exports.markMediaFrame(source, token, 2); paint(); assert.equal(state.rendered, 4);
  } finally { renderer.dispose(); }
});
