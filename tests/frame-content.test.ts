import assert from 'node:assert/strict';
import test from 'node:test';
import { frameContentAt } from '../shared/frame-content';
import { decodingProject } from './fixtures/export-decoding';

test('recorded camera visibility is evaluated on source time and respects its opt-out', () => {
  const project = decodingProject();
  const keyframe = { t: 0, visible: true, x: .8, y: .8, size: .25, shape: 'rounded' as const, mirror: false };
  project.camera!.keyframes = [keyframe, { ...keyframe, t: 2, visible: false }, { ...keyframe, t: 4 }];
  assert.deepEqual([0, 1.999, 2, 3.999, 4].map(time => frameContentAt(project, time).camera), [true, true, false, false, true]);
  project.camera!.useRecordedLayout = false;
  assert.equal(frameContentAt(project, 2).camera, true);
});

test('presenter ignores recorded small-window visibility but obeys the master switch and exact mode cuts', () => {
  const project = decodingProject();
  project.camera!.keyframes = [{ t: 0, visible: false, x: .8, y: .8, size: .25, shape: 'rounded', mirror: false }];
  project.camera!.modeKeyframes = [{ t: 1, mode: 'presenter' }, { t: 3, mode: 'overlay' }];
  const content = (time: number) => { const { screen, camera } = frameContentAt(project, time); return { screen, camera }; };
  assert.deepEqual(content(.999), { screen: true, camera: false });
  assert.deepEqual(content(1), { screen: false, camera: true });
  assert.deepEqual(content(3), { screen: true, camera: false });
  project.camera!.enabled = false;
  assert.deepEqual(content(2), { screen: false, camera: false });
  project.camera!.useRecordedMode = false;
  assert.deepEqual(content(2), { screen: true, camera: false });
});

test('local composition takes precedence over presenter and can override camera visibility in either direction', () => {
  const project = decodingProject();
  project.camera!.mode = 'presenter';
  project.compositions = [{ id: 'local', start: 1, end: 2, screen: 'recording', camera: { visible: false } }];
  assert.equal(frameContentAt(project, 1).presenter, false);
  assert.equal(frameContentAt(project, 1).screen, true);
  assert.equal(frameContentAt(project, 1).camera, false);
  assert.equal(frameContentAt(project, 2).presenter, true);
  project.camera!.enabled = false;
  project.compositions[0].camera!.visible = true;
  assert.equal(frameContentAt(project, 1).camera, true);
  delete project.camera;
  assert.equal(frameContentAt(project, 1).camera, false, 'An override cannot synthesize a missing camera style');
});

test('opaque board replay restores a burned-in demo camera only where it would be covered', () => {
  const project = decodingProject();
  project.demoCapture = [{ start: 0, end: 10 }];
  project.whiteboard = { separateCanvas: true, interfaceCapture: 'screen', events: [
    { t: 1, action: { kind: 'layout', visible: true, presentation: 'canvas', bounds: { x: 0, y: 0, width: 1, height: 1 } } },
    { t: 3, action: { kind: 'layout', visible: false, bounds: { x: 0, y: 0, width: 1, height: 1 } } },
    { t: 4, action: { kind: 'layout', visible: true, presentation: 'canvas', bounds: { x: 0, y: 0, width: .2, height: .2 } } },
    { t: 5, action: { kind: 'layout', visible: true, presentation: 'interface', bounds: { x: 0, y: 0, width: 1, height: 1 } } },
  ] };
  assert.deepEqual([.99, 1, 2.99, 3, 4, 5].map(t => frameContentAt(project, t).camera), [false, true, true, false, false, false]);
  project.compositions = [{ id: 'hide-person', start: 1, end: 3, screen: 'recording', camera: { visible: false } }];
  assert.equal(frameContentAt(project, 2).camera, false, 'Explicitly hiding the person remains authoritative');
  delete project.whiteboard.interfaceCapture;
  project.whiteboard.video = { offset: 0 };
  assert.equal(frameContentAt(project, 5).camera, true, 'An independent opaque interface also needs the camera above it');
  delete project.media.camera;
  assert.equal(frameContentAt(project, 5).camera, false);
});

test('a local replacement of demo screen uses its independent camera track', () => {
  const project = decodingProject();
  project.demoCapture = [{ start: 0, end: 10 }];
  project.compositions = [{ id: 'person-only', start: 1, end: 3, screen: 'hidden', camera: { visible: true } }];
  assert.equal(frameContentAt(project, 2).screen, false);
  assert.equal(frameContentAt(project, 2).camera, true);
  assert.equal(frameContentAt(project, 3).camera, false, 'No duplicate person in an unchanged demo screen');
});
