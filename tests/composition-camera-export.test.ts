import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldDecodeCamera } from '../src/services/decode-video';
import type { Project } from '../shared/types';

test('export decodes a locally visible camera even when its global switch is off', () => {
  const project = { media: { screen: 'screen.mp4', camera: 'camera.mp4' }, camera: { enabled: false },
    clips: [{ id: 'clip', start: 0, end: 8 }],
    compositions: [{ id: 'reaction', start: 2, end: 5, screen: 'hidden', camera: { visible: true, size: .28 } }],
  } as Project;
  assert.equal(shouldDecodeCamera(project), true);
  assert.equal(shouldDecodeCamera({ ...project, compositions: undefined }), false);
  assert.equal(shouldDecodeCamera({ ...project, media: { screen: 'screen.mp4' } }), false);
  assert.equal(shouldDecodeCamera({ ...project, clips: [{ id: 'trimmed', start: 5, end: 8 }] }), false);
  assert.equal(shouldDecodeCamera({ ...project, camera: { ...project.camera!, enabled: true } }), true);
});
