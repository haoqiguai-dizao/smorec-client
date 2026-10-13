import test from 'node:test';
import assert from 'node:assert/strict';
import { displayedPreviewSnapshot, PreviewInteractionFrames, type PreviewFrameContext } from '../src/services/preview-interaction';

function fixture() {
  const video = { readyState: 4, seeking: false, paused: true };
  const camera = { readyState: 4, seeking: false, paused: true };
  const project = { id: 'project-a', media: { screen: 'screen-a', camera: 'camera-a' },
    clips: [{ id: 'first', start: 10, end: 11 }, { id: 'second', start: 20, end: 23 }] };
  const context: PreviewFrameContext = { project, video, camera, outputTime: .25, playing: false,
    mediaMatches: true, cameraMatches: true, hidden: false };
  return { frames: new PreviewInteractionFrames(), context, project, video, camera };
}

test('interaction describes the actually presented source, not a lagging requested output time', () => {
  const { frames, context } = fixture();
  assert.equal(frames.interaction(context), undefined);
  frames.present(context, 10.3, true);
  const snapshot = frames.interaction(context)!;
  assert.equal(snapshot.projectId, 'project-a'); assert.equal(snapshot.sourceTime, 10.3);
  assert.ok(Math.abs(snapshot.outputTime - .3) < 1e-9);
  assert.equal(snapshot.clipIndex, 0); assert.equal(snapshot.cameraAvailable, true);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.throws(() => Object.defineProperty(snapshot, 'sourceTime', { value: 500 }));
});

test('playback can retain a presentation for throttled UI but cannot expose an interactive frame', () => {
  const { frames, context, video, camera } = fixture();
  context.playing = true; video.paused = false; camera.paused = false;
  frames.present(context, 10.3, true);
  assert.equal(frames.presented(context)?.sourceTime, 10.3);
  assert.equal(frames.interaction(context), undefined);
  context.playing = false;
  assert.equal(frames.interaction(context), undefined, 'The actual media must be paused too');
  video.paused = true;
  assert.equal(frames.interaction(context), undefined, 'A still-playing camera is not a stable paused frame');
  camera.paused = true;
  assert.equal(frames.interaction(context)?.sourceTime, 10.3);
});

test('seek invalidation cannot revive an old frame when media reports seeked', () => {
  const { frames, context, video } = fixture();
  frames.present(context, 10.25, true);
  frames.invalidate(); video.seeking = true; context.outputTime = 1.5;
  assert.equal(frames.interaction(context), undefined);
  frames.present(context, 20.5, true);
  video.seeking = false;
  assert.equal(frames.interaction(context), undefined, 'Only a new stable completed draw may publish');
  frames.present(context, 20.5, true);
  assert.deepEqual(frames.interaction(context), { projectId: 'project-a', sourceTime: 20.5, outputTime: 1.5,
    clipIndex: 1, cameraAvailable: true });
});

test('output/clip context changes reject the old frame even before the native seeking flag arrives', () => {
  const { frames, context } = fixture();
  frames.present(context, 10.25, true);
  context.outputTime = .4;
  assert.equal(frames.interaction(context), undefined);
  context.outputTime = 1.25;
  assert.equal(frames.interaction(context), undefined);
});

test('new projects and edits with the same project ID cannot reuse previous compositor geometry', () => {
  const { frames, context, project } = fixture();
  frames.present(context, 10.25, true);
  context.project = { ...project };
  assert.equal(frames.interaction(context), undefined);
  context.project = { ...project, id: 'project-b' };
  assert.equal(frames.interaction(context), undefined);
  context.project = null;
  assert.equal(frames.interaction(context), undefined);
});

