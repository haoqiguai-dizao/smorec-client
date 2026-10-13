import { GripVertical, Mic, MicOff, MoreHorizontal, Video, VideoOff, Volume2, VolumeX } from 'lucide-react';
import type { LauncherRecordingControls } from '../../hooks/useLauncherRecordingControls';
import { RecordingStop, RecordingTimer } from './RecordingSessionControls';

export function RecordingSessionToolbar({ recording, toolsOpen, toggleTools }: {
  recording: LauncherRecordingControls; toolsOpen: boolean; toggleTools(): void;
}) {
  const state = recording.state;
  const camera = !!state?.cameraAvailable && !!state.cameraVisible;
  const microphone = !!state?.microphoneEnabled && !state.microphoneMuted;
  const system = !!state?.systemAudioEnabled && !state.systemAudioMuted;
  const toggleCamera = () => void recording.control(state?.cameraMode === 'presenter'
    ? { type: 'camera-mode', value: 'overlay' } : { type: 'camera-visible', value: !camera });
  return <header className="launcher-bar launcher-bar-running recording-session-bar" aria-label="小录 录制栏" data-toolbar-surface>
    <div className="recording-session-controls">
      <span className="launcher-grip" title="拖动录制栏"><GripVertical size={16} /></span>
      <RecordingTimer recording={recording} />
      <div className="recording-session-toggles" role="group" aria-label="录制中控制">
        <button className="recording-session-toggle" aria-label={state?.cameraMode === 'presenter' ? '返回录屏' : camera ? '隐藏摄像头' : '显示摄像头'}
          aria-pressed={camera} title={!state?.cameraAvailable ? '未录制摄像头' : camera ? '隐藏人物画面' : '显示人物画面'}
          disabled={!recording.active || !state?.cameraAvailable} onClick={toggleCamera}>
          {camera ? <Video size={17} /> : <VideoOff size={17} />}<span>人物</span>
        </button>
        <button className="recording-session-toggle" aria-label={!state?.microphoneEnabled ? '未录制麦克风' : microphone ? '麦克风静音' : '取消麦克风静音'}
          aria-pressed={microphone} title={!state?.microphoneEnabled ? '未录制麦克风' : microphone ? '静音麦克风' : '打开麦克风声音'}
          disabled={!recording.active || !state?.microphoneEnabled}
          onClick={() => void recording.control({ type: 'microphone-muted', value: !state?.microphoneMuted })}>
          {microphone ? <Mic size={17} /> : <MicOff size={17} />}<span>麦克风</span>
        </button>
        <button className="recording-session-toggle" aria-label={system ? '系统声音' : '系统声音 · 已静音'}
          aria-pressed={system} title={!state?.systemAudioEnabled ? '未录制系统声音' : system ? '静音系统声音' : '打开系统声音'}
          disabled={!recording.active || !state?.systemAudioEnabled}
          onClick={() => void recording.control({ type: 'system-muted', value: !state?.systemAudioMuted })}>
          {system ? <Volume2 size={17} /> : <VolumeX size={17} />}<span>系统声</span>
        </button>
      </div>
      <button className="recording-session-toggle recording-session-more" aria-label="更多设置" aria-expanded={toolsOpen}
        aria-controls="recording-session-tools" disabled={!recording.active} onClick={toggleTools}>
        <MoreHorizontal size={18} /><span>更多</span>
      </button>
      <RecordingStop recording={recording} />
    </div>
  </header>;
}
