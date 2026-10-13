import { useCameraSettings } from './useCameraSettings';
import { useRecordingOverlay } from './useRecordingOverlay';
import type { RecordingState } from '../../shared/types';

export function useLauncherRecordingControls(status: RecordingState['status']) {
  const overlay = useRecordingOverlay();
  const settings = useCameraSettings(overlay.state);
  const running = ['starting', 'recording', 'stopping'].includes(status);
  const seconds = Math.max(0, Math.floor(overlay.elapsed));
  const label = `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
  return { ...overlay, running, settings, label, error: running ? overlay.error ?? settings.error ?? overlay.state?.warnings?.join('；') : undefined };
}

export type LauncherRecordingControls = ReturnType<typeof useLauncherRecordingControls>;
