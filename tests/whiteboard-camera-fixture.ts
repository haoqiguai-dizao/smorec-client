import type { CameraPreviewMessage, CameraRecordingApi, LiveRecordingState } from '../shared/types';
import { CameraPreviewSender } from '../src/services/camera-preview-sender';
import type { WhiteboardApi } from '../shared/whiteboard/types';

/** Generated presenter raster is streamed over the shipping RTC sender; no device permission. */
export async function preparedCamera() {
  const image = new Image(); image.src = '/output/prototypes/camera-whiteboard-motion-20261011/presenter.png';
  await image.decode();
  const source = document.createElement('canvas'); source.width = 1920; source.height = 1080;
  const ctx = source.getContext('2d')!;
  const paint = () => ctx.drawImage(image, 0, 0, source.width, source.height);
  paint(); const timer = window.setInterval(paint, 1000 / 30);
  const stream = source.captureStream(30), listeners = new Set<(message: CameraPreviewMessage) => void>();
  let request!: (session: string) => void, signal!: (message: CameraPreviewMessage) => void;
  const sender = new CameraPreviewSender({
    onCameraPreviewRequest: callback => { request = callback; return () => {}; },
    onCameraPreviewSignal: callback => { signal = callback; return () => {}; },
    cameraPreviewSignal: async message => { for (const listener of listeners) listener(message); },
  } as CameraRecordingApi, stream);
  const receiver: WhiteboardApi['cameraPreview'] = {
    previewReady: async () => {
      const sessionId = crypto.randomUUID(); window.setTimeout(() => request(sessionId), 0); return { sessionId };
    },
    sendPreviewSignal: async message => { signal(message); },
    onPreviewSignal: callback => { listeners.add(callback); return () => listeners.delete(callback); },
  };
  const state: LiveRecordingState = { status: 'recording', cameraAvailable: true, cameraVisible: true,
    cameraSessionId: 'synthetic-source', cameraShape: 'rounded', cameraSize: .3, cameraMirror: false,
    microphoneEnabled: false, microphoneMuted: false, microphoneName: '', systemAudioEnabled: false, systemAudioMuted: false };
  return { source, state, receiver, close() { clearInterval(timer); sender.dispose(); stream.getTracks().forEach(track => track.stop()); } };
}
