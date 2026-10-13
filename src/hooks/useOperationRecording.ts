import { useEffect, useRef, useState } from 'react';
import type { RecordingPreferences, AppPreferencesPatch } from '../services/app-preferences';

/** Permission fallback is one session, while the explicit Settings switch remains a preference. */
export function useOperationRecording(initial: RecordingPreferences, active: boolean,
  remember: (patch: AppPreferencesPatch['recording']) => void) {
  const [enabled, setEnabled] = useState(initial.inputRecording);
  const [confirmed, setConfirmed] = useState(initial.inputRecordingConfirmed);
  const [skipped, setSkipped] = useState(false);
  const previouslyActive = useRef(active);
  useEffect(() => {
    if (previouslyActive.current && !active) setSkipped(false);
    previouslyActive.current = active;
  }, [active]);
  return { inputRecording: enabled && !skipped, inputNeedsConfirmation: !enabled && !confirmed && !skipped,
    setInputRecording: (next: boolean) => { setEnabled(next); setConfirmed(true); setSkipped(false); remember({ inputRecording: next, inputRecordingConfirmed: true }); },
    skipInputRecording: () => setSkipped(true) };
}
