import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { cameraEffectsAt, DEFAULT_CAMERA_EFFECTS, ORIGINAL_CAMERA_EFFECTS } from '../shared/camera-effects';
import { webcamStyleAt } from '../shared/camera-layout';
import { outputToSourceTime } from '../shared/timeline';
import { DEFAULT_STYLE } from '../shared/constants';
import type { CameraEffectKeyframe, CameraEffects, Project, RecordingOptions, RecordingState, WebcamStyle } from '../shared/types';
import { parseCameraEffects, parseCameraEffectsPatch, parseProject, recordingOptions } from '../electron/services/validation';
import { parseOverlayControl } from '../electron/services/recording-overlay/validation';
import { LiveRecordingControls } from '../electron/services/live-recording-controls';
import type { NativeClient } from '../electron/services/native-client';
import type { ProjectStore } from '../electron/services/projects';

const cameraId = 'd92c2b07-c9e0-41b0-93a6-c15c897f530b';
const options: RecordingOptions = { sourceId: 'screen:1', fps: 30, microphone: false, systemAudio: false, cameraSessionId: cameraId };
const natural: CameraEffects = { ...DEFAULT_CAMERA_EFFECTS };
const warm: CameraEffects = { enabled: true, smoothing: .35, brightness: .2, filter: 'warm', intensity: .4 };
const mono: CameraEffects = { ...warm, filter: 'mono', intensity: .5 };
const originalStyle: WebcamStyle = { offset: .5, enabled: true, position: 'bottom-right', size: .22,
  mirror: true, shape: 'circle', shrinkOnZoom: false };
const timeline = (): CameraEffectKeyframe[] => [{ t: 0, effects: { ...natural } }, { t: 2, effects: { ...warm } }, { t: 4, effects: { ...mono } }];
function project(camera: WebcamStyle = originalStyle): Project {
  return { id: cameraId, name: 'Camera effects', createdAt: '2026-09-07T00:00:00.000Z', duration: 5,
    width: 1280, height: 720, fps: 30, media: { screen: 'screen.mp4', camera: 'camera.webm' }, camera,
    cursor: [], clips: [{ id: 'clip', start: 0, end: 5 }], zooms: [], style: { ...DEFAULT_STYLE }, audio: { system: 1, microphone: 1 } };
}

test('legacy camera projects remain original and do not acquire effects fields', () => {
  const parsed = parseProject(project());
  assert.deepEqual(parsed.camera, originalStyle);
  assert.equal(webcamStyleAt(originalStyle, 3), originalStyle);
  assert.equal(Object.hasOwn(webcamStyleAt(originalStyle, 3), 'effects'), false);
  assert.deepEqual(cameraEffectsAt(originalStyle, 3), ORIGINAL_CAMERA_EFFECTS);
  assert.equal(recordingOptions(options).cameraEffects, undefined);
});

test('recording, overlay and project effects reject non-finite numbers, wrong switches and unknown filters', () => {
  const invalid: Record<string, unknown>[] = [
    { enabled: 1 }, { enabled: 'true' }, { enabled: null }, { filter: 'beauty' }, { filter: null },
    ...['smoothing', 'brightness', 'intensity'].flatMap(key => [NaN, Infinity, -Infinity, -.01, 1.01, '0.2', null]
      .map(value => ({ [key]: value }))),
  ];
  assert.deepEqual(parseCameraEffects(natural), natural);
  for (const patch of invalid) {
    const effects = { ...natural, ...patch };
    assert.throws(() => recordingOptions({ ...options, cameraEffects: effects }));
    assert.throws(() => parseOverlayControl({ type: 'camera-effects', value: effects }));
    assert.throws(() => parseProject(project({ ...originalStyle, effects: effects as CameraEffects })));
    assert.throws(() => parseProject(project({ ...originalStyle, effectKeyframes: [{ t: 0, effects: effects as CameraEffects }] })));
  }
  for (const value of [null, [], false, 'natural']) assert.throws(() => parseCameraEffects(value));
  assert.throws(() => parseProject(project({ ...originalStyle, useRecordedEffects: 1 as unknown as boolean })));
});

test('effect timeline validation preserves sorted step changes and rejects invalid source timestamps', () => {
  const camera = { ...originalStyle, effects: natural, effectKeyframes: timeline(), useRecordedEffects: true };
  assert.deepEqual(parseProject(project(camera)).camera, camera);
  for (const t of [NaN, Infinity, -.01, 5.01]) {
    assert.throws(() => parseProject(project({ ...camera, effectKeyframes: [{ t, effects: natural }] })));
  }
  assert.throws(() => parseProject(project({ ...camera, effectKeyframes: timeline().reverse() })));
  assert.throws(() => parseProject(project({ ...camera, effectKeyframes: {} as CameraEffectKeyframe[] })));
});

