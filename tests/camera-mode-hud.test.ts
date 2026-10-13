import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import type { Rectangle } from 'electron';
import type { LiveRecordingState } from '../shared/types';
import type { RecordingHud } from '../electron/services/recording-hud';
import { presenterCameraBounds } from '../electron/services/recording-overlay/geometry';

class Contents extends EventEmitter {
  mainFrame = { url: '' };
  sent: { channel: string; value: unknown }[] = [];
  setWindowOpenHandler() {}
  send(channel: string, value: unknown) { this.sent.push({ channel, value }); }
}
class MockWindow extends EventEmitter {
  webContents = new Contents();
  bounds: Rectangle;
  visible = false;
  destroyed = false;
  loads = 0;
  boundsWrites = 0;
  regions: Rectangle[] = [];
  contentProtected = false;
  constructor(public options: Rectangle & { title: string }, public id: number, private scale = 1) {
    super(); this.bounds = { ...options }; this.setBounds(options);
  }
  isDestroyed() { return this.destroyed; }
  isVisible() { return this.visible; }
  setTitle(title: string) { this.options.title = title; }
  setContentProtection(value: boolean) { this.contentProtected = value; }
  getBounds(): Rectangle { const { x, y, width, height } = this.bounds; return { x, y, width, height }; }
  setShape(regions: Rectangle[]) { this.regions = structuredClone(regions); }
  setBounds(bounds: Rectangle) {
    this.boundsWrites++;
    // Native pixels are integral. Reading their enclosing DIP rectangle is not the inverse of setting DIP sizes.
    const x = Math.round(bounds.x * this.scale), y = Math.round(bounds.y * this.scale);
    const width = Math.round(bounds.width * this.scale), height = Math.round(bounds.height * this.scale);
    this.bounds = { x: Math.floor(x / this.scale), y: Math.floor(y / this.scale),
      width: Math.ceil((x + width) / this.scale) - Math.floor(x / this.scale),
      height: Math.ceil((y + height) / this.scale) - Math.floor(y / this.scale) };
    this.emit('move');
  }
  getNativeWindowHandle() { const buffer = Buffer.alloc(8); buffer.writeBigUInt64LE(BigInt(this.id)); return buffer; }
  showInactive() { this.visible = true; }
  hide() { this.visible = false; }
  async loadURL(url: string) { this.loads++; this.webContents.mainFrame.url = url; this.webContents.emit('did-finish-load'); }
  destroy() { this.destroyed = true; this.emit('closed'); }
}

