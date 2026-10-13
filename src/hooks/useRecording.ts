import { useCallback, useEffect, useState } from 'react';
import type { AppStatus, RecordingState } from '../../shared/types';

/** The editor observes capture; the independent launcher owns its devices and setup. */
export function useRecording(reportError: (message: string) => void, beforeRecord: () => Promise<unknown>) {
  const [appStatus, setAppStatus] = useState<AppStatus | null>(null);
  const [state, setState] = useState<RecordingState>({ status: 'idle' });
  const open = useCallback(async () => {
    try {
      if (!window.studio) throw new Error('请使用小录桌面版进行录制');
      await beforeRecord();
      await window.studio.openRecorder();
    } catch (error) { reportError(error instanceof Error ? error.message : '无法打开录制栏'); }
  }, [beforeRecord, reportError]);
  const stop = useCallback(async () => {
    if (!window.studio) return;
    try { await window.studio.stopRecording(); }
    catch (error) { reportError(error instanceof Error ? error.message : '停止录制失败'); }
  }, [reportError]);

  useEffect(() => {
    if (!window.studio) return;
    void window.studio.getStatus().then(setAppStatus).catch((error: Error) => reportError(error.message));
    return window.studio.onRecordingState(next => {
      setState(next);
      if (next.status === 'error' && next.error) reportError(next.error);
      else if (next.warnings?.length) reportError(next.warnings.join('；'));
    });
  }, [reportError]);
  return { appStatus, state, elapsed: state.elapsed ?? 0, open, stop };
}
