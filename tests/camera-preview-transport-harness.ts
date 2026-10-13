import { CameraPreviewSender } from '../src/services/camera-preview-sender';
import { WebcamRecorder } from '../src/services/webcam-recorder';
import type { CameraPreviewMessage, CameraRecordingApi } from '../shared/types';
import type { CameraPreviewDisplay } from '../shared/camera-preview';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function until(read: () => boolean | Promise<boolean>, label: string) {
  const deadline = performance.now() + 18000;
  while (!await read()) { if (performance.now() > deadline) throw new Error('Timed out: ' + label); await wait(50); }
}

async function run() {
  const source = document.createElement('canvas'); source.width = 1920; source.height = 1080;
  const context = source.getContext('2d')!;
  context.fillStyle = '#b89076'; context.fillRect(0, 0, 1920, 1080);
  for (let x = 400; x < 600; x++) { context.fillStyle = x % 4 < 2 ? 'white' : 'black'; context.fillRect(x, 200, 1, 200); }
  let frame = 0;
  const timer = setInterval(() => { context.fillStyle = frame++ % 2 ? '#1333ee' : '#ff6611'; context.fillRect(100, 100, 200, 200); }, 1000 / 30);
  const stream = source.captureStream(30), originalTrack = stream.getVideoTracks()[0];
  const receiver = new RTCPeerConnection({ iceServers: [] });
  const video = document.createElement('video'); video.muted = true; video.autoplay = true; document.body.append(video);
  let requested!: (id: string) => void, incoming!: (message: CameraPreviewMessage) => void;
  const sessionId = crypto.randomUUID(), candidates: RTCIceCandidateInit[] = [], failures: string[] = [], chunks: ArrayBuffer[] = [];
  let queue = Promise.resolve(), revision = 0, mimeType = '';
  receiver.ontrack = event => { video.srcObject = event.streams[0] ?? new MediaStream([event.track]); void video.play(); };
  receiver.onicecandidate = event => {
    if (event.candidate) incoming({ sessionId, signal: { type: 'candidate', candidate: event.candidate.toJSON() } });
  };
  const api = {
    onCameraPreviewRequest: (callback: typeof requested) => { requested = callback; return () => {}; },
    onCameraPreviewSignal: (callback: typeof incoming) => { incoming = callback; return () => {}; },
    cameraPreviewSignal: (message: CameraPreviewMessage) => {
      queue = queue.then(async () => {
        const signal = message.signal;
        if (signal.type === 'candidate' && signal.candidate) {
          if (receiver.remoteDescription) await receiver.addIceCandidate(signal.candidate); else candidates.push(signal.candidate);
        } else if (signal.type === 'offer' && signal.sdp) {
          await receiver.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
          for (const candidate of candidates.splice(0)) await receiver.addIceCandidate(candidate);
          await receiver.setLocalDescription(await receiver.createAnswer());
          incoming({ sessionId, signal: { type: 'answer', sdp: receiver.localDescription!.sdp } });
        }
      }).catch(error => { failures.push(String(error)); });
      return Promise.resolve();
    },
    cameraStarted: async (_id: string, _time: number, actual: string) => { mimeType = actual; }, cameraAppend: async (_id: string, bytes: ArrayBuffer) => { chunks.push(bytes); },
    cameraFinish: async () => {}, cameraCancel: async () => {},
  } as unknown as CameraRecordingApi;
  const sender = new CameraPreviewSender(api, stream), archive = new WebcamRecorder('synthetic', stream, api);
  const peer = () => (sender as unknown as { sessions: Map<string, { peer: RTCPeerConnection }> }).sessions.get(sessionId)!.peer;
  const sendViewport = (value: CameraPreviewDisplay, number = ++revision, id = sessionId) => incoming({ sessionId: id,
    signal: { type: 'viewport', viewport: { ...value, revision: number } } });
  const stats = async () => {
    const report = await peer().getStats();
    const out = [...report.values()].find(value => value.type === 'outbound-rtp' && value.kind === 'video');
    const codec = out && report.get(out.codecId);
    return { framesEncoded: out?.framesEncoded ?? 0, totalEncodeTime: out?.totalEncodeTime ?? 0,
      bytesSent: out?.bytesSent ?? 0, width: out?.frameWidth, height: out?.frameHeight,
      codec: codec?.mimeType, encoder: out?.encoderImplementation, qualityLimitation: out?.qualityLimitationReason };
  };
  const display = { width: 256, height: 256, density: 1.5, visible: true };
  try {
    await archive.start(); requested(sessionId);
    sendViewport(display); // CSS demand exists before the first received frame.
    await until(() => video.readyState >= 2 && video.videoWidth > 0, 'first adaptive frame');
    await until(() => video.videoWidth >= 683 && video.videoHeight >= 384 && video.videoWidth < 750, 'small DPR cover resolution');
    const small = { width: video.videoWidth, height: video.videoHeight, stats: await stats() };
    sendViewport({ ...display, width: 960, height: 540, density: 2 });
    await until(() => video.videoWidth === 1920 && video.videoHeight === 1080, 'presenter full resolution');
    const presenter = { width: video.videoWidth, height: video.videoHeight, stats: await stats() };
    const stableStream = video.srcObject;
    sendViewport({ ...display, visible: false });
    await until(() => peer().getSenders()[0].getParameters().encodings[0].active === false, 'sender inactive');
    await wait(400); const before = await stats(); await wait(1200); const after = await stats();
    check(after.framesEncoded === before.framesEncoded, 'Hidden preview still encoded frames: ' + JSON.stringify({ before, after }));
    check(originalTrack.readyState === 'live' && originalTrack.getSettings().width === 1920, 'Hiding modified the source');
    sendViewport(display, revision - 1); sendViewport(display, 100, crypto.randomUUID());
    await wait(150); check(peer().getSenders()[0].getParameters().encodings[0].active === false, 'Stale viewport resumed hidden sender');
    sendViewport(display);
    await until(async () => (await stats()).framesEncoded > after.framesEncoded + 3, 'resumed frames');
    await until(() => video.videoWidth >= 683 && video.videoWidth < 750 && video.videoHeight >= 384, 'restored small resolution');
    check(video.srcObject === stableStream, 'Visibility must keep the same received track and peer');
    const restored = { width: video.videoWidth, height: video.videoHeight, stats: await stats() };
    check(originalTrack.getSettings().width === 1920 && originalTrack.getSettings().height === 1080, 'Archive source changed');
    await archive.finish();
    check(mimeType, 'Archive must acknowledge its actual container');
    const raw = document.createElement('video'), url = URL.createObjectURL(new Blob(chunks, { type: mimeType }));
    raw.muted = true; raw.src = url;
    try {
      await until(() => raw.readyState >= 1, 'archive metadata');
      check(raw.videoWidth === 1920 && raw.videoHeight === 1080, 'Recorded original is not 1080p');
      check(failures.length === 0, 'Preview signaling errors: ' + failures.join(';'));
      return { physicalDevicesUsed: false, simultaneousArchiveAndRtc: true, small, presenter, restored,
        hidden: { before, after, framesEncodedDelta: after.framesEncoded - before.framesEncoded },
        sameReceivedStream: true, oldRevisionsIgnored: true, archive: { width: raw.videoWidth, height: raw.videoHeight,
          bytes: chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0) } };
    } finally { raw.src = ''; URL.revokeObjectURL(url); }
  } finally {
    clearInterval(timer); sender.dispose(); receiver.close(); await archive.cancel(false);
    originalTrack.stop(); video.pause(); video.srcObject = null; video.remove();
  }
}
(window as unknown as { runCameraPreviewTransport: typeof run }).runCameraPreviewTransport = run;
