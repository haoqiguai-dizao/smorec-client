import type { CameraPreviewMessage, CameraRecordingApi } from '../../shared/types';
import { cameraPreviewEncoding, validCameraPreviewViewport, type CameraPreviewTier, type CameraPreviewViewport } from '../../shared/camera-preview';
import { CameraPreviewQuality, PREVIEW_QUALITY_WARMUP, cameraPreviewSample, type CameraPreviewQualitySample } from './camera-preview-quality';
import { preferCameraPreviewCodec } from './camera-preview-codecs';

interface PreviewSession {
  id: string;
  peer: RTCPeerConnection;
  senders: { sender: RTCRtpSender; track: MediaStreamTrack }[];
  candidates: RTCIceCandidateInit[];
  viewport?: CameraPreviewViewport;
  queue: Promise<void>;
  quality: CameraPreviewQuality;
  tier: CameraPreviewTier;
  sample?: CameraPreviewQualitySample;
  warmup: number;
  watch?: ReturnType<typeof setInterval>;
  polling?: boolean;
  reportedAt?: number;
}

const STATS_INTERVAL_MS = 1500;

/** Display-only encoding. Parameter changes never alter or stop the archive's source track. */
export class CameraPreviewSender {
  private sessions = new Map<string, PreviewSession>();
  private disposeListeners: (() => void)[];
  constructor(private api: CameraRecordingApi, private stream: MediaStream) {
    this.disposeListeners = [
      api.onCameraPreviewRequest(id => this.offer(id)),
      api.onCameraPreviewSignal(message => this.receive(message)),
    ];
  }
  private failed(error: unknown): void { console.warn('Camera floating preview:', error); }
  private enqueue(session: PreviewSession, action: () => Promise<void>) {
    session.queue = session.queue.then(async () => {
      if (this.sessions.get(session.id) === session) await action();
    }).catch(error => { if (this.sessions.get(session.id) === session) this.failed(error); });
  }
  private apply(session: PreviewSession): void {
    this.enqueue(session, async () => {
      const viewport = session.viewport;
      if (!viewport) return;
      for (const { sender, track } of session.senders) {
        if (this.sessions.get(session.id) !== session || session.viewport !== viewport) return;
        const settings = track.getSettings(), parameters = sender.getParameters();
        if (!parameters.encodings?.length) throw new Error('摄像头预览编码尚未准备好');
        Object.assign(parameters.encodings[0], cameraPreviewEncoding({ width: settings.width ?? 1920,
          height: settings.height ?? 1080, frameRate: settings.frameRate }, viewport, session.tier));
        // Pixel and cadence budgets are owned by the application, with hysteresis.
        parameters.degradationPreference = 'maintain-resolution';
        await sender.setParameters(parameters);
      }
    });
  }
  private watchQuality(session: PreviewSession): void {
    session.watch = setInterval(() => { void this.poll(session); }, STATS_INTERVAL_MS);
  }
  private async poll(session: PreviewSession): Promise<void> {
    const target = session.senders[0];
    if (!target || session.polling) return;
    if (!session.viewport?.visible || !session.viewport.width || !session.viewport.height
      || session.peer.connectionState !== 'connected') {
      session.sample = undefined; session.warmup = 0; session.quality.pause(); return;
    }
    session.polling = true;
    try {
      const report = await target.sender.getStats();
      if (this.sessions.get(session.id) !== session) return;
      const sample = cameraPreviewSample(report, session.sample);
      session.sample = sample;
      if (session.warmup < PREVIEW_QUALITY_WARMUP) { session.warmup++; return; }
      const verdict = session.quality.observe(sample);
      if (verdict.changed || !session.reportedAt || performance.now() - session.reportedAt >= 15000) {
        session.reportedAt = performance.now();
        void this.api.cameraPreviewQuality?.(session.id, { tier: verdict.tier, previousTier: verdict.previous,
          framesPerSecond: sample.framesPerSecond, reason: verdict.reason, sourceFrameRate: sample.sourceFrameRate,
          width: sample.width, height: sample.height, encoder: sample.encoder }).catch(error => this.failed(error));
      }
      if (verdict.changed) { session.tier = verdict.tier; this.apply(session); }
    } catch (error) { if (this.sessions.get(session.id) === session) this.failed(error); }
    finally { session.polling = false; }
  }
  private offer(id: string): void {
    this.closeSession(id);
    // Native IPC owns viewer IDs; bound abandoned peers even after a crashed receiver.
    if (this.sessions.size >= 4) this.closeSession(this.sessions.keys().next().value!);
    const peer = new RTCPeerConnection({ iceServers: [] });
    const track = this.stream.getVideoTracks()[0];
    const session: PreviewSession = { id, peer, senders: [], candidates: [], queue: Promise.resolve(),
      quality: new CameraPreviewQuality(Math.min(30, Math.max(1, track?.getSettings().frameRate || 30))),
      tier: 0, warmup: 0 };
    this.sessions.set(id, session);
    peer.onicecandidate = event => {
      if (event.candidate && this.sessions.get(session.id) === session) void this.api.cameraPreviewSignal({ sessionId: id,
        signal: { type: 'candidate', candidate: event.candidate.toJSON() } }).catch(error => this.failed(error));
    };
    for (const item of this.stream.getVideoTracks()) {
      const transceiver = peer.addTransceiver(item, { direction: 'sendonly', streams: [this.stream],
        sendEncodings: [{ active: false, scaleResolutionDownBy: 1, maxFramerate: 30 }] });
      preferCameraPreviewCodec(transceiver);
      const { sender } = transceiver;
      session.senders.push({ sender, track: item });
    }
    this.enqueue(session, async () => {
      const offer = await peer.createOffer();
      if (this.sessions.get(session.id) !== session) return;
      await peer.setLocalDescription(offer);
      if (this.sessions.get(session.id) === session) await this.api.cameraPreviewSignal({ sessionId: id, signal: { type: 'offer', sdp: offer.sdp } });
    });
  }
  private receive(message: CameraPreviewMessage): void {
    const session = this.sessions.get(message.sessionId);
    if (!session) return;
    if (message.signal.type === 'close') { this.closeSession(session.id); return; }
    const signal = message.signal;
    if (signal.type === 'viewport') {
      const viewport = signal.viewport;
      if (!validCameraPreviewViewport(viewport) || viewport.revision <= (session.viewport?.revision ?? 0)) return;
      session.viewport = viewport;
      if (!session.watch) this.watchQuality(session);
      this.apply(session);
    } else this.enqueue(session, async () => {
      if (signal.type === 'answer' && signal.sdp) {
        await session.peer.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
        if (this.sessions.get(session.id) !== session) return;
        for (const pending of session.candidates.splice(0)) await session.peer.addIceCandidate(pending);
      } else if (signal.type === 'candidate' && signal.candidate) {
        if (session.peer.remoteDescription) await session.peer.addIceCandidate(signal.candidate);
        else session.candidates.push(signal.candidate);
      }
    });
  }
  private closeSession(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    clearInterval(session.watch);
    session.peer.close();
    this.sessions.delete(id);
  }
  dispose(): void {
    this.disposeListeners.forEach(dispose => dispose());
    for (const id of this.sessions.keys()) this.closeSession(id);
  }
}
