import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveRecordingState } from '../../shared/types';

export function useCameraSettings(state?: LiveRecordingState) {
  const open = !!state?.cameraPanel;
  const [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const pending = useRef(false);
  const setOpen = useCallback(async (next: boolean) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(undefined);
    try {
      if (!window.recordingOverlay) throw new Error('请从小录桌面版调整画面');
      await window.recordingOverlay.setCameraSettings(next);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法打开画面设置，请重试'); }
    finally { pending.current = false; setBusy(false); }
  }, []);
  useEffect(() => {
    if (!open) return;
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); void setOpen(false); } };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [open, setOpen]);
  return { open, busy, error, setOpen };
}
