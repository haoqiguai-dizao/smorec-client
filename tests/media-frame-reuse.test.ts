import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { markMediaFrame, sameMediaFrame, mediaFrameIdentity, observeVideoFrames } from '../src/services/media-frame-identity';

test('pooled canvas identity includes the source and actual decoded timestamp', () => {
  const canvas = {}, first = {}, second = {};
  markMediaFrame(canvas, first, 1); const initial = mediaFrameIdentity(canvas);
  markMediaFrame(canvas, first, 1); assert.equal(sameMediaFrame(initial, mediaFrameIdentity(canvas)), true);
  markMediaFrame(canvas, first, 2); assert.equal(sameMediaFrame(initial, mediaFrameIdentity(canvas)), false);
  markMediaFrame(canvas, second, 1); assert.equal(sameMediaFrame(initial, mediaFrameIdentity(canvas)), false);
  markMediaFrame(canvas, first, NaN); assert.equal(mediaFrameIdentity(canvas), undefined);
});

test('even a small forward seek invalidates video tracking identity', () => {
  let next!: VideoFrameRequestCallback;
  const events = new EventTarget();
  const video = Object.assign(events, { currentSrc: 'camera.mp4', src: 'camera.mp4',
    requestVideoFrameCallback: (callback: VideoFrameRequestCallback) => { next = callback; return 1; },
    cancelVideoFrameCallback: () => {} }) as unknown as HTMLVideoElement;
  const stop = observeVideoFrames(video);
  const frame = (time: number) => next(0, { mediaTime: time } as VideoFrameCallbackMetadata);
  try {
    frame(1); const first = mediaFrameIdentity(video)!;
    frame(1.03); assert.equal(mediaFrameIdentity(video)!.token, first.token);
    events.dispatchEvent(new Event('seeking'));
    assert.equal(mediaFrameIdentity(video), undefined);
    frame(1.08); assert.notEqual(mediaFrameIdentity(video)!.token, first.token);
  } finally { stop(); }
});

test('export reuses exact-frame inference and effects, invalidates edits, next frames and new sources', async () => {
  const state = { inference: 0, effects: 0 };
  const bundled = await build({ stdin: { contents: `export {CameraEffectsRenderer} from './src/services/camera-effects/renderer';
    export {markMediaFrame} from './src/services/media-frame-identity';`, resolveDir: process.cwd() },
    bundle: true, write: false, platform: 'node', format: 'cjs', plugins: [{ name: 'effects-probe', setup(builder) {
      builder.onResolve({ filter: /^\.\/gpu$|^\.\/face\/tracker$/ }, args => ({ path: args.path, namespace: 'effects-probe' }));
      builder.onLoad({ filter: /.*/, namespace: 'effects-probe' }, args => ({ contents: args.path === './gpu'
        ? 'export class EffectsGpu { render(source) { state.effects++; return source; } dispose() {} }'
        : 'export const faceResultRevision=()=>0; export class FaceTracker { async detect(){state.inference++;return [];} preview(){throw new Error("Export cannot use preview landmarks");} dispose(){} }' }));
    } }] });
  const fakeCanvas = () => ({ width: 10, height: 10, getContext: () => ({ drawImage() {}, clearRect() {} }) });
  const module = { exports: {} as { CameraEffectsRenderer: typeof import('../src/services/camera-effects/renderer').CameraEffectsRenderer; markMediaFrame: typeof markMediaFrame } };
  new Function('require', 'module', 'exports', 'state', 'document', bundled.outputFiles[0].text)(
    createRequire(import.meta.url), module, module.exports, state, { createElement: fakeCanvas });
  const renderer = new module.exports.CameraEffectsRenderer(), source = fakeCanvas() as unknown as CanvasImageSource;
  const token = {}, effects = { enabled: true, smoothing: .45, brightness: .45, intensity: .18, filter: 'natural' as const, skinWhitening: .04 };
  try {
    module.exports.markMediaFrame(source, token, 1);
    for (let repeat = 0; repeat < 3; repeat++) { await renderer.prepare(source, effects); renderer.render(source, effects); }
    assert.deepEqual(state, { inference: 1, effects: 1 });
    const alternate = fakeCanvas() as unknown as CanvasImageSource;
    module.exports.markMediaFrame(alternate, token, 1);
    await renderer.prepare(alternate, effects); renderer.render(alternate, effects);
    assert.deepEqual(state, { inference: 1, effects: 1 }, 'The next pool slot with identical source/time must reuse landmarks and effects');
    const edited = { ...effects, brightness: .6 };
    await renderer.prepare(alternate, edited); renderer.render(alternate, edited);
    assert.deepEqual(state, { inference: 1, effects: 2 }, 'An effect edit must repaint but does not need new landmarks');
    module.exports.markMediaFrame(source, token, 2);
    await renderer.prepare(source, edited); renderer.render(source, edited);
    assert.deepEqual(state, { inference: 2, effects: 3 });
    module.exports.markMediaFrame(source, {}, 2);
    await renderer.prepare(source, edited); renderer.render(source, edited);
    assert.deepEqual(state, { inference: 3, effects: 4 }, 'Same timestamp from another source must not reuse pixels');
    module.exports.markMediaFrame(source, token, NaN);
    for (let repeat = 0; repeat < 2; repeat++) { await renderer.prepare(source, effects); renderer.render(source, effects); }
    assert.deepEqual(state, { inference: 5, effects: 6 }, 'Unstamped mutable canvases cannot be cached');
  } finally { renderer.dispose(); }
});
