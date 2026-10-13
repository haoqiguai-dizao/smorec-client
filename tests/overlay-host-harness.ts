import type { CameraPreviewMessage, StudioApi } from '../shared/types';
import { CameraPreviewSender } from '../src/services/camera-preview-sender';

declare global {
  interface Window {
    overlayTestBridge: {
      onRequest(callback: (id: string) => void): () => void;
      onSignal(callback: (message: CameraPreviewMessage) => void): () => void;
      signal(message: CameraPreviewMessage): Promise<void>;
    };
    overlaySynthetic: { start(): void; stop(): void; live(): boolean; encodedFrames(): Promise<number> };
  }
}
let sender: CameraPreviewSender | undefined, stream: MediaStream | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
function stop(): void {
  sender?.dispose(); sender = undefined;
  stream?.getTracks().forEach(track => track.stop()); stream = undefined;
  clearInterval(timer);
}
window.overlaySynthetic = {
  start() {
    stop();
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const context = canvas.getContext('2d')!;
    let frame = 0;
    const draw = () => {
      context.fillStyle = '#3154d8'; context.fillRect(0, 0, 320, 240);
      context.fillStyle = '#fff'; context.fillRect((frame++ * 4) % 270, 50, 50, 120);
    };
    draw(); timer = setInterval(draw, 50); stream = canvas.captureStream(20);
    const bridge = window.overlayTestBridge;
    sender = new CameraPreviewSender({ onCameraPreviewRequest: bridge.onRequest,
      onCameraPreviewSignal: bridge.onSignal, cameraPreviewSignal: bridge.signal } as StudioApi, stream);
  },
  stop,
  live: () => stream?.getVideoTracks()[0]?.readyState === 'live',
  async encodedFrames() {
    const peer = (sender as unknown as { session?: { peer: RTCPeerConnection } } | undefined)?.session?.peer;
    if (!peer) return 0;
    const stats = await peer.getStats();
    return [...stats.values()].find(value => value.type === 'outbound-rtp' && value.kind === 'video')?.framesEncoded ?? 0;
  },
};