test('effect patches accept only nonempty supported fields and preserve explicit false and zero', () => {
  for (const patch of [natural, { filter: 'mono' }, { intensity: 1 }, { enabled: false, smoothing: 0, brightness: 0 }]) {
    assert.deepEqual(parseCameraEffectsPatch(patch), patch);
    assert.deepEqual(parseOverlayControl({ type: 'camera-effects', value: patch }), { type: 'camera-effects', value: patch });
    assert.notEqual(parseCameraEffectsPatch(patch), patch, 'The parsed patch cannot retain the caller object');
  }
  const invalid = [undefined, null, [], false, 'mono', {}, { unknown: 1 }, { ...natural, unknown: 1 },
    { enabled: undefined }, { enabled: 'false' }, { filter: 'beauty' }, { filter: 1 }, { [Symbol('unknown')]: 1 },
    ...['smoothing', 'brightness', 'intensity'].flatMap(key => [NaN, Infinity, -Infinity, -.01, 1.01, '1', null, undefined]
      .map(value => ({ [key]: value })))];
  for (const patch of invalid) {
    assert.throws(() => parseCameraEffectsPatch(patch));
    assert.throws(() => parseOverlayControl({ type: 'camera-effects', value: patch }));
  }
});

test('rapid effect patches merge with authoritative live state instead of losing earlier field changes', async context => {
  let now = 1000, changed = 0, nativeCalls = 0;
  context.mock.method(Date, 'now', () => now);
  const native = { request: async () => { nativeCalls++; throw new Error('Effects must not restart capture'); } } as unknown as NativeClient;
  const controls = new LiveRecordingControls(native, () => ({ status: 'recording' }), () => { changed++; });
  controls.reset({ ...options, cameraEffects: natural }); controls.start(now);
  now = 1500;
  const filterChange = controls.control(parseOverlayControl({ type: 'camera-effects', value: { filter: 'mono' } }));
  now = 1510;
  const intensityChange = controls.control(parseOverlayControl({ type: 'camera-effects', value: { intensity: 1 } }));
  await Promise.all([filterChange, intensityChange]);
  const expected = { ...natural, filter: 'mono', intensity: 1 };
  assert.deepEqual(controls.snapshot().cameraEffects, expected);
  assert.deepEqual(controls.effectsKeyframes(1), [{ t: 0, effects: natural }, { t: .51, effects: expected }]);
  const before = controls.snapshot(), frames = controls.effectsKeyframes(1);
  for (const patch of [{}, { unknown: 1 }, { intensity: NaN }, { filter: 'invalid' }, { enabled: 1 }]) {
    await assert.rejects(controls.control({ type: 'camera-effects', value: patch as Partial<CameraEffects> }));
    assert.deepEqual(controls.snapshot(), before, 'Invalid patches must not partially change the live settings');
    assert.deepEqual(controls.effectsKeyframes(1), frames, 'Invalid patches cannot create effect keyframes');
  }
  assert.equal(changed, 2);
  await controls.control({ type: 'camera-effects', value: { enabled: false, brightness: 0 } });
  assert.deepEqual(controls.snapshot().cameraEffects, { ...expected, enabled: false, brightness: 0 });
  await controls.control({ type: 'camera-effects', value: warm });
  assert.deepEqual(controls.snapshot().cameraEffects, warm, 'Existing full-object actions remain supported');
  assert.equal(nativeCalls, 0);
});

test('effects use source time across cuts and backward seeks, independently from manual layout', () => {
  const camera: WebcamStyle = { ...originalStyle, effects: natural, effectKeyframes: timeline(), useRecordedEffects: true,
    useRecordedLayout: false, shape: 'rounded' };
  assert.deepEqual(webcamStyleAt(camera, 1.999).effects, natural);
  assert.deepEqual(webcamStyleAt(camera, 2).effects, warm);
  assert.deepEqual(webcamStyleAt(camera, 4.9).effects, mono);
  assert.deepEqual(webcamStyleAt(camera, .2).effects, natural);
  assert.equal(webcamStyleAt(camera, 3).shape, 'rounded');
  const clips = [{ id: 'later', start: 4, end: 5 }, { id: 'earlier', start: 0, end: 2 }];
  assert.deepEqual(webcamStyleAt(camera, outputToSourceTime(clips, .3)).effects, mono);
  assert.deepEqual(webcamStyleAt(camera, outputToSourceTime(clips, 1.3)).effects, natural);
  const manualEffects: WebcamStyle = { ...camera, effects: { ...ORIGINAL_CAMERA_EFFECTS }, useRecordedEffects: false,
    useRecordedLayout: true, keyframes: [{ t: 0, x: .2, y: .3, size: .3, shape: 'circle', mirror: false, visible: true }] };
  const resolved = webcamStyleAt(manualEffects, 4);
  assert.deepEqual(resolved.effects, ORIGINAL_CAMERA_EFFECTS);
  assert.equal(resolved.shape, 'circle');
  assert.deepEqual(resolved.placement, { x: .2, y: .3 });
});

