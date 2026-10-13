import type { CameraManager } from './camera';
import type { RecordingController } from './recording';
import type { RecordingHud } from './recording-hud';
import type { RecorderLauncher, RecorderLauncherOptions } from './recorder-launcher';
import type { CameraPreviewMessage } from '../../shared/types';
import { diagnostic } from './diagnostics';
import { parseCameraEffects, string } from './validation';

type Callbacks = Pick<RecorderLauncherOptions,
  'onCameraPrepare' | 'onCameraAttach' | 'onCameraStarted' | 'onCameraAppend' | 'onCameraFinish' | 'onCameraCancel'
  | 'onCameraFrameStall' | 'onCameraFrameResumed' | 'onCameraPreviewSignal' | 'onCameraPreviewQuality'
  | 'onCameraPreviewReady' | 'onCameraPreviewClosed' | 'onCameraPreviewCountdown'>;

/** Acquisition/preview/recording leases share one owner and one set of trust checks. */
export function recordingCameraCallbacks({ camera, recording, hud, launcher, live, quitting }: {
  camera: CameraManager; recording: RecordingController; hud: RecordingHud;
  launcher(): RecorderLauncher; live(): { active: boolean; status: string }; quitting(): boolean;
}): Callbacks {
  return {
  onCameraPrepare: () => {
    if (quitting() || recording.isActive() && recording.state.status !== 'recording' || live().active && live().status !== 'live') throw new Error('当前无法准备摄像头');
    return camera.prepare();
  },
  onCameraAttach: id => recording.attachCamera(id),
  onCameraStarted: (id, timestamp, mimeType) => camera.started(id, timestamp, mimeType),
  onCameraAppend: (id, data) => camera.append(id, data),
  onCameraFinish: id => camera.finish(id),
  onCameraCancel: async id => {
    recording.controls.endPreview(string(id, 36));
    await camera.cancel(id); recording.cameraInterrupted(id);
  },
  onCameraFrameStall: (id, stalledSeconds) => camera.reportFrameStall(id, stalledSeconds),
  onCameraFrameResumed: id => camera.reportFrameResumed(id),
  onCameraPreviewSignal: message => hud.signalFromHost(message as CameraPreviewMessage),
  onCameraPreviewQuality: (id, detail) => {
    if (quitting()) return;
    // Display health only reaches diagnostics as named scalars; never as arbitrary renderer objects.
    const report = typeof detail === 'object' && detail !== null ? detail as Record<string, unknown> : {};
    diagnostic('camera.preview-quality', undefined, { id: string(id, 36),
      tier: report.tier, previousTier: report.previousTier, framesPerSecond: report.framesPerSecond,
      sourceFrameRate: typeof report.sourceFrameRate === 'number' ? report.sourceFrameRate : undefined,
      width: typeof report.width === 'number' ? report.width : undefined,
      height: typeof report.height === 'number' ? report.height : undefined,
      encoder: typeof report.encoder === 'string' ? report.encoder.slice(0, 120) : undefined,
      reason: typeof report.reason === 'string' ? report.reason.slice(0, 64) : undefined });
  },
  onCameraPreviewReady: (value, effects) => {
    const id = string(value, 36);
    // A delayed renderer message must never reopen a camera after navigation or device replacement.
    if (quitting() || recording.isActive() || live().active
      || !launcher().isVisible() || !camera.isPrepared(id)) return;
    recording.controls.preparePreview(id, parseCameraEffects(effects));
  },
  onCameraPreviewClosed: id => recording.controls.endPreview(string(id, 36)),
  onCameraPreviewCountdown: (id, value) => {
    if (quitting()) return;
    recording.controls.previewCountdown(string(id, 36), value);
  },
  };
}
