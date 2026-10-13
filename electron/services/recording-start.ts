import type { RecordingOptions } from '../../shared/types';
import type { NativeClient } from './native-client';
import type { CameraManager } from './camera';

export type RecordingStartResult = { startedAtUnixMs?: number; warnings?: string[]; cameraIndependent?: boolean };

/** Warm native devices before the encoder, then gate the Mac timeline on camera readiness. */
export async function startRecordingSources(native: Pick<NativeClient, 'request'>, camera: Pick<CameraManager, 'start'>,
  options: RecordingOptions, directory: string, excludeWindowHandles: string[], platform = process.platform,
  demo?: { captureOwnApp: boolean; ownAppVisible: boolean }): Promise<RecordingStartResult> {
  const { cameraEffects: _cameraEffects, microphoneEffects: _microphoneEffects, ...captureOptions } = options;
  const payload = { options: { ...captureOptions, excludeWindowHandles, ...demo }, directory };
  if (platform === 'darwin' && options.cameraSessionId) {
    // No screen/audio samples are saved during preparation. Opening the microphone
    // after MediaRecorder can interrupt composite cameras, so preserve this order.
    await native.request('prepare-recording', payload);
    await camera.start(options.cameraSessionId, directory);
    return native.request<RecordingStartResult>('begin-recording');
  }
  const cameraAfterNative = Boolean(options.cameraSessionId && options.microphone);
  if (options.cameraSessionId && !cameraAfterNative) await camera.start(options.cameraSessionId, directory);
  const response = await native.request<RecordingStartResult>('start', payload);
  if (options.cameraSessionId && cameraAfterNative) await camera.start(options.cameraSessionId, directory);
  return response;
}
