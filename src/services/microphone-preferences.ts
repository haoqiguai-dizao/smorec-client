import { DEFAULT_MICROPHONE_EFFECTS, normalizeMicrophoneEffects, type MicrophoneEffects } from '../../shared/microphone-effects';

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;
const key = (deviceId: string) => `frameflow.microphoneEffects.v1.${encodeURIComponent(deviceId || 'default')}`;

export function readMicrophoneEffects(deviceId: string, storage?: PreferenceStorage): MicrophoneEffects {
  try { return normalizeMicrophoneEffects(JSON.parse((storage ?? globalThis.localStorage).getItem(key(deviceId)) ?? 'null'), DEFAULT_MICROPHONE_EFFECTS); }
  catch { return normalizeMicrophoneEffects(undefined, DEFAULT_MICROPHONE_EFFECTS); }
}

export function saveMicrophoneEffects(deviceId: string, effects: MicrophoneEffects, storage?: PreferenceStorage): void {
  try { (storage ?? globalThis.localStorage).setItem(key(deviceId), JSON.stringify(normalizeMicrophoneEffects(effects))); }
  catch { /* Full storage must not interrupt recording; current in-memory settings still apply. */ }
}
