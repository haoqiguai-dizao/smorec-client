import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DEFAULT_STYLE } from '../shared/constants';
import type { RecordingOptions, RecordingState } from '../shared/types';
import { DesktopPreferences, type DesktopPreferencePatch } from '../electron/services/desktop-preferences';
import { LiveRecordingControls } from '../electron/services/live-recording-controls';
import type { NativeClient } from '../electron/services/native-client';

async function fixture(run: (context: {
  directory: string; file: string; open: (directory?: string) => DesktopPreferences;
}) => Promise<void>) {
  const output = path.resolve('output'); await fs.mkdir(output, { recursive: true });
  const directory = await fs.mkdtemp(path.join(output, 'desktop-preferences-'));
  const stores: DesktopPreferences[] = [];
  const open = (destination = directory) => {
    const store = new DesktopPreferences(() => destination); stores.push(store); return store;
  };
  try { await run({ directory, file: path.join(directory, 'preferences.json'), open }); }
  finally {
    // Clear every delayed write before removing the owned test directory.
    for (const store of stores) store.flush();
    const resolved = await fs.realpath(directory), relative = path.relative(output, resolved);
    assert.ok(relative.startsWith('desktop-preferences-') && !relative.includes(path.sep) && !path.isAbsolute(relative));
    await fs.rm(resolved, { recursive: true, force: true });
  }
}

test('first read returns detached defaults without creating or changing preference files', async () => {
  await fixture(async ({ directory, open }) => {
    const preferences = open(), first = preferences.read();
    assert.deepEqual(await fs.readdir(directory), []);
    assert.deepEqual(first.style, DEFAULT_STYLE);
    assert.deepEqual(first.camera, { x: .85, y: .8, size: .22, shape: 'circle', mirror: true, visible: true });
    assert.equal(first.cameraShrinkOnZoom, false); assert.equal(first.editorMaximized, false);
    first.style.padding = 100; first.camera.x = 0;
    assert.equal(preferences.read().style.padding, DEFAULT_STYLE.padding);
    assert.equal(preferences.read().camera.x, .85);
  });
});

test('partial updates merge independently and a flushed file survives a reconstructed store', async () => {
  await fixture(async ({ directory, file, open }) => {
    const legacyFile = path.join(directory, 'Preferences');
    await fs.writeFile(legacyFile, 'opaque Chromium preferences');
    const store = open();
    store.update({ style: { background: 'paper', padding: 88 }, camera: { size: .32, mirror: false },
      editorBounds: { x: -1250, y: 30, width: 1200, height: 760 }, editorMaximized: true });
    store.update({ style: { radius: 36 }, audio: { microphone: .6 }, camera: { y: .4 }, cameraShrinkOnZoom: true });
    store.update({ toolbarBounds: { x: 400, y: 850, width: 430, height: 78 }, toolbarArea: { x: 0, y: 0, width: 1920, height: 1040 },
      launcherBounds: { x: 350, y: 400, width: 660, height: 520 }, exportDirectory: directory });
    store.flush();
    const saved = open().read();
    assert.deepEqual(saved.style, { ...DEFAULT_STYLE, background: 'paper', padding: 88, radius: 36 });
    assert.deepEqual(saved.audio, { system: 1, microphone: .6 });
    assert.deepEqual(saved.camera, { x: .85, y: .4, size: .32, mirror: false, visible: true, shape: 'circle' });
    assert.equal(saved.cameraShrinkOnZoom, true); assert.equal(saved.editorMaximized, true);
    assert.deepEqual(saved.editorBounds, { x: -1250, y: 30, width: 1200, height: 760 });
    assert.deepEqual(saved.launcherBounds, { x: 350, y: 400, width: 660, height: 520 });
    assert.deepEqual(saved.toolbarArea, { x: 0, y: 0, width: 1920, height: 1040 });
    assert.equal(saved.exportDirectory, directory);
    const serialized = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(serialized.version, 1); assert.equal(serialized.canvasDefaultsVersion, 2);
    assert.equal(await fs.readFile(legacyFile, 'utf8'), 'opaque Chromium preferences');
    assert.equal((await fs.readdir(directory)).includes('preferences.tmp.json'), false);
  });
});

