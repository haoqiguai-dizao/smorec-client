/** Exercises a real Chromium MediaRecorder using a synthetic canvas, never a webcam. */
import { app, BrowserWindow } from 'electron';
import { mkdirSync, promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { CameraManager } from './services/camera';
import { ProjectStore } from './services/projects';
import { ffmpegPath, probeMedia } from './services/ffmpeg';
import { flushDiagnostics } from './services/diagnostics';
import { installCameraPermissions } from './services/media-permissions';

app.commandLine.appendSwitch('use-fake-device-for-media-stream');
const root = path.resolve(process.env.FRAMEFLOW_CAMERA_VERIFY_OUTPUT ?? path.join('output', 'camera-verification'));
const profile = path.join(root, 'profile');
mkdirSync(profile, { recursive: true });
app.setPath('userData', profile); app.setPath('sessionData', profile);

app.whenReady().then(async () => {
  assert.equal(app.commandLine.hasSwitch('use-fake-device-for-media-stream'), true);
  await fs.mkdir(root, { recursive: true });
  const store = new ProjectStore(); store.root = () => root;
  const camera = new CameraManager();
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, backgroundThrottling: false } });
  installCameraPermissions(window, camera, (url) => url.startsWith('file://'));
  const page = path.join(root, 'synthetic.html');
  await fs.writeFile(page, '<canvas id="canvas" width="160" height="90"></canvas>');
  await window.loadFile(page);
  assert.equal(await window.webContents.executeJavaScript(`navigator.mediaDevices.getUserMedia({video:true,audio:false}).then(s=>{s.getTracks().forEach(t=>t.stop());return 'allowed'},e=>e.name)`), 'NotAllowedError');
  await window.webContents.executeJavaScript(`
    window.cameraChunks = []; window.cameraFrame = 0;
    window.startCamera = () => new Promise((resolve) => {
      window.cameraChunks = [];
      const canvas = document.querySelector('canvas'), context = canvas.getContext('2d');
      window.paintCamera = setInterval(() => {
        context.fillStyle = 'hsl(' + (window.cameraFrame++ * 8) + ',70%,45%)'; context.fillRect(0,0,160,90);
        context.fillStyle = '#fff'; context.fillRect((window.cameraFrame*4)%140,20,20,50);
      }, 30);
      window.cameraStream = canvas.captureStream(30);
      window.recorder = new MediaRecorder(window.cameraStream, { mimeType: 'video/webm;codecs=vp8' });
      window.recorder.ondataavailable = (event) => { if(event.data.size) window.cameraChunks.push(event.data); };
      window.recorder.onstart = () => resolve(Date.now()); window.recorder.start(200);
    });
    window.stopCamera = () => new Promise((resolve) => {
      window.recorder.onstop = async () => {
        clearInterval(window.paintCamera); window.cameraStream.getTracks().forEach(track => track.stop());
        resolve(await Promise.all(window.cameraChunks.map(async blob => Array.from(new Uint8Array(await blob.arrayBuffer())))));
      }; window.recorder.stop();
    });
    true;
  `);
  let startedAt = 0;
  camera.onCommand = (command) => {
    void (async () => {
      if (command.action === 'start') {
        startedAt = await window.webContents.executeJavaScript('window.startCamera()');
        camera.started(command.id, startedAt);
      } else if (command.action === 'stop') {
        const chunks: number[][] = await window.webContents.executeJavaScript('window.stopCamera()');
        console.log(JSON.stringify({ chunks: chunks.map((chunk) => ({ size: chunk.length, header: chunk.slice(0, 12) })) }));
        for (const chunk of chunks) await camera.append(command.id, Uint8Array.from(chunk).buffer);
        await camera.finish(command.id);
      }
    })().catch((error: unknown) => { console.error(error); app.exit(1); });
  };
  assert.equal(camera.hasPermission(), false);
  const session = await camera.prepare(); assert.equal(camera.hasPermission(), true);
  assert.equal(await window.webContents.executeJavaScript(`navigator.mediaDevices.getUserMedia({video:true,audio:false}).then(s=>{s.getTracks().forEach(t=>t.stop());return 'allowed'},e=>e.name)`), 'allowed');
  assert.equal(await window.webContents.executeJavaScript(`navigator.mediaDevices.getUserMedia({video:false,audio:true}).then(s=>{s.getTracks().forEach(t=>t.stop());return 'allowed'},e=>e.name)`), 'NotAllowedError');
  const location = await store.createDirectory();
  await camera.start(session.id);
  await assert.rejects(camera.append(session.id, new ArrayBuffer(1)), /WEBM/);
  await new Promise((resolve) => setTimeout(resolve, 1300));
  const attachment = await camera.stopAndAttach(session.id, location.directory, startedAt + 200, 1);
  assert.equal(attachment.offset, 0.2); assert.equal(camera.hasPermission(), false);
  assert.equal(attachment.warnings, undefined);
  const info = await probeMedia(path.join(location.directory, attachment.filename));
  assert.ok(info.duration > 1); assert.equal(info.width, 160); assert.equal(info.height, 90);
  const screen = spawnSync(ffmpegPath(), ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=30:duration=1',
    '-c:v', 'libx264', path.join(location.directory, 'screen.mp4')], { windowsHide: true });
  assert.equal(screen.status, 0);
  await fs.writeFile(path.join(location.directory, 'cursor.json'), '[]');
  const project = await store.acceptRecording({ directory: location.directory, duration: 1, width: 160, height: 90,
    video: 'screen.mp4', cursor: 'cursor.json' }, { sourceId: 'synthetic', fps: 30, systemAudio: false, microphone: false },
  location.id, location.directory, attachment);
  assert.ok(project.media.camera); assert.equal(project.camera?.offset, 0.2);
  await store.save({ ...project, camera: { ...project.camera, size: 0.32, offset: 90, mirror: false } });
  const loaded = await store.load(project.id);
  assert.equal(loaded.camera?.size, 0.32); assert.equal(loaded.camera?.offset, 0.2); assert.equal(loaded.camera?.mirror, false);
  const canceled = await camera.prepare(); await camera.cancel(canceled.id);
  assert.equal(camera.hasPermission(), false);

  // A valid but severely truncated stream remains attached with an explicit coverage warning.
  const shortLocation = await store.createDirectory(), shortSession = await camera.prepare();
  await camera.start(shortSession.id, shortLocation.directory);
  await new Promise(resolve => setTimeout(resolve, 300));
  const shortAttachment = await camera.stopAndAttach(shortSession.id, shortLocation.directory, startedAt, 12);
  assert.match(shortAttachment.warnings?.[0] ?? '', /仅覆盖/);
  assert.ok((await fs.stat(path.join(shortLocation.directory, 'camera.webm'))).size > 0);

  // Corrupt/unfinished data is retained before a failed save cancels and cleans its staging lease.
  const failedLocation = await store.createDirectory(), failedSession = await camera.prepare();
  camera.onCommand = command => { if (command.action === 'start') camera.started(command.id, Date.now()); };
  await camera.start(failedSession.id, failedLocation.directory);
  const partial = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);
  await camera.append(failedSession.id, partial.buffer); await camera.finish(failedSession.id);
  await assert.rejects(camera.stopAndAttach(failedSession.id, failedLocation.directory, Date.now(), 12));
  await camera.cancel(failedSession.id);
  assert.deepEqual(new Uint8Array(await fs.readFile(path.join(failedLocation.directory, 'camera-recovery.webm'))), partial);
  const report = { result: 'PASS', syntheticMediaRecorder: true, fakeMediaDevices: true, profile, duration: info.duration,
    offset: attachment.offset, savedAndReloaded: true, trustedOffset: true, permissionRevoked: true, explicitVideoPermissionOnly: true,
    cameraFile: await store.media(project.id, 'camera'), shortCameraPreservedWithWarning: true, failedCameraRawPreserved: true };
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
  await flushDiagnostics(); console.log(JSON.stringify(report)); window.destroy(); app.exit(0);
}).catch((error: unknown) => { console.error(error); app.exit(1); });