test('live effects update immediately without native calls and save detached, clipped source-time keyframes', async context => {
  let now = 1000, status: RecordingState['status'] = 'recording', changed = 0, nativeCalls = 0;
  context.mock.method(Date, 'now', () => now);
  const native = { request: async () => { nativeCalls++; throw new Error('Effects must not call native or touch camera capture'); } } as unknown as NativeClient;
  const controls = new LiveRecordingControls(native, () => ({ status }), () => { changed++; });
  const input = { ...natural };
  controls.reset({ ...options, cameraEffects: input });
  input.smoothing = .99;
  assert.deepEqual(controls.snapshot().cameraEffects, natural);
  controls.start(1000);
  now = 1500;
  const selected = { ...warm };
  await controls.control({ type: 'camera-effects', value: selected });
  selected.brightness = .99;
  assert.deepEqual(controls.snapshot().cameraEffects, warm);
  now = 1650;
  await controls.control({ type: 'camera-size', value: .3 });
  assert.equal(controls.effectsKeyframes(10).length, 2, 'Layout changes do not add effect keyframes');
  now = 1700;
  await controls.control({ type: 'camera-effects', value: mono });
  const frames = controls.effectsKeyframes(.55);
  assert.deepEqual(frames, [{ t: 0, effects: natural }, { t: .5, effects: warm }]);
  frames[0].effects.smoothing = .91;
  controls.snapshot().cameraEffects!.brightness = .92;
  assert.deepEqual(controls.effectsKeyframes(.01), [{ t: 0, effects: natural }]);
  assert.deepEqual(controls.snapshot().cameraEffects, mono);
  now = 1200;
  await controls.control({ type: 'camera-effects', value: { ...ORIGINAL_CAMERA_EFFECTS } });
  assert.equal(controls.effectsKeyframes(10).at(-1)?.t, .7, 'Clock adjustments cannot reverse recorded effect time');
  assert.equal(nativeCalls, 0);
  assert.equal(changed, 4);
  status = 'stopping';
  await assert.rejects(controls.control({ type: 'camera-effects', value: natural }));
  status = 'recording'; controls.cameraUnavailable();
  await assert.rejects(controls.control({ type: 'camera-effects', value: natural }));
  controls.reset(options); controls.start(1000);
  assert.deepEqual(controls.effectsKeyframes(1), [{ t: 0, effects: ORIGINAL_CAMERA_EFFECTS }]);
  await assert.rejects(controls.control({ type: 'camera-effects', value: { ...natural, intensity: NaN } }));
});

test('continuous 20ms effect dragging retains bounded intermediate source-time changes and the initial frame', async context => {
  let now = 1000;
  context.mock.method(Date, 'now', () => now);
  const native = { request: async () => { throw new Error('Effects do not use native capture'); } } as unknown as NativeClient;
  const controls = new LiveRecordingControls(native, () => ({ status: 'recording' }), () => {});
  controls.reset({ ...options, cameraEffects: natural }); controls.start(now);
  // A continuous two-second drag used to repeatedly replace the sole non-initial frame.
  for (let elapsed = 20; elapsed <= 2000; elapsed += 20) {
    now = 1000 + elapsed;
    await controls.control({ type: 'camera-effects', value: { ...natural, intensity: elapsed / 2000 } });
    assert.equal(controls.snapshot().cameraEffects?.intensity, elapsed / 2000, 'Live feedback remains immediate');
  }
  const frames = controls.effectsKeyframes(2);
  assert.deepEqual(frames[0], { t: 0, effects: natural }, 'First bucket cannot replace the initial settings');
  assert.ok(frames.length >= 30 && frames.length <= 42, `Retain intermediate changes at bounded rate: ${frames.length}`);
  assert.equal(frames.at(-1)?.t, 2);
  assert.equal(frames.at(-1)?.effects.intensity, 1);
  const style: WebcamStyle = { ...originalStyle, effectKeyframes: frames, useRecordedEffects: true };
  let previousIntensity = 0;
  for (const time of [.2, .6, 1, 1.4, 1.8]) {
    const intensity = cameraEffectsAt(style, time).intensity;
    assert.ok(intensity > previousIntensity, `Export/playback must see the drag advance at ${time}s`);
    assert.ok(intensity >= (time - .05) / 2 && intensity <= time / 2, 'Coalescing cannot erase or indefinitely delay intermediate effects');
    previousIntensity = intensity;
  }
  assert.deepEqual(cameraEffectsAt(style, 0), natural);
  assert.equal(cameraEffectsAt(style, 2).intensity, 1);
});

