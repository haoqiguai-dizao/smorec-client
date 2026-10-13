/** Real React StrictMode with entirely mocked media, denied hardware permissions and an isolated profile. */
import { app, BrowserWindow } from 'electron';
import { mkdirSync, promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const directory = path.resolve(process.env.FRAMEFLOW_SYNTHETIC_OUTPUT ?? process.env.FRAMEFLOW_HOOK_VERIFY_OUTPUT ?? 'output/webcam-hook-verification');
mkdirSync(path.join(directory, 'profile'), { recursive: true });
app.setPath('userData', path.join(directory, 'profile'));
app.setPath('sessionData', path.join(directory, 'profile'));
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.whenReady().then(async () => {
  const file = path.join(directory, 'harness.html');
  await fs.writeFile(file, '<div id="app"></div><script src="harness.js"></script>');
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, backgroundThrottling: false } });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  await window.loadFile(file);
  const execute = (code: string) => window.webContents.executeJavaScript(code);
  async function waitFor(expression: string) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await execute(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Timed out: ' + expression + '; state=' + JSON.stringify(await execute('webcamHarness.state()')));
  }
  async function complete(index: number) {
    await waitFor('webcamHarness.state().prepares===' + (index + 1));
    await execute('webcamHarness.resolvePrepare(' + index + ')');
    await waitFor('webcamHarness.state().media===' + (index + 1));
    await execute('webcamHarness.resolveMedia(' + index + ')');
    await waitFor('webcamHarness.state().hasStream && !webcamHarness.state().loading');
  }

  await waitFor('window.webcamHarness?.state().ready && webcamHarness.state().listeners===1');
  const initial = await execute('webcamHarness.state()');
  assert.equal(initial.enabled, true); assert.equal(initial.cameraPreference, true);
  assert.equal(initial.prepares, 0, 'preferences do not acquire hardware before activation');
  await execute('webcamHarness.activate(); webcamHarness.activate()');
  await waitFor('webcamHarness.state().prepares===1');
  await execute('webcamHarness.resolvePrepare(0)');
  await waitFor('webcamHarness.state().media===1');
  await execute('webcamHarness.enable(false)');
  await waitFor('webcamHarness.state().lease===null && !webcamHarness.state().loading');
  assert.equal((await execute('webcamHarness.state()')).cameraPreference, false);
  await execute('webcamHarness.resolveMedia(0)');
  await waitFor('webcamHarness.state().tracks[0]==="ended"');

  await execute('webcamHarness.enable(true)');
  await waitFor('webcamHarness.state().prepares===2');
  await execute('webcamHarness.resolvePrepare(1)');
  await waitFor('webcamHarness.state().media===2');
  await execute('webcamHarness.choose("camera-b")');
  await complete(2);
  await execute('webcamHarness.resolveMedia(1)');
  await waitFor('webcamHarness.state().tracks[1]==="ended"');
  const selected = await execute('webcamHarness.state()');
  assert.equal(selected.session, 'lease-3'); assert.equal(selected.selected, 'camera-b');
  assert.equal(selected.enabled, true); assert.deepEqual(selected.errors, []);

  await execute('webcamHarness.command("start")');
  await execute('webcamHarness.command("stop")');
  await waitFor('!webcamHarness.state().hasStream');
  assert.equal((await execute('webcamHarness.state()')).enabled, true);
  assert.equal((await execute('webcamHarness.state()')).cameraPreference, true);
  await execute('webcamHarness.activate()'); await complete(3);
  await execute('webcamHarness.close("lease-3")');
  assert.equal((await execute('webcamHarness.state()')).session, 'lease-4');
  await execute('webcamHarness.close()');
  assert.equal((await execute('webcamHarness.state()')).cameraPreference, true);

  await execute('webcamHarness.activate()');
  await waitFor('webcamHarness.state().prepares===5');
  await execute('webcamHarness.resolvePrepare(4)');
  await waitFor('webcamHarness.state().media===5');
  await execute('webcamHarness.unmount()');
  await waitFor('webcamHarness.state().lease===null && webcamHarness.state().listeners===0');
  await execute('webcamHarness.remount()');
  await waitFor('webcamHarness.state().listeners===1 && webcamHarness.state().enabled');
  assert.equal((await execute('webcamHarness.state()')).prepares, 5);
  await execute('webcamHarness.activate()'); await complete(5);
  await execute('webcamHarness.resolveMedia(4)');
  await waitFor('webcamHarness.state().tracks[4]==="ended"');
  assert.equal((await execute('webcamHarness.state()')).session, 'lease-6');
  await execute('webcamHarness.enable(false)');
  await waitFor('webcamHarness.state().lease===null');
  await execute('webcamHarness.unmount(); webcamHarness.remount()');
  await waitFor('webcamHarness.state().listeners===1 && !webcamHarness.state().enabled');
  await execute('webcamHarness.activate()');
  assert.equal((await execute('webcamHarness.state()')).prepares, 6);
  assert.equal((await execute('webcamHarness.state()')).cameraPreference, false);
  await execute('webcamHarness.enable(true)');
  await waitFor('webcamHarness.state().prepares===7');
  await execute('webcamHarness.rejectPrepare(6)');
  await waitFor('!webcamHarness.state().loading && webcamHarness.state().errors.length===1');
  assert.equal((await execute('webcamHarness.state()')).error, '模拟摄像头连接失败');
  assert.equal((await execute('webcamHarness.state()')).notice, '模拟摄像头连接失败');
  assert.equal((await execute('webcamHarness.state()')).cameraPreference, true);
  await execute('webcamHarness.choose("camera-a")');
  await waitFor('webcamHarness.state().prepares===8');
  assert.equal((await execute('webcamHarness.state()')).notice, undefined);
  assert.equal((await execute('webcamHarness.state()')).error, undefined);
  await execute('webcamHarness.enable(false)');
  await execute('webcamHarness.resolvePrepare(7)');
  await waitFor('webcamHarness.state().lease===null');
  await execute('webcamHarness.unmount()');
  const closed = await execute('webcamHarness.state()');
  assert.ok(closed.tracks.every((state: string) => state === 'ended'));
  assert.deepEqual(closed.errors, ['模拟摄像头连接失败']);
  const report = { result: 'PASS', realReactStrictMode: true, mediaFullyMocked: true, hardwarePermissionsDenied: true,
    defaultsEnabledWithoutEarlyAcquisition: true, activationCoalesced: true, lateStreamsStopped: true,
    explicitDeviceSwitchDuringConnection: true, recordingAndEditorReleasePreserveEnabled: true,
    staleClosePreservesReplacement: true, unmountPendingReopenSafe: true, explicitOffRestored: true,
    singleCommandSubscription: true, allTracksReleased: true, connectionFailureReportedOutsidePanel: true, staleCameraNoticeClearedOnRetry: true,
    profile: app.getPath('userData') };
  await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report)); window.destroy(); app.exit(0);
}).catch((error: unknown) => { console.error(error); app.exit(1); });
