import assert from 'node:assert/strict';
import test from 'node:test';
import { PreviewAudioSession } from '../src/services/preview-audio-session';
import type { Project } from '../shared/types';
import { microphonePreset } from '../shared/microphone-effects';
import { AudioUrlLeases } from '../src/services/audio-url-leases';

class Media extends EventTarget {
  src = ''; volume = 1; currentTime = 0; duration = NaN; pauses = 0; readyState = 0; seeking = false; paused = true;
  pause() { this.pauses++; this.paused = true; }
  play() { this.paused = false; return Promise.resolve(); }
  load() {}
  getAttribute() { return this.src || null; }
  removeAttribute() { this.src = ''; }
  ready() { this.duration = 20; this.readyState = 4; this.dispatchEvent(new Event('loadedmetadata')); this.dispatchEvent(new Event('canplay')); }
}
const project = { id: 'one', media: { systemAudio: 'system.wav', microphone: 'microphone.wav' },
  audio: { system: 1, microphone: 1 } } as Project;
const pending = { mixed: true, ready: false }, prepared = { mixed: true, ready: true, url: 'mix.wav' };
const settle = () => new Promise(resolve => setTimeout(resolve, 70));
function setup() {
  const created: Media[] = [], errors: string[] = []; let time = 0;
  const session = new PreviewAudioSession(() => time, message => errors.push(message), () => {
    const element = new Media(); created.push(element); return element as unknown as HTMLAudioElement;
  });
  const video = { muted: false, volume: 1 } as HTMLVideoElement;
  return { session, created, errors, video, time: (value: number) => { time = value; } };
}

test('ready mix joins ongoing playback at the current time with silent warm stems', async () => {
  const { session, created, time, video } = setup();
  try {
    session.update(project, pending, true); session.applyLevels(video, project.audio);
    created.forEach(element => element.ready()); await settle();
    assert.equal(session.original, true);
    time(3.2); session.update(project, prepared, true);
    assert.equal(created[0].pauses, 0, 'Preparing the mix must not pause the playing stems');
    created[2].ready(); await settle();
    assert.equal(session.tracks.mix.currentTime, 3.2); assert.equal(session.tracks.mix.paused, false);
    assert.equal(session.tracks.mix.volume, 1); assert.equal(session.tracks.system.volume, 0);
    assert.equal(session.tracks.microphone.volume, 0); assert.equal(session.original, false);
  } finally { session.dispose(); }
  assert.ok(created.every(element => !element.src && element.paused));
});

test('changing only microphone effects keeps system audio steady while processing and decoding its replacement', async () => {
  const { session, created, video } = setup();
  try {
    session.update(project, prepared, true); session.applyLevels(video, project.audio);
    created.forEach(element => element.ready()); await settle();
    const audible = session.tracks.mix;
    const changed = { ...project, audio: { ...project.audio, microphoneEffects: microphonePreset('warm') } };
    session.update(changed, pending, true);
    assert.equal(session.tracks.mix, audible, 'An effect edit must not discard the already playing mix');
    assert.equal(audible.volume, 1);
    assert.equal(session.tracks.system.volume, 0, 'System sound must not fall back to a quieter raw stem');
    session.update(changed, { mixed: true, ready: true, url: 'warm-mix.wav' }, true);
    assert.equal(audible.volume, 1, 'The previous mix must remain audible until the new one can play');
    created.at(-1)!.ready(); await settle();
    assert.equal(session.tracks.mix.src, 'warm-mix.wav');
    assert.equal(session.tracks.mix.volume, 1);
    assert.equal(session.tracks.system.volume, 0);
  } finally { session.dispose(); }
});

test('retained effects cannot leak old levels, sources, duration or another project', async () => {
  const invalidated = [
    { ...project, audio: { system: 0, microphone: 1 } },
    { ...project, audio: { system: 1, microphone: 0 } },
    { ...project, duration: 10 },
    { ...project, id: 'another' },
    { ...project, media: { ...project.media, systemAudio: 'different-system.wav' } },
    { ...project, media: { ...project.media, microphone: 'different-mic.wav' } },
  ];
  for (const changed of invalidated) {
    const { session, created } = setup();
    try {
      session.update(project, prepared, true); created.forEach(element => element.ready()); await settle();
      session.update(project, pending, true);
      session.update(changed, pending, true);
      assert.equal(session.tracks.mix, undefined);
      if (!changed.audio.system) assert.equal(session.tracks.system.volume, 0);
      if (!changed.audio.microphone) assert.equal(session.tracks.microphone.volume, 0);
    } finally { session.dispose(); }
  }
});

test('rapid effects and a failed replacement preserve confirmed system sound without reviving playback after pause', async () => {
  const { session, created, errors } = setup();
  try {
    session.update(project, prepared, true); created.forEach(element => element.ready()); await settle();
    const audible = session.tracks.mix;
    session.update(project, { mixed: true, ready: true, url: 'obsolete.wav' }, true);
    const obsolete = created.at(-1)!;
    session.update(project, pending, true);
    obsolete.ready(); assert.equal(obsolete.src, ''); assert.equal(session.tracks.mix, audible);
    session.update(project, { mixed: true, ready: true, url: 'failed.wav' }, true);
    created.at(-1)!.dispatchEvent(new Event('error'));
    assert.equal(audible.volume, 1); assert.equal(session.tracks.system.volume, 0);
    assert.ok(errors.includes('混音音轨无法读取'));
    session.update(project, pending, false);
    assert.equal(audible.paused, true);
    session.update(project, { mixed: true, ready: true, url: 'latest.wav' }, false);
    created.at(-1)!.ready();
    assert.equal(session.tracks.mix.src, 'latest.wav'); assert.equal(session.tracks.mix.paused, true);
  } finally { session.dispose(); }
});