async function fixture(scale = 1) {
  const left = { x: -1920, y: 0, width: 1920, height: 1040 }, right = { x: 0, y: 0, width: 1280, height: 720 };
  const displays = [left, right], windows: MockWindow[] = [], placements: { x: number; y: number }[] = [], requests: string[] = [];
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  let cursor = { x: -1500, y: 200 };
  const preference = { camera: { x: .65, y: .7, size: .22, shape: 'circle', mirror: true, visible: true } };
  const electron = {
    app: Object.assign(new EventEmitter(), { isReady: () => true, getAppPath: () => path.resolve('.') }),
    BrowserWindow: class extends MockWindow {
      constructor(options: Rectangle & { title: string }) { super(options, windows.length + 100, scale); windows.push(this); }
    },
    dialog: { showMessageBox: () => { throw new Error('Unexpected failure dialog'); } },
    ipcMain: { handle: (channel: string, callback: (...args: unknown[]) => unknown) => handlers.set(channel, callback), removeHandler: (channel: string) => handlers.delete(channel) },
    screen: Object.assign(new EventEmitter(), {
      getCursorScreenPoint: () => cursor,
      getDisplayNearestPoint: (point: { x: number }) => ({ workArea: point.x < 0 ? left : right }),
      getDisplayMatching: (bounds: Rectangle) => ({ workArea: [...displays].sort((a, b) => {
        const overlap = (area: Rectangle) => Math.max(0, Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x))
          * Math.max(0, Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y));
        return overlap(b) - overlap(a);
      })[0] }),
    }),
  };
  const injected = { electron, preferences: { read: () => structuredClone(preference), update: () => {} } };
  const bundled = await build({ entryPoints: [path.resolve('electron/services/recording-hud.ts')], bundle: true, write: false,
    // This fixture intentionally models HWND geometry and Windows setShape.
    define: { 'process.platform': '"win32"' },
    platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{
      name: 'synthetic-window-only', setup(builder) {
        builder.onResolve({ filter: /^(electron|\.\/diagnostics|\.\/app-icon|\.\/user-preferences)$/ }, args => ({ path: args.path, namespace: 'mock-hud' }));
        builder.onLoad({ filter: /.*/, namespace: 'mock-hud' }, args => ({ loader: 'js', contents: args.path === 'electron'
          ? 'export default injected.electron; export const { app, BrowserWindow, dialog, ipcMain, screen } = injected.electron;'
          : args.path === './user-preferences' ? 'export const userPreferences = injected.preferences;'
            : args.path === './app-icon' ? 'export const applicationIcon = () => undefined;'
              : 'export const diagnostic = () => {};',
        }));
      },
    }] });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'injected', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports, injected);
  const Constructor = (module.exports as { RecordingHud: typeof RecordingHud }).RecordingHud;
  const hud = new Constructor({ onStop: () => {}, onAction: () => {}, onPreviewRequest: id => { requests.push(id); },
    onPreviewSignal: () => {}, onCameraPlacement: center => placements.push(center) });
  let state: LiveRecordingState = { status: 'idle', cameraPreviewing: true, cameraSessionId: 'fake-camera', cameraAvailable: true,
    cameraVisible: true, cameraShape: 'circle', cameraSize: .22, cameraMirror: true, cameraMode: 'overlay',
    microphoneEnabled: false, microphoneMuted: false, microphoneName: '', systemAudioEnabled: false, systemAudioMuted: false };
  const update = (patch: Partial<LiveRecordingState>) => { state = { ...state, ...patch }; hud.update(state); };
  update({});
  const camera = windows[0];
  const lease = handlers.get('recording-overlay:preview-ready')!({ sender: camera.webContents, senderFrame: camera.webContents.mainFrame }) as { sessionId: string };
  await new Promise(resolve => setImmediate(resolve));
  const event = () => ({ sender: camera.webContents, senderFrame: camera.webContents.mainFrame });
  const snapshot = () => handlers.get('recording-overlay:get-state')!(event()) as LiveRecordingState;
  const settings = (open: boolean) => handlers.get('recording-overlay:camera-settings')!(event(), open);
  return { hud, camera, windows, placements, requests, update, left, right, lease, snapshot, settings,
    cursor: (point: typeof cursor) => { cursor = point; } };
}

test('presenter drag stays independent and switching back restores exact small-window bounds on its own monitor', async () => {
  const { hud, camera, placements, requests, update, left, right, cursor, lease } = await fixture();
  try {
    const original = camera.getBounds(), handle = hud.getWindowHandles().camera;
    assert.equal(placements.length, 0);
    update({ cameraMode: 'presenter' });
    assert.deepEqual(camera.getBounds(), presenterCameraBounds(left));
    camera.setBounds({ ...camera.getBounds(), x: right.x + 100, y: right.y + 100 });
    assert.equal(placements.length, 0, 'Presenter drags cannot create a small-camera layout keyframe');
    const presenter = camera.getBounds(); cursor({ x: 200, y: 200 });
    update({ status: 'starting', cameraPreviewing: false }); hud.setCaptureBounds(right);
    update({ status: 'recording' });
    assert.deepEqual(camera.getBounds(), presenter, 'Starting capture must not move the presenter or resize on a different capture monitor');
    update({ cameraMode: 'overlay' });
    assert.deepEqual(camera.getBounds(), original, 'The original monitor and exact bounds must survive presenter movement');
    assert.equal(hud.getWindowHandles().camera, handle); assert.equal(camera.loads, 1);
    assert.deepEqual(requests, [lease.sessionId]);
    assert.doesNotThrow(() => hud.signalFromHost({ sessionId: lease.sessionId, signal: { type: 'offer', sdp: 'v=0' } }));
    assert.equal(placements.length, 0);
  } finally { hud.dispose(); }
});

