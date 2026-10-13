import { useEffect, useState } from 'react';
import type { MicrophoneEffects } from '../../shared/microphone-effects';
import { readMicrophoneEffects, saveMicrophoneEffects } from '../services/microphone-preferences';

export function useMicrophoneSettings(deviceId: string) {
  const [selection, setSelection] = useState(() => ({ deviceId, effects: readMicrophoneEffects(deviceId) }));
  const effects = selection.deviceId === deviceId ? selection.effects : readMicrophoneEffects(deviceId);
  useEffect(() => { setSelection({ deviceId, effects: readMicrophoneEffects(deviceId) }); }, [deviceId]);
  return { effects, setEffects: (next: MicrophoneEffects) => {
    saveMicrophoneEffects(deviceId, next); setSelection({ deviceId, effects: next });
  } };
}
