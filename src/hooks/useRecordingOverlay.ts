import { useCallback, useEffect, useState } from 'react';
import type { LiveRecordingState, RecordingControlAction } from '../../shared/types';
import { updateAppPreferences } from '../services/app-preferences';

export function useRecordingOverlay() {
  const [state, setState] = useState<LiveRecordingState>();
  const [error, setError] = useState<string>();
  const [stopping, setStopping] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const api = window.recordingOverlay;
    if (!api) { setError('录制控制暂不可用'); return; }
    let active = true, receivedState = false;
    const unsubscribe = api.onState(next => { receivedState = true; if (active) setState(next); });
    void api.getState().then(next => { if (active && !receivedState) setState(next); }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : '无法读取录制状态');
    });
    return () => { active = false; unsubscribe(); };
  }, []);
  useEffect(() => {
    if (state?.status !== 'recording') return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [state?.status]);
  const control = useCallback(async (action: RecordingControlAction) => {
    if (!window.recordingOverlay) return;
    setError(undefined);
    if (action.type === 'stop') setStopping(true);
    try {
      await window.recordingOverlay.control(action);
      if (action.type === 'camera-effects') updateAppPreferences({ recording: { cameraEffects: action.value } });
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败，请重试'); }
    finally { if (action.type === 'stop') setStopping(false); }
  }, []);
  const elapsed = state?.startedAtUnixMs && state.status === 'recording'
    ? Math.max(0, (now - state.startedAtUnixMs) / 1000) : state?.elapsed ?? 0;
  return { state, error, elapsed, control, active: (state?.status === 'recording' || !!state?.cameraPreviewing) && !stopping,
    clearError: () => setError(undefined),
    stopping: stopping || state?.status === 'stopping' };
}
