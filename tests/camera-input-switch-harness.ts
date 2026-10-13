import { Input, BlobSource, MP4, WEBM, CanvasSink, VideoSampleSink } from 'mediabunny';
import { SwitchableWebcamRecorder } from '../src/services/switchable-webcam-recorder';
import type { CameraRecordingApi } from '../shared/types';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function source(width: number, height: number, color: string) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d')!; let n = 0;
  const paint = () => { ctx.fillStyle = color; ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#fff'; ctx.fillRect(10 + n++ % 100, 10, 20, 20); };
  paint(); const timer = setInterval(paint, 1000 / 30), stream = canvas.captureStream(30);
  return { stream, close() { clearInterval(timer); stream.getTracks().forEach(track => track.stop()); } };
}
const output = document.getElementById('result')!;
document.getElementById('run')!.onclick = async () => {
  const first = source(1280, 720, '#f00000'), second = source(640, 480, '#0000f0'), third = source(1920, 1080, '#00f000');
  const chunks: ArrayBuffer[] = [], calls: string[] = [], faults: string[] = []; let mime = '', fileUrl: string | undefined;
  const api = { cameraStarted: async (_id: string, _t: number, type: string) => { mime = type; calls.push('start'); },
    cameraAppend: async (_id: string, bytes: ArrayBuffer) => { chunks.push(bytes); },
    cameraFinish: async () => { calls.push('finish'); }, cameraCancel: async () => { calls.push('cancel'); },
    cameraFrameStall: async () => { faults.push('stalled'); }, cameraFrameResumed: async () => {},
  } as unknown as CameraRecordingApi;
  const recorder = new SwitchableWebcamRecorder('input-switch', first.stream, api, error => faults.push(String(error)));
  try {
    output.textContent = '连续录制与切换中'; await recorder.ready();
    const track = recorder.stream.getVideoTracks()[0], preview = document.getElementById('preview') as HTMLVideoElement;
    preview.srcObject = recorder.stream; await preview.play();
    await recorder.start(); const origin = performance.now();
    await wait(1200); await recorder.replace(second.stream); const secondAt = (performance.now() - origin) / 1000;
    check(first.stream.getVideoTracks()[0].readyState === 'ended', 'accepted source did not retire old device');
    await wait(1500); await recorder.replace(third.stream); const thirdAt = (performance.now() - origin) / 1000;
    check(recorder.stream.getVideoTracks()[0] === track, 'encoding track changed');
    await wait(1500); await recorder.finish();
    check(calls.join() === 'start,finish' && faults.length === 0, 'writer restarted or failed: ' + calls + faults);
    const blob = new Blob(chunks, { type: mime });
    const input = new Input({ source: new BlobSource(blob), formats: [MP4, WEBM] });
    try {
      const video = await input.getPrimaryVideoTrack(); check(video && await video.canDecode(), 'archive cannot decode');
      const timestamps: number[] = [];
      for await (const sample of new VideoSampleSink(video).samples()) { timestamps.push(sample.timestamp); sample.close(); }
      const maxGap = Math.max(...timestamps.slice(1).map((t, i) => t - timestamps[i]));
      const frames = new CanvasSink(video, { poolSize: 1 }); const colors: number[][] = [];
      for await (const frame of frames.canvasesAtTimestamps([.5, secondAt + .5, thirdAt + .5])) {
        check(frame, 'missing decoded frame'); const ctx = frame.canvas.getContext('2d') as CanvasRenderingContext2D;
        check(frame.canvas.width === 1280 && frame.canvas.height === 720, 'encoding dimensions changed');
        colors.push([...ctx.getImageData(640, 360, 1, 1).data].slice(0, 3));
      }
      check(colors[0][0] > 200 && colors[1][2] > 200 && colors[2][1] > 200, 'replay did not contain each selected input');
      const duration = timestamps.at(-1)! - timestamps[0], fps = timestamps.length / duration;
      check(fps > 20 && maxGap < .3, 'encoding clock stalled: ' + JSON.stringify({ fps, maxGap }));
      const receipt = { passed: true, frames: timestamps.length, duration, fps, maxGap, colors, secondAt, thirdAt, bytes: blob.size, mime, calls, stableTrack: true, dimensions: [1280, 720] };
      output.dataset.receipt = JSON.stringify(receipt); output.textContent = JSON.stringify(receipt);
      fileUrl = URL.createObjectURL(blob); const link = document.getElementById('download') as HTMLAnchorElement;
      link.hidden = false; link.href = fileUrl; link.download = mime.includes('mp4') ? 'camera-hot-switch.mp4' : 'camera-hot-switch.webm';
    } finally { input.dispose(); }
  } catch (error) { output.dataset.error = String(error); output.textContent = String(error); await recorder.cancel().catch(() => {}); }
  finally { first.close(); second.close(); third.close(); }
  if (fileUrl) window.addEventListener('pagehide', () => URL.revokeObjectURL(fileUrl!), { once: true });
};
