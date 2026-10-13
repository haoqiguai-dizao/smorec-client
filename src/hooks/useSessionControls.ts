import { useEffect, useRef, useState } from 'react';
import type { RecorderLauncherModel } from './useRecorderLauncher';
import type { LiveSessionModel } from './useLiveSession';
import type { LauncherRecordingControls } from './useLauncherRecordingControls';
import type { LiveAudioChannel } from '../../shared/live-types';
import type { SessionDevices } from '../components/session-controls/types';
import { recordingSessionDevices } from '../services/recording-session-devices';
import { recordingErrorMessage } from '../services/recording-error-message';

export function useSessionControls(model: RecorderLauncherModel, live: LiveSessionModel, recording: LauncherRecordingControls) {
  const [audioPending, setAudioPending] = useState<LiveAudioChannel>();
  const pending = useRef(false);
  const currentSession = useRef(live.state.id); currentSession.current = live.state.status === 'live' ? live.state.id : undefined;
  const [error, setError] = useState<string>();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (live.state.status !== 'live') return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [live.state.status, live.state.id]);
  useEffect(() => { setError(undefined); }, [live.state.id]);
  const audio = async (channel: LiveAudioChannel) => {
    if (pending.current || !live.state.id || !window.live?.setAudio) return;
    const id = live.state.id;
    pending.current = true; setAudioPending(channel); setError(undefined);
    try {
      const applied = await window.live.setAudio(id, channel, !live.state.audio?.[channel]);
      if (id !== currentSession.current) return;
      model.setMicrophone(applied.microphone); model.setSystemAudio(applied.system);
    } catch (cause) { if (id === currentSession.current) setError(recordingErrorMessage(cause)); }
    finally { pending.current = false; setAudioPending(undefined); }
  };
  const active = live.state.status === 'live';
  const cameraReady = model.camera.enabled && !model.camera.error && !!model.camera.stream?.getVideoTracks().some(track => track.readyState === 'live');
  const enableCamera = async () => {
    if (pending.current) return;
    pending.current = true; setError(undefined);
    try { await model.camera.startWhileRecording(); }
    catch (cause) { setError(recordingErrorMessage(cause)); }
    finally { pending.current = false; }
  };
  const cameraSettings = async () => {
    if (!active || !cameraReady) return;
    setError(undefined);
    try { await window.recorder?.openCameraSettings(); }
    catch (cause) { setError(recordingErrorMessage(cause)); }
  };
  const devices: SessionDevices = recording.running ? recordingSessionDevices(recording.state, recording.active, recording.control, {
    camera: () => { recording.clearError(); model.setPanel(model.panel === 'camera' ? null : 'camera'); },
    microphone: () => { recording.clearError(); void model.refreshMicrophones(); model.setPanel(model.panel === 'microphone' ? null : 'microphone'); },
    enableCamera: () => void enableCamera(), microphoneDeviceId: recording.state?.microphoneDeviceId ?? model.microphoneDeviceId,
    audioSelection: model.status?.platform === 'darwin',
  }) : {
    camera: { enabled: cameraReady, disabled: !active, pending: model.camera.loading,
      title: model.camera.error ?? (cameraReady ? '关闭摄像头，直播继续' : '开启摄像头'),
      settings: { label: '摄像头画面设置', open: !!live.state.cameraSettingsOpen,
        disabled: !active || !cameraReady, toggle: () => void cameraSettings() },
      toggle: () => {
        model.clearError();
        if (model.camera.enabled && model.camera.error) model.camera.onRefresh();
        else model.camera.onEnabledChange(!model.camera.enabled);
      } },
    microphone: { enabled: !!live.state.audio?.microphone, disabled: !active || live.output !== 'stream' || !!audioPending || !window.live?.setAudio,
      pending: audioPending === 'microphone', title: live.output !== 'stream' ? '声音在直播伴侣中设置' : undefined, toggle: () => void audio('microphone') },
    system: { enabled: !!live.state.audio?.system, disabled: !active || live.output !== 'stream' || !!audioPending || !window.live?.setAudio,
      pending: audioPending === 'system', title: live.output !== 'stream' ? '声音在直播伴侣中设置' : undefined, toggle: () => void audio('system') },
  };
  const seconds = Math.floor(Math.max(0, (now - (live.state.startedAtUnixMs ?? now)) / 1000));
  const time = recording.running ? recording.label : `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
  const label = recording.running ? recording.stopping ? '保存中' : model.state.status === 'starting' ? '准备中' : '录屏中'
    : live.state.status === 'stopping' ? '结束中' : live.state.phase === 'preview' ? '预览中'
    : live.output === 'camera' ? '输出中' : live.state.connection?.status === 'streaming' ? '推流中'
      : live.state.connection?.status === 'reconnecting' ? '重连中' : '连接中';
  return { devices, time, label, error };
}
