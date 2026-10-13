import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import type { useWebcamMedia } from '../src/hooks/useWebcamMedia';
import type { Project } from '../shared/types';

test('ordinary sync leaves a pending seek alone; explicit scrubbing supersedes it and observers are released', async () => {
  let cleanup: (() => void) | undefined, writes = 0, current = 0, canceled = false;
  const video = Object.assign(new EventTarget(), { duration: 10, seeking: true, src: '', currentSrc: '',
    pause() {}, load() {}, removeAttribute() {},
    requestVideoFrameCallback: () => 1, cancelVideoFrameCallback: () => { canceled = true; } });
  Object.defineProperty(video, 'currentTime', { get: () => current, set: value => { current = value; writes++; } });
  const bundle = await build({ entryPoints: ['src/hooks/useWebcamMedia.ts'], bundle: true, write: false,
    platform: 'node', format: 'cjs', plugins: [{ name: 'hook-probe', setup(builder) {
      builder.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'hook-probe' }));
      builder.onLoad({ filter: /.*/, namespace: 'hook-probe' }, () => ({ contents:
        'export const useRef=value=>({current:value});export const useCallback=fn=>fn;export const useEffect=fn=>register(fn());' }));
    } }] });
  const module = { exports: {} as { useWebcamMedia: typeof useWebcamMedia } };
  new Function('require', 'module', 'exports', 'register', 'document', bundle.outputFiles[0].text)(
    createRequire(import.meta.url), module, module.exports, (fn: () => void) => { cleanup = fn; }, { createElement: () => video });
  const project = { id: 'test', media: { camera: 'camera.mp4' }, camera: { offset: -.5 } } as Project;
  const webcam = module.exports.useWebcamMedia(project, () => {}, () => {}, () => 0);
  try {
    for (let tick = 0; tick < 30; tick++) webcam.sync(2 + tick / 60);
    assert.equal(writes, 0, 'Do not restart decoding an in-flight seek every tick');
    webcam.sync(4, true); assert.equal(writes, 1); assert.equal(current, 3.5);
    video.seeking = false; webcam.sync(4.05); assert.equal(writes, 1, 'Small clock drift does not seek');
    webcam.sync(5); assert.equal(writes, 2); assert.equal(current, 4.5);
    webcam.sync(0, true); assert.equal(current, 0, 'Negative offsets clamp before media start');
  } finally { cleanup?.(); }
  assert.equal(canceled, true); assert.equal(webcam.ref.current, null);
});
