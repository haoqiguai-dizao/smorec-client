import assert from 'node:assert/strict';
import test from 'node:test';
import { webcamStyleAt } from '../shared/camera-layout';
import { recordingOptions, parseProject } from '../electron/services/validation';
import { DEFAULT_STYLE } from '../shared/constants';
import type { Project, WebcamStyle } from '../shared/types';

const camera: WebcamStyle = { offset: 0, enabled: true, position: 'bottom-right', size: .22, shape: 'circle',
  mirror: true, shrinkOnZoom: false, keyframes: [
    { t: 0, x: .85, y: .8, size: .22, shape: 'circle', mirror: true, visible: true },
    { t: 2, x: .3, y: .4, size: .3, shape: 'rounded', mirror: false, visible: true },
    { t: 2.1, x: .4, y: .5, size: .3, shape: 'rounded', mirror: false, visible: true },
    { t: 4, x: .4, y: .5, size: .3, shape: 'rounded', mirror: false, visible: false },
  ] };
test('camera changes follow source time, interpolate drag only, preserve step changes', () => {
  assert.equal(webcamStyleAt(camera, 1.99).shape, 'circle');
  assert.equal(webcamStyleAt(camera, 2).mirror, false);
  const during = webcamStyleAt(camera, 2.05);
  assert.ok(Math.abs(during.placement!.x - .35) < .00001);
  assert.equal(webcamStyleAt(camera, 3.9).enabled, true);
  assert.equal(webcamStyleAt(camera, 4).enabled, false);
});
test('manual editing overrides recorded layout without destroying keyframes', () => {
  const manual = { ...camera, useRecordedLayout: false, shape: 'circle' as const };
  assert.equal(webcamStyleAt(manual, 5), manual);
  assert.equal(webcamStyleAt({ ...camera, enabled: false }, 2).enabled, false);
  assert.equal(camera.keyframes?.length, 4);
});

test('independent mirror override preserves animated geometry, visibility and recorded data', () => {
  const snapshot = structuredClone(camera);
  for (const mirror of [false, true]) {
    const edited = { ...camera, mirror, useRecordedMirror: false };
    for (const time of [0, 2, 2.05, 4]) {
      const original = webcamStyleAt(camera, time), actual = webcamStyleAt(edited, time);
      assert.equal(actual.mirror, mirror);
      assert.deepEqual(actual.placement, original.placement);
      assert.equal(actual.size, original.size); assert.equal(actual.enabled, original.enabled);
      assert.equal(actual.shape, original.shape);
    }
    assert.equal(webcamStyleAt({ ...edited, useRecordedMirror: true }, 2).mirror, false);
    const restored = webcamStyleAt({ ...edited, useRecordedLayout: false, useRecordedMirror: true }, 2);
    assert.equal(restored.mirror, false); assert.equal(restored.size, edited.size);
  }
  assert.deepEqual(camera, snapshot);
});
test('microphone options preserve native endpoint IDs, reject invalid values', () => {
  const options = { sourceId: 'screen:1', systemAudio: true, microphone: true, fps: 30 };
  assert.equal(recordingOptions({ ...options, microphoneDeviceId: '{0.0.1.00000000}.{endpoint}' }).microphoneDeviceId, '{0.0.1.00000000}.{endpoint}');
  assert.equal(recordingOptions({ ...options, microphoneDeviceId: '' }).microphoneDeviceId, undefined);
  assert.throws(() => recordingOptions({ ...options, microphoneDeviceId: 42 }));
});
test('project layout survives validation and rejects invalid timing and geometry', () => {
  const project: Project = { id: '568d996f-32e1-4e2b-8b56-aa4ea90721c7', name: 'layout', createdAt: new Date().toISOString(),
    duration: 5, width: 1920, height: 1080, fps: 30, media: { screen: 'screen.mp4', camera: 'camera.webm' }, camera,
    cursor: [], clips: [{ id: 'clip', start: 0, end: 5 }], zooms: [], style: { ...DEFAULT_STYLE }, audio: { system: 1, microphone: 1 } };
  assert.deepEqual(parseProject(project).camera, camera);
  const mirrored = { ...project, camera: { ...camera, mirror: true, useRecordedMirror: false } };
  assert.deepEqual(parseProject(JSON.parse(JSON.stringify(mirrored))).camera, mirrored.camera);
  assert.throws(() => parseProject({ ...project, camera: { ...camera, useRecordedMirror: 'false' } }));
  assert.throws(() => parseProject({ ...project, camera: { ...camera, keyframes: [...camera.keyframes!].reverse() } }));
  assert.throws(() => parseProject({ ...project, camera: { ...camera, placement: { x: 4, y: .5 } } }));
});
