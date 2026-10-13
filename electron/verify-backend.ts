/** Synthetic-only integration check. No user screen or microphone is captured. */
import { app, dialog, net, type BrowserWindow } from 'electron';
import { spawnSync } from 'node:child_process';
import { mkdirSync, promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Exporter } from './services/exporter';
import { ffmpegPath, probeMedia } from './services/ffmpeg';
import { ProjectStore } from './services/projects';
import { parseProject } from './services/validation';
import { installProtocol } from './services/protocol';

const root = path.resolve(process.env.FRAMEFLOW_SYNTHETIC_OUTPUT ?? 'output/backend-verification');
const profile = path.join(root, 'profile');
mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.setPath('sessionData', profile);

app.whenReady().then(async () => {
  await fs.mkdir(root, { recursive: true });
  const store = new ProjectStore();
  store.root = () => root;
  installProtocol(store);
  const location = await store.createDirectory();
  const run = (args: string[]) => {
    const result = spawnSync(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true });
    assert.equal(result.status, 0, result.stderr.toString());
  };
  run(['-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=30:duration=1', '-c:v', 'libx264', path.join(location.directory, 'screen.mp4')]);
  run(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', path.join(location.directory, 'system.wav')]);
  run(['-f', 'lavfi', '-i', 'sine=frequency=880:duration=1', path.join(location.directory, 'microphone.wav')]);
  await fs.writeFile(path.join(location.directory, 'cursor.json'), JSON.stringify([{ t: 0.25, x: 0.3, y: 0.4, visible: true, click: true }]));
  const project = await store.acceptRecording({ directory: location.directory, duration: 1, width: 160, height: 90,
    video: 'screen.mp4', cursor: 'cursor.json', systemAudio: 'system.wav', microphone: 'microphone.wav' },
  { sourceId: 'test', fps: 30, systemAudio: true, microphone: true }, location.id, location.directory);
  assert.equal(project.zooms.length, 1);
  assert.ok(project.media.screen.startsWith('frameflow://media/'));
  const range = await net.fetch(project.media.screen, { headers: { Range: 'bytes=2-11' } });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 10);
  assert.equal(range.headers.get('access-control-allow-origin'), 'frameflow://app');
  assert.equal((await net.fetch(`frameflow://media/${project.id}/missing`)).status, 404);
  assert.equal((await net.fetch(project.media.screen, { headers: { Range: 'bytes=999999999-9999999999' } })).status, 416);
  project.clips = [{ id: 'a', start: 0, end: 0.3 }, { id: 'b', start: 0.6, end: 1 }];
  await store.save(project);
  const loaded = await store.load(project.id);
  assert.equal(loaded.clips.length, 2);
  await assert.rejects(store.media('../invalid', 'screen'));
  await assert.rejects(store.media(project.id, '../screen.mp4'));
  assert.throws(() => parseProject({ ...project, duration: Number.NaN }));
  const frameFile = path.join(root, 'synthetic.ivf');
  run(['-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=30:duration=0.7', '-c:v', 'libvpx', '-f', 'ivf', frameFile]);
  const encoded = await fs.readFile(frameFile);
  const frames: Buffer[] = [];
  for (let offset = 32; offset < encoded.length;) {
    const size = encoded.readUInt32LE(offset);
    frames.push(Buffer.from(encoded.subarray(offset, offset + 12 + size)));
    offset += 12 + size;
  }
  const target = path.join(root, 'verified-export.mp4');
  dialog.showSaveDialog = (async () => ({ canceled: false, filePath: target })) as typeof dialog.showSaveDialog;
  const exporter = new Exporter(store);
  const settings = { width: 160, height: 90, fps: 30 as const, frames: frames.length };
  const session = await exporter.start({} as BrowserWindow, loaded, settings);
  assert.ok(session);
  for (const [i, frame] of frames.entries()) {
    frame.writeBigUInt64LE(BigInt(i), 4);
    await exporter.append(session.id, Uint8Array.from(frame).buffer);
  }
  assert.equal(await exporter.finish(session.id), target);
  const media = await probeMedia(target);
  assert.equal(media.width, 160); assert.equal(media.height, 90); assert.equal(media.hasAudio, true);
  assert.ok(Math.abs(media.duration - 0.7) < 0.06);
  // Cancellation and incomplete frame rejection must leave the previous successful file intact.
  const before = await fs.readFile(target);
  const second = await exporter.start({} as BrowserWindow, loaded, settings);
  assert.ok(second);
  await assert.rejects(exporter.finish(second.id), /帧数不完整/);
  await exporter.cancel(second.id);
  assert.deepEqual(await fs.readFile(target), before);
  assert.equal((await fs.readdir(root)).filter((file) => file.includes('.part.mp4')).length, 0);
  const avi = path.join(root, 'import-source.avi');
  run(['-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=30:duration=0.7', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=0.7',
    '-c:v', 'mpeg4', '-c:a', 'pcm_s16le', '-shortest', avi]);
  dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [avi] })) as typeof dialog.showOpenDialog;
  const imported = await store.importVideo({} as BrowserWindow);
  assert.ok(imported);
  assert.equal(imported.media.systemAudio, imported.media.screen);
  assert.equal(imported.style.showCursor, false);
  assert.ok((await probeMedia(await store.media(imported.id, 'screen'))).browserCompatible);
  const third = await exporter.start({} as BrowserWindow, imported, settings);
  assert.ok(third);
  for (const frame of frames) await exporter.append(third.id, Uint8Array.from(frame).buffer);
  await exporter.finish(third.id);
  assert.equal((await probeMedia(target)).hasAudio, true);
  const report = { result: 'PASS', frames: frames.length, duration: media.duration,
    audio: media.hasAudio, clips: loaded.clips.length, mediaRangeAndCors: true, importedAviNormalized: true, importedAudioPreserved: true, path: target };
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  app.exit(0);
}).catch((error: unknown) => { console.error(error); app.exit(1); });
