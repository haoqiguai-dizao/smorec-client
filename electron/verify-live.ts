import { app, BrowserWindow, ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import assert from 'node:assert/strict';
import { LiveSession } from './services/live/session';
import { virtualCameraStatus } from './services/live/virtual-camera';
import { DEFAULT_CAMERA_EFFECTS, ORIGINAL_CAMERA_EFFECTS } from '../shared/camera-effects';

const directory = path.resolve(process.env.FRAMEFLOW_SYNTHETIC_OUTPUT!);
app.getAppPath = () => process.cwd();
app.setPath('userData', path.join(directory, 'profile'));
app.whenReady().then(async () => {
  // Own Win32 window in a separate process, with no foreground activation.
  const source = spawn('pwsh.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('native/scripts/live-preview-fixture.ps1')],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  source.stderr.on('data', bytes => console.error('Fixture:', bytes.toString()));
  source.on('exit', code => console.log('Fixture exit:', code));
  let session: LiveSession | undefined, window: BrowserWindow | undefined;
  try {
    const before = await virtualCameraStatus();
    const handle = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Synthetic source timeout')), 10000);
      createInterface({ input: source.stdout }).on('line', line => {
        if (/^\d+$/.test(line.trim())) { clearTimeout(timer); resolve(line.trim()); }
      });
      source.once('error', reject);
    });
    const testSource: import('../shared/types').CaptureSource = { id: 'window:' + handle, kind: 'window', name: 'Owned live fixture', width: 640, height: 420 };
    let prepared = 0, restored = 0, effectsEnabled = false;
    let sampledFrames = 0, minVariance = Infinity, minBrightness = Infinity, maxBrightness = 0;
    const inspectPixels = (value: unknown) => {
      assert.ok(value instanceof ArrayBuffer);
      const bytes = new Uint8Array(value);
      const stride = Math.max(4, Math.floor(bytes.length / (4096 * 4)) * 4);
      let count = 0, sum = 0, squared = 0, low = 255, high = 0;
      for (let index = 0; index + 2 < bytes.length; index += stride) {
        const luminance = (bytes[index] + bytes[index + 1] + bytes[index + 2]) / 3;
        ++count; sum += luminance; squared += luminance * luminance;
        low = Math.min(low, luminance); high = Math.max(high, luminance);
      }
      const variance = squared / count - (sum / count) ** 2;
      assert.ok(count > 0 && variance > 25 && high > 100, 'Synthetic composite must contain varied non-black pixels');
      ++sampledFrames; minVariance = Math.min(minVariance, variance);
      minBrightness = Math.min(minBrightness, low); maxBrightness = Math.max(maxBrightness, high);
    };
    session = new LiveSession({ idle: () => true, sources: async () => [testSource],
      deviceStatus: async () => ({ available: true, installed: true, name: 'test-only registration bypass' }),
      prepare: async () => { prepared++; return []; }, restore: async () => { restored++; }, changed: () => {},
      camera: () => ({ status: 'idle', cameraAvailable: true, cameraVisible: true, cameraShape: 'circle', cameraSize: .22,
        cameraMirror: true, cameraEffects: { ...(effectsEnabled ? DEFAULT_CAMERA_EFFECTS : ORIGINAL_CAMERA_EFFECTS) },
        microphoneEnabled: false, microphoneMuted: false, microphoneName: '', systemAudioEnabled: false, systemAudioMuted: false }),
    });
    const preload = path.join(directory, 'preload.cjs');
    await fs.writeFile(preload, `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('smokeApi',{
pull:id=>ipcRenderer.invoke('smoke:pull',id),push:(id,p)=>ipcRenderer.invoke('smoke:push',id,p),stop:()=>ipcRenderer.invoke('smoke:stop')});`);
    ipcMain.handle('smoke:pull', (_, id) => session!.pull(id));
    ipcMain.handle('smoke:push', (_, id, pixels) => { inspectPixels(pixels); return session!.push(id, pixels); });
    ipcMain.handle('smoke:stop', () => session!.stop());
    window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, preload, backgroundThrottling: false } });
    await window.loadURL('data:text/html,<body>Live smoke</body>');
    await window.webContents.executeJavaScript(await fs.readFile(path.join(directory, 'harness.js'), 'utf8'));
    const samples = [];
    for (const scenario of [{ portrait: false, effects: false }, { portrait: true, effects: false }, { portrait: false, effects: true }]) {
      const { portrait } = scenario; effectsEnabled = scenario.effects;
      sampledFrames = 0; minVariance = Infinity; minBrightness = Infinity; maxBrightness = 0;
      assert.equal(window.isVisible(), false, 'The composition renderer must remain in a hidden BrowserWindow');
      const config = await session.start({ sourceId: testSource.id, portrait });
      const sample: { frames: number; bytes: number; measuredFps: number } = await window.webContents.executeJavaScript(`runLiveSmoke(${JSON.stringify(config)})`);
      assert.ok(sample.frames >= 60); assert.equal(sample.bytes, 1920 * 1080 * 4);
      assert.equal(session.state.status, 'idle');
      samples.push({ ...sample, windowHidden: !window.isVisible(), effectsEnabled, sampledFrames,
        minLuminanceVariance: Math.round(minVariance * 100) / 100,
        minLuminance: Math.round(minBrightness * 100) / 100, maxLuminance: Math.round(maxBrightness * 100) / 100 });
    }
    const stallConfig = await session.start({ sourceId: testSource.id });
    const stalled: { frames: number; cameraStallIsolated: boolean } = await window.webContents.executeJavaScript(`runLiveSmoke(${JSON.stringify(stallConfig)}, true)`);
    assert.ok(stalled.frames >= 240); assert.equal(stalled.cameraStallIsolated, true);
    assert.equal(session.state.status, 'idle');
    await session.start({ sourceId: testSource.id }); source.stdin.end();
    for (let i = 0; i < 100 && String(session.state.status) !== 'error'; i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(session.state.status, 'error'); assert.match(session.state.error ?? '', /来源窗口已关闭/);
    assert.equal(prepared, 5); assert.equal(restored, 5);
    assert.deepEqual(await virtualCameraStatus(), before, 'Smoke test must not install a system device');
    const report = { result: 'PASS', samples, prepared, restored, cameraStallIsolated: true, sourceClosedStopped: true, registrationUnchanged: true };
    await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally {
    await session?.stop(); source.stdin.end();
    const timer = setTimeout(() => source.kill(), 2000); timer.unref();
    source.once('exit', () => clearTimeout(timer)); window?.destroy();
  }
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