test('small-window drag persists once, while starting capture and repeated mode toggles never overwrite it', async () => {
  const { hud, camera, placements, update, right } = await fixture();
  try {
    camera.setBounds({ ...camera.getBounds(), x: -1600, y: 250 });
    const original = camera.getBounds(); assert.equal(placements.length, 1);
    update({ status: 'starting', cameraPreviewing: false }); hud.setCaptureBounds(right); update({ status: 'recording' });
    assert.deepEqual(camera.getBounds(), original);
    for (let round = 0; round < 3; round++) {
      update({ cameraMode: 'presenter' }); update({ cameraMode: 'overlay' });
      assert.deepEqual(camera.getBounds(), original);
    }
    assert.equal(placements.length, 1); assert.equal(camera.loads, 1);
  } finally { hud.dispose(); }
});

test('fractional DPI readback cannot enlarge the restored small window or become a false layout edit', async () => {
  for (const scale of [1.25, 1.5, 1.75]) {
    const { hud, camera, placements, update } = await fixture(scale);
    try {
      const original = camera.getBounds();
      assert.equal(placements.length, 0, 'Programmatic DIP quantization is not a user drag');
      for (let round = 0; round < 8; round++) {
        update({ cameraMode: 'presenter' });
        const presenter = camera.getBounds();
        camera.setBounds({ ...presenter, x: presenter.x + 24, y: presenter.y + 16 });
        const writes = camera.boundsWrites;
        update({ cameraMode: 'overlay' });
        assert.deepEqual(camera.getBounds(), original, `The ${scale * 100}% DPI return ${round} must restore exact observed bounds`);
        assert.ok(camera.boundsWrites - writes <= 3, 'Readback compensation must remain bounded');
        assert.equal(placements.length, 0, 'Mode changes and readback compensation cannot append placement edits');
      }
    } finally { hud.dispose(); }
  }
});

test('camera settings preserve the exact image rectangle, HWND and preview lease across repeated fractional-DPI expansion', async () => {
  for (const scale of [1, 1.25, 1.5, 1.75, 2]) {
    const { hud, camera, placements, requests, snapshot, settings, lease } = await fixture(scale);
    try {
      const original = camera.getBounds(), handle = hud.getWindowHandles().camera, viewport = snapshot().cameraViewport;
      for (let round = 0; round < 5; round++) {
        settings(true);
        const panel = snapshot().cameraPanel!;
        const outer = camera.getBounds();
        assert.ok(panel, 'Opening controls must publish local viewport rectangles');
        assert.deepEqual({ ...panel.camera, x: outer.x + panel.camera.x, y: outer.y + panel.camera.y }, original,
          `Camera content cannot move or resize at ${scale * 100}% DPI`);
        assert.equal(hud.getWindowHandles().camera, handle);
        assert.deepEqual(snapshot().cameraViewport, viewport, 'Expanding the native HWND must preserve the CSS camera size');
        assert.equal(placements.length, 0, 'Expanding settings cannot append camera layout keyframes');
        settings(false);
        assert.equal(snapshot().cameraPanel, undefined); assert.deepEqual(camera.getBounds(), original);
        assert.deepEqual(snapshot().cameraViewport, viewport, 'Collapsing the native HWND must preserve the CSS camera size');
      }
      assert.equal(camera.loads, 1); assert.deepEqual(requests, [lease.sessionId]);
      assert.doesNotThrow(() => hud.signalFromHost({ sessionId: lease.sessionId, signal: { type: 'offer', sdp: 'v=0' } }));
    } finally { hud.dispose(); }
  }
});