test('malformed JSON, non-object roots and unsupported versions safely default without rewriting on read', async () => {
  await fixture(async ({ file, open }) => {
    for (const raw of ['{broken', 'null', '[]', '42', '{"version":2,"style":{"padding":0}}']) {
      await fs.writeFile(file, raw);
      const saved = open().read();
      assert.deepEqual(saved.style, DEFAULT_STYLE); assert.equal(saved.cameraShrinkOnZoom, false);
      assert.equal(await fs.readFile(file, 'utf8'), raw);
    }
  });
});

test('bad fields are isolated while valid siblings, false and zero survive schema validation', async () => {
  await fixture(async ({ file, open }) => {
    await fs.writeFile(file, JSON.stringify({ version: 1,
      style: { background: 'paper', padding: -1, radius: 0, aspect: 'cinema', showCursor: false, shadow: '5', smoothing: null },
      audio: { system: 0, microphone: 1.1 }, camera: { x: .2, y: 2, size: .4, shape: 'triangle', mirror: 'false', visible: false },
      cameraShrinkOnZoom: true, editorMaximized: 'true',
      editorBounds: { x: -1100.4, y: 15.4, width: 1200.4, height: 750.4 },
      launcherBounds: { x: 10, y: 10, width: 20, height: 520 },
      exportDirectory: 'relative/path', importDirectory: 'bad\0path', unexpected: 'not a preference',
      media: { camera: 'private.webm' }, session: { id: 'must-not-persist' },
    }).replace('"version":1', '"version":1,"__proto__":{"polluted":true}'));
    const saved = open().read();
    assert.equal(saved.style.background, 'paper'); assert.equal(saved.style.padding, DEFAULT_STYLE.padding);
    assert.equal(saved.style.radius, 0); assert.equal(saved.style.showCursor, false);
    assert.equal(saved.style.shadow, DEFAULT_STYLE.shadow); assert.equal(saved.style.aspect, DEFAULT_STYLE.aspect);
    assert.deepEqual(saved.audio, { system: 0, microphone: 1 });
    assert.deepEqual(saved.camera, { x: .2, y: .8, size: .4, shape: 'circle', mirror: true, visible: true });
    assert.deepEqual(saved.editorBounds, { x: -1100, y: 15, width: 1200, height: 750 });
    assert.equal(saved.launcherBounds, undefined); assert.equal(saved.editorMaximized, false);
    assert.equal(saved.exportDirectory, ''); assert.equal(saved.importDirectory, '');
    for (const key of ['unexpected', 'media', 'session', '__proto__', 'polluted']) assert.equal(Object.hasOwn(saved, key), false);
    assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false);
  });
});

test('only existing directories are restored, never existing files or missing paths', async () => {
  await fixture(async ({ directory, open }) => {
    const store = open(), regularFile = path.join(directory, 'selected-file.mp4');
    await fs.writeFile(regularFile, 'metadata fixture only');
    store.update({ exportDirectory: directory, importDirectory: regularFile });
    assert.equal(store.existingDirectory('exportDirectory'), directory);
    assert.equal(store.existingDirectory('importDirectory'), undefined);
    store.update({ exportDirectory: path.join(directory, 'missing') });
    assert.equal(store.existingDirectory('exportDirectory'), undefined);
    store.update({ exportDirectory: '' }); assert.equal(store.existingDirectory('exportDirectory'), undefined);
  });
});

test('invalid partial values preserve valid previous fields and failed writes never escape', async () => {
  await fixture(async ({ directory, open }) => {
    const store = open(); store.update({ style: { padding: 99 }, camera: { size: .3 }, editorMaximized: true });
    store.update({ style: { padding: Number.NaN, radius: 12 }, camera: { size: Infinity },
      editorMaximized: null } as unknown as DesktopPreferencePatch);
    assert.equal(store.read().style.padding, 99); assert.equal(store.read().style.radius, 12);
    assert.equal(store.read().camera.size, .3); assert.equal(store.read().editorMaximized, true);
    const blocker = path.join(directory, 'not-a-directory'); await fs.writeFile(blocker, 'block');
    const unavailable = open(blocker);
    assert.doesNotThrow(() => { unavailable.update({ audio: { system: .25 } }); unavailable.flush(); });
    assert.equal(unavailable.read().audio.system, .25);
    assert.equal(await fs.readFile(blocker, 'utf8'), 'block');
  });
});

