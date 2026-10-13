import { cameraConstraints, cameraFormatUnsupported } from './camera-quality';
import type { CameraFormatPreference } from './camera-format';
import { CameraConnectionCanceledError, cameraConnectionCanceled } from './camera-errors';

/** Initial connection and recording replacement negotiate the same explicit device. */
export async function openCameraInput(media: (constraints: MediaStreamConstraints) => Promise<MediaStream>,
  deviceId: string, format: CameraFormatPreference, signal: AbortSignal): Promise<MediaStream> {
  if (signal.aborted) throw new CameraConnectionCanceledError();
  try { return await media(cameraConstraints(deviceId, format)); }
  catch (error) {
    if (signal.aborted) throw new CameraConnectionCanceledError();
    if (error instanceof Error && error.name === 'AbortError' && !cameraConnectionCanceled(error)
      && format.resolution === 'auto' && deviceId) {
      return media({ audio: false, video: { deviceId: { exact: deviceId }, resizeMode: { exact: 'none' } } as MediaTrackConstraints });
    }
    if (!cameraFormatUnsupported(error) || format.resolution !== 'auto') throw error;
    console.warn('摄像头帧率约束不可用，沿用同一设备协商格式', error);
    return media({ audio: false, video: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), frameRate: { ideal: 30 } } });
  }
}
