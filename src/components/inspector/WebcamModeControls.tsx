import { Monitor, Video } from 'lucide-react';
import type { WebcamStyle } from '../../../shared/types';
import { cameraModeAt } from '../../../shared/camera-modes';
import { Section, Toggle } from './Controls';
import './webcam-mode.css';

export function WebcamModeControls({ camera, sourceTime, onChange }: {
  camera: WebcamStyle; sourceTime: number; onChange: (camera: WebcamStyle) => void;
}) {
  const mode = cameraModeAt(camera, sourceTime);
  return <Section title="画面模式" help="跟随录制时，模式按录制中的切换时间变化。选择下方模式可应用于整段视频；返回录屏小窗会保留原来的布局。">
    {!!camera.modeKeyframes?.length && <Toggle label="跟随录制切换" checked={camera.useRecordedMode !== false}
      onChange={useRecordedMode => onChange({ ...camera, useRecordedMode, ...(!useRecordedMode ? { mode } : {}) })} />}
    <div className="webcam-mode-options" role="group" aria-label="摄像头画面模式">
      <button type="button" aria-label="录屏小窗" aria-pressed={mode === 'overlay'}
        onClick={() => onChange({ ...camera, mode: 'overlay', useRecordedMode: false })}><Monitor size={18} /><span>录屏小窗</span></button>
      <button type="button" aria-label="全屏口播" aria-pressed={mode === 'presenter'}
        onClick={() => onChange({ ...camera, enabled: true, mode: 'presenter', useRecordedMode: false })}><Video size={18} /><span>全屏口播</span></button>
    </div>
  </Section>;
}