test('processing ownership cannot release an audible mix before replacement decoding and crossfade finish', async () => {
  const released: string[] = [], created: Media[] = [];
  const leases = new AudioUrlLeases(url => released.push(url));
  const session = new PreviewAudioSession(() => 0, () => {}, () => {
    const element = new Media(); created.push(element); return element as unknown as HTMLAudioElement;
  }, undefined, url => leases.retain(url));
  const first = 'frameflow://audio/first', next = 'frameflow://audio/next';
  const releaseFirstOwner = leases.retain(first), releaseNextOwner = leases.retain(next);
  try {
    session.update(project, { mixed: true, ready: true, url: first }, true);
    created.forEach(element => element.ready()); await settle();
    session.update(project, pending, true);
    session.update(project, { mixed: true, ready: true, url: next }, true);
    releaseFirstOwner(); assert.deepEqual(released, []);
    created.at(-1)!.ready(); await settle();
    assert.deepEqual(released, [first]);
    releaseNextOwner(); assert.deepEqual(released, [first]);
    session.dispose(); assert.deepEqual(released, [first, next]);
  } finally { releaseFirstOwner(); releaseNextOwner(); session.dispose(); }
});

test('editing a prepared mix mutes immediately, without waiting for another file', async () => {
  const { session, created, video } = setup();
  try {
    session.update(project, prepared, true); session.applyLevels(video, project.audio);
    created.forEach(element => element.ready()); await settle();
    session.update({ ...project, audio: { system: 1, microphone: 0 } }, pending, true);
    assert.equal(session.tracks.mix, undefined); assert.equal(session.tracks.microphone.volume, 0);
    assert.equal(session.tracks.system.volume, 1);
    assert.equal(session.tracks.system.paused, false); assert.equal(video.muted, true);
    session.update({ ...project, audio: { system: 0, microphone: .5 } }, pending, true);
    assert.equal(session.tracks.system.volume, 0); assert.equal(session.tracks.microphone.volume, .5);
  } finally { session.dispose(); }
});

test('microphone effects never attenuate system-only fallback when the microphone is muted', async () => {
  const { session, created } = setup();
  try {
    const muted = { ...project, audio: { ...project.audio, microphone: 0, microphoneEffects: microphonePreset('natural') } };
    session.update(muted, pending, true); created.forEach(element => element.ready()); await settle();
    assert.equal(session.tracks.system.volume, 1); assert.equal(session.tracks.microphone.volume, 0);
    session.update({ ...muted, audio: { ...muted.audio, microphoneEffects: microphonePreset('warm') } }, pending, true);
    assert.equal(session.tracks.system.volume, 1); assert.equal(session.tracks.microphone.volume, 0);
  } finally { session.dispose(); }
});

test('late candidates cannot replace a newer effect or revive playback after pause', async () => {
  const { session, created, errors, time } = setup();
  const single = { ...project, media: { screen: 'screen.mp4', microphone: 'microphone.wav' } };
  try {
    session.update(single, { mixed: false, ready: true, url: 'natural.wav' }, true);
    created[0].ready(); await settle();
    session.update(single, { mixed: false, ready: true, url: 'warm.wav' }, true);
    const stale = created[1];
    session.update(single, { mixed: false, ready: true, url: 'clear.wav' }, true);
    stale.ready(); assert.equal(stale.src, '');
    time(4); created[2].ready();
    session.update(single, { mixed: false, ready: true, url: 'clear.wav' }, false);
    await settle();
    assert.equal(session.tracks.microphone.src, 'clear.wav'); assert.equal(session.tracks.microphone.currentTime, 4);
    assert.equal(session.tracks.microphone.paused, true); assert.deepEqual(errors, []);
    assert.equal(created[0].src, '');
  } finally { session.dispose(); }
});

test('unmount while play resolves releases all media and invalidates callbacks', async () => {
  const { session, created } = setup();
  session.update(project, prepared, true); created.forEach(element => element.ready());
  session.dispose(); await settle();
  assert.deepEqual(session.tracks, {}); assert.ok(created.every(element => !element.src && element.paused));
});

test('embedded sound and silent projects preserve the video gain without external tracks', () => {
  const { session, video } = setup();
  const embedded = { ...project, media: { screen: 'embedded.mp4' }, audio: { system: .8, microphone: 0 } };
  session.update(embedded, { mixed: false, ready: true }, false); session.applyLevels(video, embedded.audio);
  assert.deepEqual(session.tracks, {}); assert.equal(video.volume, .8); assert.equal(video.muted, false);
  session.dispose();
});

test('pausing an unresolved play request still adopts the ready replacement without restarting', async () => {
  const { session, created } = setup();
  const single = { ...project, media: { screen: 'screen.mp4', microphone: 'microphone.wav' } };
  let reject!: (cause: Error) => void;
  session.update(single, { mixed: false, ready: true, url: 'effect.wav' }, true);
  created[0].play = () => new Promise<void>((_resolve, failure) => { reject = failure; });
  created[0].ready();
  session.update(single, { mixed: false, ready: true, url: 'effect.wav' }, false);
  reject(Object.assign(new Error('paused'), { name: 'AbortError' }));
  await settle();
  assert.equal(session.tracks.microphone.src, 'effect.wav'); assert.equal(session.tracks.microphone.paused, true);
  session.dispose();
});