test('legacy canvas defaults migrate once without resetting the other valid preferences', async () => {
  await fixture(async ({ directory, file, open }) => {
    const legacy = { version: 1,
      style: { ...DEFAULT_STYLE, aspect: '9:16', padding: 96, radius: 32, shadow: 70,
        background: 'paper', cursorScale: 2, smoothing: .4, showCursor: false, clickHighlight: false },
      audio: { system: .4, microphone: .7 }, camera: { x: .3, y: .6, size: .3, shape: 'rounded', mirror: false },
      cameraMode: 'presenter', cameraShrinkOnZoom: true, editorMaximized: true,
      editorBounds: { x: 20, y: 30, width: 1200, height: 900 },
      launcherBounds: { x: 40, y: 500, width: 700, height: 180 },
      toolbarBounds: { x: 50, y: 600, width: 600, height: 100 },
      toolbarArea: { x: 0, y: 0, width: 1920, height: 1040 },
      exportDirectory: directory, importDirectory: directory };
    await fs.writeFile(file, JSON.stringify(legacy));
    const store = open(), migrated = store.read();
    const expected = { ...legacy.style, aspect: 'auto', padding: 0, radius: 0, shadow: 0 };
    assert.deepEqual(migrated.style, expected);
    assert.deepEqual(migrated.audio, legacy.audio);
    assert.deepEqual(migrated.camera, { ...legacy.camera, visible: true });
    for (const field of ['cameraMode', 'cameraShrinkOnZoom', 'editorMaximized', 'editorBounds', 'launcherBounds',
      'toolbarBounds', 'toolbarArea', 'exportDirectory', 'importDirectory'] as const) {
      assert.deepEqual(migrated[field], legacy[field]);
    }
    assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).canvasDefaultsVersion, 2,
      'Migration must be recorded even if no other setting changes before restart');
    assert.deepEqual(open().read(), migrated);
    store.update({ style: { aspect: '1:1', padding: 48, radius: 12, shadow: 20 } }); store.flush();
    const later = open().read();
    assert.deepEqual(later.style, { ...expected, aspect: '1:1', padding: 48, radius: 12, shadow: 20 });
    assert.deepEqual(later.camera, migrated.camera);
  });
});

test('a migrated preference file never treats a deliberate legacy-looking style as obsolete', async () => {
  await fixture(async ({ file, open }) => {
    const style = { ...DEFAULT_STYLE, aspect: '16:9', padding: 64, radius: 20, shadow: 40 };
    const raw = JSON.stringify({ version: 1, canvasDefaultsVersion: 2, style });
    await fs.writeFile(file, raw);
    assert.deepEqual(open().read().style, style);
    assert.equal(await fs.readFile(file, 'utf8'), raw, 'Current preferences need no read-time rewrite');
  });
});

test('live controls reset from reconstructed layout without opening devices or persisting a device failure', async () => {
  await fixture(async ({ open }) => {
    const first = open(); first.update({ camera: { x: .27, y: .38, size: .34, shape: 'rounded', mirror: false, visible: false } }); first.flush();
    const preferences = open();
    const native = { request: async () => { throw new Error('This test must never invoke native capture'); } } as unknown as NativeClient;
    let state: RecordingState = { status: 'starting' };
    const controls = new LiveRecordingControls(native, () => state, () => {}, preferences);
    const options: RecordingOptions = { sourceId: 'window:fixture', fps: 30, microphone: false, systemAudio: false, cameraSessionId: 'fixture-session' };
    controls.reset(options);
    const snapshot = controls.snapshot();
    assert.equal(snapshot.cameraAvailable, true); assert.equal(snapshot.cameraVisible, true);
    assert.equal(snapshot.cameraSize, .34); assert.equal(snapshot.cameraShape, 'rounded'); assert.equal(snapshot.cameraMirror, false);
    state = { status: 'recording' }; controls.start(Date.now());
    assert.deepEqual(controls.keyframes(1)[0], { t: 0, x: .27, y: .38, size: .34, shape: 'rounded', mirror: false, visible: true });
    await controls.control({ type: 'camera-visible', value: false }); preferences.flush();
    assert.equal(controls.snapshot().cameraVisible, false);
    assert.equal(open().read().camera.visible, true, 'Hiding during a recording must not hide the next recording');
    controls.reset(options);
    assert.equal(controls.snapshot().cameraVisible, true);
    controls.cameraUnavailable(); preferences.flush();
    assert.equal(open().read().camera.visible, true, 'A transient device failure cannot become the next recording preference');
    controls.reset({ ...options, cameraSessionId: undefined });
    assert.equal(controls.snapshot().cameraAvailable, false); assert.equal(controls.snapshot().cameraVisible, false);
  });
});
