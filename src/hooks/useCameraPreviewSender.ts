import { useEffect } from 'react';
import { CameraPreviewSender } from '../services/camera-preview-sender';

export function useCameraPreviewSender(stream: MediaStream | null): void {
  useEffect(() => {
    const api = window.recorder ?? window.studio;
    if (!stream || !api) return;
    const sender = new CameraPreviewSender(api, stream);
    return () => sender.dispose();
  }, [stream]);
}
