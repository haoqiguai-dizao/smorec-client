import { Monitor, Video } from 'lucide-react';
import { useRef, useState } from 'react';
import type { LiveRecordingState, RecordingControlAction } from '../../../shared/types';

export function CameraModeButton({ state, disabled, control }: {
  state: LiveRecordingState; disabled: boolean; control: (action: RecordingControlAction) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const presenter = state.cameraMode === 'presenter';
  const label = presenter ? '返回录屏' : '全屏口播';
  const switchMode = async () => {
    if (pending.current || disabled) return;
    pending.current = true; setBusy(true);
    try { await control({ type: 'camera-mode', value: presenter ? 'overlay' : 'presenter' }); }
    finally { pending.current = false; setBusy(false); }
  };
  return <button type="button" className="overlay-camera-mode" aria-label={label} title={label}
    aria-pressed={presenter} aria-busy={busy} disabled={disabled || busy} onClick={() => void switchMode()}>
    {presenter ? <Monitor size={14} /> : <Video size={14} />}<span>{label}</span>
  </button>;
}
