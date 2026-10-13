import { AlertCircle, Film, Info, Monitor, MousePointer2, Power, Settings2 } from 'lucide-react';
import { RECORDING_RESOLUTIONS, RECORDING_RESOLUTION_LABELS, type RecordingResolution } from '../../../shared/recording';
import type { RecorderLauncherModel } from '../../hooks/useRecorderLauncher';

export function OperationRecordingSetting({ model: m }: { model: RecorderLauncherModel }) {
  return m.status?.platform === 'darwin' ? <label className="launcher-setting-row"><MousePointer2 size={16} /><span>自动镜头{!m.inputRecording ? ' · 已关闭' : ''}</span>
    <span role="img" aria-label="操作记录说明" title="供点击高亮与自动镜头使用，需要输入监控和辅助功能；只记录位置与活动时间，不记录输入文字。"><Info size={14} /></span>
    <input type="checkbox" aria-label="记录点击与输入" disabled={m.busy} checked={m.inputRecording} onChange={event => m.setInputRecording(event.target.checked)} /></label> : null;
}

export function LauncherRecordingSettings({ model: m }: { model: RecorderLauncherModel }) {
  return <div className="launcher-more-settings">
    <div className="launcher-setting-row"><Monitor size={16} /><span>录制分辨率</span>
      <label className="launcher-field launcher-resolution-field"><select aria-label="录制分辨率" disabled={m.busy} value={m.resolution}
        onChange={event => m.setResolution(event.target.value as RecordingResolution)}>
        {RECORDING_RESOLUTIONS.map(value => <option key={value} value={value}>{RECORDING_RESOLUTION_LABELS[value]}</option>)}
      </select></label>
    </div>
    <div className="launcher-setting-row"><Settings2 size={16} /><span>录制帧率</span><div className="launcher-segmented">
      {([30, 60] as const).map(fps => <button key={fps} disabled={m.busy} aria-pressed={m.fps === fps} className={m.fps === fps ? 'active' : ''} onClick={() => m.setFps(fps)}>{fps} FPS</button>)}
    </div></div>
    <OperationRecordingSetting model={m} />
    {(m.resolution !== '1440p' || m.fps !== 30) && <button className="launcher-menu-row" disabled={m.busy}
      onClick={() => { m.setResolution('1440p'); m.setFps(30); }}><Settings2 size={17} /><span>使用推荐规格</span><small>2K · 30 FPS</small></button>}
    {m.output && <div className="launcher-output-format"><span>屏幕原片</span><output>{m.output.width} × {m.output.height} · {m.fps} FPS</output>
      <span tabIndex={0} role="img" aria-label="帧率说明" title="尺寸是保存的屏幕原片尺寸；预设只缩小、不放大。帧率为采集目标，实际更新取决于来源和电脑负载。摄像头规格在摄像头设置中单独选择。"><AlertCircle size={13} /></span></div>}
    <button className="launcher-menu-row" disabled={m.busy} onClick={() => void m.openEditor()}><Film size={17} /><span>打开编辑器</span><small>项目与导入</small></button>
    <button className="launcher-menu-row" disabled={m.busy} onClick={() => window.recorder?.quit()}><Power size={17} /><span>退出小录</span><small>{m.status?.version}</small></button>
  </div>;
}
