/** Real Mac live frame pipe; no virtual-camera registration, microphone, or camera input. */
import { app, BrowserWindow, screen } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NativeClient } from './services/native-client';
import { LiveFrameClient } from './services/live/frame-client';
import type { CaptureSource } from '../shared/types';

const root = process.env.XIAOLU_DEMO_ROOT!;
const output = path.join(root, 'output/demo-mode');
(app as typeof app & { setAppPath(value: string): void }).setAppPath(root);
app.setPath('userData', path.join(output, 'live-profile'));
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const native = new NativeClient();
let client: LiveFrameClient | undefined;
const report: Record<string, unknown> = { result: 'PENDING', scope: 'native frame pipe; external virtual-camera receiver unverified' };
app.whenReady().then(async () => {
  const area = screen.getPrimaryDisplay().workArea;
  const window = new BrowserWindow({ x: area.x + 40, y: area.y + 40, width: 600, height: 400,
    frame: false, show: true, alwaysOnTop: true, backgroundColor: '#194339', webPreferences: { sandbox: true } });
  await window.loadURL('data:text/html,<body style="background:%23194339;color:white;font:32px sans-serif">小录直播演示验收</body>');
  const capability = await native.request<{ screenPermission: boolean }>('capabilities');
  assert.ok(capability.screenPermission, 'Existing native Screen Recording permission required');
  const sources = await native.request<CaptureSource[]>('sources');
  const source = sources.find(value => value.kind === 'screen' && value.bounds
    && area.x >= value.bounds.x && area.x < value.bounds.x + value.bounds.width)!;
  assert.ok(source?.bounds);
  const scale = source.width / source.bounds.width;
  const pipeName = 'xiaolu-live-' + randomUUID();
  const dimensions = await native.request<{ width: number; height: number }>('live-start', { pipeName,
    options: { sourceId: source.id, systemAudio: false, microphone: false, fps: 30, resolution: '1080p',
      captureOwnApp: true, ownAppVisible: true, excludedApplications: [],
      crop: { x: Math.round((window.getBounds().x - source.bounds.x) * scale),
        y: Math.round((window.getBounds().y - source.bounds.y) * scale), width: Math.round(600 * scale), height: Math.round(400 * scale) } } });
  client = new LiveFrameClient(dimensions.width, dimensions.height); await client.connect(pipeName);
  const samples: { time: number; rgb: number[] }[] = [];
  const sample = async () => {
    await delay(300); const time = await client!.pull();
    const offset = (Math.floor(dimensions.height * .8) * dimensions.width + Math.floor(dimensions.width * .8)) * 4;
    const pixel = client!.pixels.subarray(offset, offset + 4);
    const value = { time, rgb: [pixel[2], pixel[1], pixel[0]] }; samples.push(value); return value;
  };
  const first = await sample(); await native.request('live-demo', { visible: false }); const hidden = await sample();
  await native.request('live-demo', { visible: true }); const restored = await sample();
  const green = (rgb: number[]) => rgb[1] > rgb[0] + 20 && rgb[1] > rgb[2] + 5;
  assert.ok(green(first.rgb) && !green(hidden.rgb) && green(restored.rgb), JSON.stringify(samples));
  assert.ok(first.time < hidden.time && hidden.time < restored.time, 'Same live source clock survives switching');
  report.result = 'PASS'; report.samples = samples; report.frameDimensions = dimensions;
  client.close(); await native.request('live-stop'); native.dispose();
  window.destroy(); await fs.writeFile(path.join(output, 'live-report.json'), JSON.stringify(report, null, 2)); app.exit(0);
}).catch(async error => {
  report.result = 'FAIL'; report.error = error.stack ?? String(error);
  client?.close(); native.dispose();
  await fs.writeFile(path.join(output, 'live-report.json'), JSON.stringify(report, null, 2)); app.exit(1);
});
