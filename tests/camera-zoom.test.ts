import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { cameraZoom } from '../shared/camera-zoom';
import { webcamStyleAt } from '../shared/camera-layout';
import { compositionAt, splitCompositionSegment } from '../shared/composition';
import { compositionCameraStyle } from '../shared/composition-camera';
import { validCompositionDraft } from '../shared/composition-validation';
import { DEFAULT_STYLE } from '../shared/constants';
import { LiveRecordingControls } from '../electron/services/live-recording-controls';
import { DesktopPreferences } from '../electron/services/desktop-preferences';
import { parseOverlayControl } from '../electron/services/recording-overlay/validation';
import { parseProject } from '../electron/services/validation';
import type { NativeClient } from '../electron/services/native-client';
import type { Project, RecordingState, WebcamStyle } from '../shared/types';

const camera: WebcamStyle = { offset: 0, enabled: true, position: 'bottom-right', size: .22, shape: 'circle', mirror: true, shrinkOnZoom: false };
const project: Project = { id: '568d996f-32e1-4e2b-8b56-aa4ea90721c7', name: 'Zoom test', createdAt: '2026-09-09T00:00:00Z',
  duration: 8, width: 1280, height: 720, fps: 30, media: { screen: 'screen.mp4', camera: 'camera.webm' }, camera,
  cursor: [], clips: [{ id: 'clip', start: 0, end: 8 }], zooms: [], style: DEFAULT_STYLE, audio: { system: 1, microphone: 1 } };

test('digital zoom defaults to original framing and validates both control and project boundaries', () => {
  assert.equal(cameraZoom(), 1); assert.equal(cameraZoom(NaN), 1);
  for (const zoom of [1, 1.35, 3]) {
    assert.deepEqual(parseOverlayControl({ type: 'camera-zoom', value: zoom }), { type: 'camera-zoom', value: zoom });
    assert.equal(parseProject({ ...project, camera: { ...camera, zoom } }).camera?.zoom, zoom);
  }
  for (const zoom of [0, .99, 3.01, Infinity, NaN, '2']) {
    assert.throws(() => parseOverlayControl({ type: 'camera-zoom', value: zoom }));
    assert.throws(() => parseProject({ ...project, camera: { ...camera, zoom } }));
    const composition = { id: 'range', start: 2, end: 5, screen: 'recording', camera: { zoom } };
    assert.equal(validCompositionDraft(composition), false);
    assert.throws(() => parseProject({ ...project, compositions: [composition] }));
  }
  assert.deepEqual(parseProject(project).camera, camera);
});

test('preview zoom persists and recording retains initial framing plus continuous source-time zoom samples', async context => {
  let now = 1000, status: RecordingState['status'] = 'idle'; context.mock.method(Date, 'now', () => now);
  const directory = mkdtempSync(path.resolve('output/camera-zoom-'));
  const preferences = new DesktopPreferences(() => directory);
  const native = { request: async () => { throw new Error('must not access native capture'); } } as unknown as NativeClient;
  const controls = new LiveRecordingControls(native, () => ({ status }), () => {}, preferences);
  controls.preparePreview('fixture-camera');
  await controls.control({ type: 'camera-zoom', value: 1.25 });
  assert.deepEqual(controls.keyframes(8), []); preferences.flush();
  assert.equal(new DesktopPreferences(() => directory).read().camera.zoom, 1.25);
  controls.reset({ sourceId: 'screen:fixture', fps: 30, microphone: false, systemAudio: false, cameraSessionId: 'fixture-camera' });
  status = 'recording'; controls.start(now);
  for (let index = 1; index <= 20; index++) { now += 20; await controls.control({ type: 'camera-zoom', value: 1.25 + index * .05 }); }
  const frames = controls.keyframes(8);
  assert.equal(frames[0].zoom, 1.25); assert.ok(frames.length >= 8, 'Continuous drag must not collapse into a single moving keyframe');
  assert.equal(frames.at(-1)?.zoom, 2.25); assert.equal(controls.snapshot().cameraSize, .22);
  const saved = parseProject(JSON.parse(JSON.stringify({ ...project, camera: { ...camera, keyframes: frames, useRecordedLayout: true } })));
  const during = webcamStyleAt(saved.camera!, .21).zoom!;
  assert.ok(during > 1.7 && during < 1.9);
  assert.equal(webcamStyleAt(saved.camera!, 1).zoom, 2.25);
  status = 'stopping'; await assert.rejects(controls.control({ type: 'camera-zoom', value: 2 }));
  preferences.flush();
});

test('local zoom overrides only its half-open source-time interval and survives validation, splitting and JSON reopen', () => {
  const input = { ...project, camera: { ...camera, zoom: 1.2 }, compositions: [
    { id: 'close-up', start: 2, end: 5, screen: 'recording' as const, camera: { zoom: 2.5 } },
    { id: 'next', start: 6, end: 7, screen: 'hidden' as const, camera: { zoom: 1.5 } },
  ] };
  const saved = parseProject(JSON.parse(JSON.stringify(input)));
  for (const [time, expected] of [[1.99, 1.2], [2, 2.5], [4.99, 2.5], [5, 1.2], [6, 1.5], [7, 1.2]]) {
    const base = webcamStyleAt(saved.camera!, time), local = compositionAt(saved.compositions, time);
    const result = compositionCameraStyle(base, local?.camera, 1280, 720);
    assert.equal(result.zoom, expected); assert.equal(result.mirror, true);
  }
  assert.equal(saved.camera?.zoom, 1.2); assert.equal(project.camera?.zoom, undefined);
  const split = splitCompositionSegment(saved.compositions!, 'close-up', 3, 'split' );
  assert.equal(split[0].camera?.zoom, 2.5); assert.equal(split[1].camera?.zoom, 2.5);
});
