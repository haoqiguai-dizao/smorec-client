import { DEFAULT_CAMERA_FORMAT, normalizeCameraFormat, type CameraFormatPreference } from './camera-format';

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;
const key = (deviceId: string) => `frameflow.cameraFormat.v1.${deviceId ? 'device.' + encodeURIComponent(deviceId) : 'default'}`;
const validId = (value: string) => value.length <= 4096 && [...value].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127);

/** Format choices belong to a device, never to a transient preview session. */
export function readCameraFormatPreference(deviceId: string, storage?: PreferenceStorage): CameraFormatPreference {
  if (!validId(deviceId)) return { ...DEFAULT_CAMERA_FORMAT };
  try { return normalizeCameraFormat(JSON.parse((storage ?? globalThis.localStorage).getItem(key(deviceId)) ?? 'null')); }
  catch { return { ...DEFAULT_CAMERA_FORMAT }; }
}

export function saveCameraFormatPreference(deviceId: string, format: CameraFormatPreference, storage?: PreferenceStorage): void {
  if (!validId(deviceId)) return;
  try { (storage ?? globalThis.localStorage).setItem(key(deviceId), JSON.stringify(normalizeCameraFormat(format))); }
  catch { /* Storage failure must not interrupt an already-open camera. */ }
}