test('layout-only drafts retain displayed geometry without allowing stale-frame interaction', () => {
  const { frames, context, project } = fixture();
  frames.present(context, 10.25, true);
  const snapshot = frames.presented(context)!;
  context.project = { ...project, clips: project.clips.map(clip => ({ ...clip })) };
  assert.equal(displayedPreviewSnapshot(project, snapshot, context.project), snapshot);
  assert.equal(frames.interaction(context), undefined, 'A new gesture must still wait for its own successful draw');
  frames.present(context, 10.25, true);
  assert.equal(frames.interaction(context)?.sourceTime, 10.25);
});

test('display continuity never crosses project, media or clip timeline changes', () => {
  const { frames, context, project } = fixture();
  frames.present(context, 10.25, true);
  const snapshot = frames.presented(context)!;
  for (const next of [null, { ...project, id: 'other' }, { ...project, media: { ...project.media, screen: 'other' } },
    { ...project, media: { ...project.media, camera: 'other' } }, { ...project, clips: project.clips.slice(1) },
    { ...project, clips: project.clips.map((clip, index) => index ? clip : { ...clip, end: 10.9 }) }]) {
    assert.equal(displayedPreviewSnapshot(project, snapshot, next), undefined);
  }
  assert.equal(displayedPreviewSnapshot(project, undefined, project), undefined, 'Seek invalidation cannot display stale geometry');
});

test('media ownership, replacement, hidden documents and unstable screen frames fail closed', () => {
  const { frames, context, video } = fixture();
  frames.present(context, 10.25, true);
  context.mediaMatches = false; assert.equal(frames.interaction(context), undefined);
  context.mediaMatches = true; context.video = { ...video }; assert.equal(frames.interaction(context), undefined);
  context.video = video; context.hidden = true; assert.equal(frames.interaction(context), undefined);
  context.hidden = false; video.readyState = 1; assert.equal(frames.interaction(context), undefined);
  video.readyState = 4; video.seeking = true; assert.equal(frames.interaction(context), undefined);
});

test('camera presence is insufficient unless that stable camera was passed to the successful compositor draw', () => {
  const { frames, context, camera } = fixture();
  frames.present(context, 10.25, false);
  assert.equal(frames.presented(context)?.cameraAvailable, false);
  assert.equal(frames.interaction(context), undefined);
  camera.seeking = true; frames.present(context, 10.25, true);
  camera.seeking = false;
  assert.equal(frames.interaction(context), undefined);
  frames.present(context, 10.25, true);
  context.cameraMatches = false; assert.equal(frames.interaction(context), undefined);
  context.cameraMatches = true; context.camera = { ...camera }; assert.equal(frames.interaction(context), undefined);
  context.camera = null; assert.equal(frames.interaction(context), undefined);
});

test('in-place clip edits also invalidate captured clip identity and bounds', () => {
  const { frames, context, project } = fixture();
  frames.present(context, 10.25, true);
  project.clips[0].start = 9;
  assert.equal(frames.interaction(context), undefined);
  project.clips[0].start = 10; project.clips[0].id = 'replacement';
  assert.equal(frames.interaction(context), undefined);
});

test('exclusive-end rendering retains the actual preceding clip index and does not guess from output time', () => {
  const { frames, context } = fixture();
  context.outputTime = .999;
  frames.present(context, 11, true);
  assert.equal(frames.interaction(context)?.clipIndex, 0);
  assert.equal(frames.interaction(context)?.outputTime, 1);
  context.outputTime = 1;
  assert.equal(frames.interaction(context), undefined);
  frames.present(context, 20, true);
  assert.equal(frames.interaction(context)?.clipIndex, 1);
  assert.equal(frames.interaction(context)?.sourceTime, 20);
});

test('invalid source positions and failed-draw invalidation never expose an interaction snapshot', () => {
  const { frames, context } = fixture();
  for (const source of [Number.NaN, Number.POSITIVE_INFINITY, 9.99, 11.01]) {
    frames.present(context, source, true); assert.equal(frames.interaction(context), undefined);
  }
  frames.present(context, 10.25, true); frames.invalidate();
  assert.equal(frames.presented(context), undefined);
  assert.equal(frames.interaction(context), undefined);
});