async function storedProjectClass(): Promise<typeof ProjectStore> {
  // Run the real persistence implementation in Node; only Electron's unused desktop shell is substituted.
  const bundled = await build({ entryPoints: [path.resolve('electron/services/projects.ts')], bundle: true,
    write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{
      name: 'no-desktop-in-metadata-test', setup(builder) {
        builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'metadata-test' }));
        builder.onLoad({ filter: /.*/, namespace: 'metadata-test' }, () => ({
          contents: 'export const app = { getPath() { throw new Error("Set the isolated project root first"); } }; export const dialog = {}; export const shell = { trashItem() { throw new Error("Metadata test cannot delete projects"); } };', loader: 'js',
        }));
      },
    }] });
  const module = { exports: {} };
  const initialize = new Function('require', 'module', 'exports', bundled.outputFiles[0].text);
  initialize(createRequire(import.meta.url), module, module.exports);
  return (module.exports as { ProjectStore: typeof ProjectStore }).ProjectStore;
}

test('accepted recording effects survive save/reload and preserve the original camera bytes', async () => {
  const output = path.resolve('output');
  await fs.mkdir(output, { recursive: true });
  const directory = await fs.mkdtemp(path.join(output, 'camera-effects-metadata-'));
  try {
    const Store = await storedProjectClass();
    const store = new Store(); store.root = () => directory;
    const recording = await store.createDirectory();
    const originalBytes = Buffer.from('Raw camera fixture must remain unchanged');
    await Promise.all([
      fs.writeFile(path.join(recording.directory, 'camera.webm'), originalBytes),
      fs.writeFile(path.join(recording.directory, 'screen.mp4'), Buffer.from('Screen fixture')),
      fs.writeFile(path.join(recording.directory, 'cursor.json'), '[]'),
    ]);
    const frames = timeline();
    const accepted = await store.acceptRecording({ directory: recording.directory, duration: 5, width: 1280, height: 720,
      video: 'screen.mp4', cursor: 'cursor.json' }, { ...options, cameraEffects: natural }, recording.id, recording.directory,
    { filename: 'camera.webm', offset: .5 }, [], frames);
    assert.deepEqual(accepted.camera?.effects, natural);
    assert.deepEqual(accepted.camera?.effectKeyframes, timeline());
    assert.equal(accepted.camera?.useRecordedEffects, true);
    frames[0].effects.smoothing = .99;
    assert.deepEqual((await store.load(recording.id)).camera?.effectKeyframes, timeline());
    await store.save({ ...accepted, camera: { ...accepted.camera!, offset: 90, effects: mono, useRecordedEffects: false } });
    const reloaded = await store.load(recording.id);
    assert.equal(reloaded.camera?.offset, .5, 'Effects edits cannot rewrite immutable camera synchronization');
    assert.deepEqual(reloaded.camera?.effects, mono);
    assert.equal(reloaded.camera?.useRecordedEffects, false);
    assert.deepEqual(reloaded.camera?.effectKeyframes, timeline());
    assert.deepEqual(await fs.readFile(path.join(recording.directory, 'camera.webm')), originalBytes);
    const manifest = JSON.parse(await fs.readFile(path.join(recording.directory, 'project.json'), 'utf8'));
    assert.equal(manifest.project.media.camera, 'camera.webm');
    assert.deepEqual(manifest.project.camera.effectKeyframes, timeline());
  } finally {
    const resolved = await fs.realpath(directory);
    assert.ok(resolved.startsWith(path.join(output, 'camera-effects-metadata-')), 'Cleanup must stay inside this isolated test directory');
    await fs.rm(resolved, { recursive: true, force: true });
  }
});