test('countdown, start, stop, hidden camera and mode changes close settings while preserving the original image geometry', async () => {
  for (const patch of [{ countdown: 3 }, { status: 'starting', cameraPreviewing: false },
    { status: 'recording', cameraPreviewing: false }, { status: 'stopping' }, { cameraVisible: false },
    { cameraMode: 'presenter' }, { cameraSessionId: 'replacement' }] as Partial<LiveRecordingState>[]) {
    const { hud, camera, placements, snapshot, settings, update } = await fixture();
    try {
      const original = camera.getBounds(); settings(true); update(patch);
      assert.equal(snapshot().cameraPanel, undefined, JSON.stringify(patch));
      if (patch.cameraMode !== 'presenter') assert.deepEqual(camera.getBounds(), original);
      assert.equal(placements.length, 0);
      if (patch.countdown || patch.status === 'starting' || patch.status === 'stopping' || patch.cameraVisible === false) {
        assert.throws(() => settings(true), /摄像头就绪/);
      }
    } finally { hud.dispose(); }
  }
});

test('deliberate camera size changes with settings open still use the composition size and restore it on collapse', async () => {
  const { hud, camera, placements, snapshot, settings, update } = await fixture();
  try {
    settings(true); update({ cameraSize: .3, cameraShape: 'rounded' });
    const { camera: frame } = snapshot().cameraPanel!, outer = camera.getBounds();
    const desired = { ...frame, x: outer.x + frame.x, y: outer.y + frame.y };
    settings(false); assert.deepEqual(camera.getBounds(), desired);
    assert.equal(placements.length, 0, 'Only explicit size/shape controls, never HWND expansion, own layout changes');
  } finally { hud.dispose(); }
});

test('live slider changes keep the native settings track fixed and transparent reserve non-interactive at fractional DPI', async () => {
  for (const scale of [1, 1.25, 1.5, 1.75]) {
    const { hud, camera, snapshot, settings, update, requests, placements } = await fixture(scale);
    try {
      settings(true);
      const originalOuter = camera.getBounds(), originalPanel = snapshot().cameraPanel!.settings, writes = camera.boundsWrites;
      for (const size of [.12, .15, .21, .28, .35, .42, .2]) {
        update({ cameraSize: size });
        assert.deepEqual(camera.getBounds(), originalOuter);
        assert.deepEqual(snapshot().cameraPanel!.settings, originalPanel);
        assert.equal(camera.boundsWrites, writes, 'Live range motion must not move or resize its owning HWND');
        assert.equal(camera.regions.length, 2);
        assert.deepEqual(snapshot().cameraViewport, { width: snapshot().cameraPanel!.camera.width, height: snapshot().cameraPanel!.camera.height });
        assert.ok(camera.regions.every(region => Object.values(region).every(Number.isInteger)));
        const area = camera.regions.reduce((sum, region) => sum + region.width * region.height, 0);
        assert.ok(area < originalOuter.width * originalOuter.height, 'Unused native HWND reserve falls through to the desktop');
      }
      const frame = snapshot().cameraPanel!.camera;
      settings(false); assert.deepEqual(camera.regions, []);
      assert.deepEqual(camera.getBounds(), { ...frame, x: originalOuter.x + frame.x, y: originalOuter.y + frame.y });
      assert.equal(camera.loads, 1); assert.equal(requests.length, 1); assert.equal(placements.length, 0);
    } finally { hud.dispose(); }
  }
});

test('dragging an expanded settings window moves the underlying small camera once, with no resize or new preview', async () => {
  const { hud, camera, placements, snapshot, settings, requests } = await fixture();
  try {
    const original = camera.getBounds(); settings(true);
    const outer = camera.getBounds(); camera.setBounds({ ...outer, x: outer.x - 20, y: outer.y - 15 });
    const frame = snapshot().cameraPanel!.camera, movedOuter = camera.getBounds();
    assert.deepEqual({ ...frame, x: movedOuter.x + frame.x, y: movedOuter.y + frame.y },
      { ...original, x: original.x - 20, y: original.y - 15 });
    assert.equal(placements.length, 1);
    settings(false); assert.deepEqual(camera.getBounds(), { ...original, x: original.x - 20, y: original.y - 15 });
    assert.equal(requests.length, 1); assert.equal(camera.loads, 1);
  } finally { hud.dispose(); }
});
