type DeviceKind = 'camera' | 'microphone';
type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const preferenceKey = (kind: DeviceKind) => `frameflow.recordingDevice.${kind}.v1`;
function validDeviceId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 4096
    && (value === '' || value.trim().length > 0)
    && [...value].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127);
}

/** Reading a preference never enables a device or replaces a missing selection. */
export function readRecordingDevicePreference(kind: DeviceKind, storage?: PreferenceStorage): string {
  try {
    const value: unknown = JSON.parse((storage ?? globalThis.localStorage).getItem(preferenceKey(kind)) ?? 'null');
    return validDeviceId(value) ? value : '';
  } catch { return ''; }
}

/** Persist only explicit choices or the identity of a successfully opened camera. */
export function saveRecordingDevicePreference(kind: DeviceKind, deviceId: string, storage?: PreferenceStorage): void {
  if (!validDeviceId(deviceId)) return;
  try {
    const target = storage ?? globalThis.localStorage;
    if (deviceId) target.setItem(preferenceKey(kind), JSON.stringify(deviceId));
    else target.removeItem(preferenceKey(kind));
  } catch { /* A blocked or full preference store must not prevent device selection. */ }
}
