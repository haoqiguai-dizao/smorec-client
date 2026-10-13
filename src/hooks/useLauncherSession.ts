import { useRef, useState } from 'react';
import { useLiveSession } from './useLiveSession';
import { useRecorderLauncher } from './useRecorderLauncher';
import { recordingErrorMessage } from '../services/recording-error-message';
import type { RecordingState } from '../../shared/types';

export function useLauncherSession() {
  const [mode, setMode] = useState<'record' | 'live'>('record');
  const [liveStep, setLiveStep] = useState<1 | 2>(1);
  const [cameraSettingsError, setCameraSettingsError] = useState<string>();
  const [cameraSettingsOpening, setCameraSettingsOpening] = useState(false);
  const openingCameraSettings = useRef(false);
  const stream = useRef<MediaStream | null>(null);
  const recordingStatus = useRef<RecordingState['status']>('idle');
  const live = useLiveSession(() => stream.current, async selected => {
    if (mode !== 'record' || recordingStatus.current !== 'recording') return;
    if (!window.recorder?.setExcludedApplications) throw new Error('请更新小录后调整录制中的排除应用');
    await window.recorder.setExcludedApplications(selected.map(application => application.id));
  });
  const model = useRecorderLauncher({ externalBusy: live.active || live.installing, applications: live.applications,
    permissionMicrophone: mode === 'live' && live.output === 'camera' ? false : undefined,
    externalError: mode === 'live' ? cameraSettingsError ?? live.error ?? (live.output === 'camera' ? live.device?.error : undefined) : undefined });
  stream.current = model.camera.stream;
  recordingStatus.current = model.state.status;
  const cameraSettingsAvailable = live.state.status === 'live' && model.camera.enabled && !model.camera.loading
    && !model.camera.error && !!model.camera.stream?.getVideoTracks().some(track => track.readyState === 'live');
  const openLiveCameraSettings = async () => {
    if (!cameraSettingsAvailable || openingCameraSettings.current) return;
    openingCameraSettings.current = true; setCameraSettingsOpening(true); setCameraSettingsError(undefined);
    try {
      if (!window.recorder) throw new Error('请从小录桌面版调整画面');
      await window.recorder.openCameraSettings(); model.setPanel(null);
    } catch (cause) { setCameraSettingsError(recordingErrorMessage(cause)); }
    finally { openingCameraSettings.current = false; setCameraSettingsOpening(false); }
  };
  return { mode, live, liveStep, setLiveStep, liveCameraSettings: mode === 'live' && live.state.status === 'live'
    ? { disabled: !cameraSettingsAvailable || cameraSettingsOpening, opening: cameraSettingsOpening, open: openLiveCameraSettings } : undefined,
    model: { ...model, clearError: () => { model.clearError(); live.clearError(); setCameraSettingsError(undefined); } },
    chooseMode: (next: 'record' | 'live') => {
      if (model.busy || next === mode) return;
      setCameraSettingsError(undefined); setMode(next); model.setPanel(next === 'live' ? 'more' : null);
      void live.refresh();
      if (next === 'live') void live.applications.refresh();
      else { void model.refreshSources(); if (model.microphone) void model.refreshMicrophones(); }
    },
    start: () => {
      if (model.canConfigurePermissions) { model.setPanel('permissions'); return; }
      if (!model.selected) return;
      setCameraSettingsError(undefined); live.clearError(); model.clearError(); model.setPanel('more');
      void live.start({ sourceId: model.selected.id, preview: true, ...(model.mode === 'region' ? { crop: model.crop } : {}),
        systemAudio: model.systemAudio, microphone: model.microphone, microphoneDeviceId: model.microphoneDeviceId,
        inputRecording: model.inputRecording });
    },
    canStart: model.canConfigurePermissions || !!model.status?.nativeAvailable && !!model.selected && !model.loadingSources
      && (model.mode !== 'region' || model.cropValid) && !model.busy
      && (!model.permissions.enabled || model.permissions.ready)
      && (live.output !== 'stream' || live.profiles.ready && (!model.microphone || !model.loadingMicrophones && !model.microphoneError && !!model.microphones.length))
      && (!model.camera.enabled || !!model.camera.stream && !model.camera.loading && !model.camera.error),
  };
}
