import { useEffect } from 'react';
import type { CameraEffects } from '../../shared/types';

/** Called after useWebcam installs the sender; publishing cannot race its offer subscription. */
export function usePreparedCameraPreview(stream: MediaStream | null, sessionId: string | undefined,
  effects: CameraEffects, report: (message: string | undefined) => void): void {
  useEffect(() => {
    if (!stream || !sessionId || !window.recorder) return;
    const api = window.recorder;
    return () => { void api.cameraPreviewClosed(sessionId).catch(() => undefined); };
  }, [stream, sessionId]);
  useEffect(() => {
    if (!stream || !sessionId || !window.recorder) return;
    let current = true;
    void window.recorder.cameraPreviewReady(sessionId, effects).catch(error => {
      if (current) report(error instanceof Error ? error.message : '桌面摄像头预览暂不可用');
    });
    return () => { current = false; };
  }, [stream, sessionId, effects, report]);
}
