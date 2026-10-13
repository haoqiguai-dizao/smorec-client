import type { LiveRecordingState, RecordingControlAction } from '../../shared/types';
import type { SessionDevices } from '../components/session-controls/types';

export function recordingSessionDevices(state: LiveRecordingState | undefined, active: boolean,
  control: (action: RecordingControlAction) => Promise<void>, configuration?: {
    camera(): void; microphone(): void; enableCamera(): void; microphoneDeviceId: string; audioSelection: boolean;
  }): SessionDevices {
  const camera = !!state?.cameraAvailable && !!state.cameraVisible;
  return {
    camera: { enabled: camera, disabled: !active || !state?.cameraAvailable && !configuration,
      title: !state?.cameraAvailable ? configuration ? '开启摄像头，录制继续' : '本次未录制摄像头' : camera ? '隐藏人物画面，原始摄像头素材继续录制' : '显示人物画面',
      settings: configuration ? { label: '录制中摄像头设置', disabled: !active, toggle: configuration.camera } : undefined,
      toggle: () => !state?.cameraAvailable && configuration ? configuration.enableCamera() : void control({ type: 'camera-visible', value: !camera }) },
    microphone: { enabled: !!state?.microphoneEnabled && !state.microphoneMuted, disabled: !active || !state?.microphoneEnabled && !configuration?.audioSelection,
      title: !state?.microphoneEnabled ? configuration?.audioSelection ? '开启麦克风，录制继续' : '本次未录制麦克风' : undefined,
      settings: configuration ? { label: '录制中麦克风设置', disabled: !active, toggle: configuration.microphone } : undefined,
      toggle: () => void control(state?.microphoneEnabled ? { type: 'microphone-muted', value: !state.microphoneMuted }
        : { type: 'microphone-source', value: { enabled: true, deviceId: configuration?.microphoneDeviceId ?? '' } }) },
    system: { enabled: !!state?.systemAudioEnabled && !state.systemAudioMuted, disabled: !active || !state?.systemAudioEnabled && !configuration?.audioSelection,
      title: !state?.systemAudioEnabled ? configuration?.audioSelection ? '开启系统声音，录制继续' : '本次未录制系统声音' : undefined,
      toggle: () => void control(state?.systemAudioEnabled ? { type: 'system-muted', value: !state.systemAudioMuted } : { type: 'system-enabled', value: true }) },
  };
}
