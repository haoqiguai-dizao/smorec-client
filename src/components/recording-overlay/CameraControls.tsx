import { FlipHorizontal2, Minus, Plus, ScrollText, Settings2, VideoOff } from 'lucide-react';
import type { LiveRecordingState, RecordingControlAction } from '../../../shared/types';
import { CameraShapePicker } from '../camera-shapes/CameraShapePicker';
import { CameraModeButton } from './CameraModeButton';
import { DEFAULT_PRESENTER } from '../../../shared/presenter';
import { PresenterAspectSelect } from '../presenter/PresenterFramingControls';

interface Props { state: LiveRecordingState; disabled: boolean; control: (action: RecordingControlAction) => Promise<void>;
  compact?: boolean; teleprompterOpen?: boolean; onTeleprompterToggle?: () => void;
  settingsBusy?: boolean; onSettingsToggle?: () => void }
export function CameraControls({ state, disabled, control, compact = false, teleprompterOpen, onTeleprompterToggle, settingsBusy, onSettingsToggle }: Props) {
  const presenter = state.cameraMode === 'presenter';
  const preparing = state.cameraPreviewing && !state.cameraStreaming;
  const cueLabel = preparing ? '提词准备' : '提词器';
  const actions = <div className={`overlay-camera-controls ${compact ? 'compact camera-shape-compact' : ''} ${presenter ? 'presenter' : ''} ${onSettingsToggle ? 'with-settings' : ''}`}>
    {!presenter && !compact && <><button aria-label="缩小摄像头" title="缩小" disabled={disabled || state.cameraSize <= .12} onClick={() => void control({ type: 'camera-size', value: Math.max(.12, Math.round((state.cameraSize - .03) * 100) / 100) })}><Minus size={16} /></button>
      <button aria-label="放大摄像头" title="放大" disabled={disabled || state.cameraSize >= .42} onClick={() => void control({ type: 'camera-size', value: Math.min(.42, Math.round((state.cameraSize + .03) * 100) / 100) })}><Plus size={16} /></button>
      <span className="overlay-divider" /></>}
    <button aria-label="镜像摄像头" title="镜像" aria-pressed={state.cameraMirror} disabled={disabled} onClick={() => void control({ type: 'camera-mirror', value: !state.cameraMirror })}><FlipHorizontal2 size={16} /></button>
    {compact && !presenter && <button aria-label={preparing ? '关闭摄像头' : '隐藏摄像头'} title={preparing ? '关闭摄像头' : '隐藏摄像头'}
      disabled={disabled} onClick={() => void control({ type: 'camera-visible', value: false })}><VideoOff size={16} /></button>}
    {onSettingsToggle && <button type="button" aria-label="画面设置" title="画面设置" aria-expanded={!!state.cameraPanel}
      disabled={disabled || settingsBusy || state.countdown !== undefined} onClick={onSettingsToggle}><Settings2 size={16} /></button>}
  </div>;
  const mode = <CameraModeButton state={state} disabled={disabled} control={control} />;
  const framing = state.cameraPresenter ?? DEFAULT_PRESENTER;
  const aspect = presenter && <PresenterAspectSelect value={framing.aspect}
    disabled={disabled || !state.cameraPreviewing || !['idle', 'error'].includes(state.status) || state.countdown !== undefined}
    onChange={value => void control({ type: 'camera-presenter', value: { ...framing, aspect: value } })} />;
  return compact ? <div className={`overlay-camera-dock ${presenter ? 'presenter' : ''}`}>
    {actions}
    {presenter && onTeleprompterToggle && <button type="button" className="overlay-camera-teleprompter" aria-label={cueLabel}
      title={cueLabel} aria-pressed={!!teleprompterOpen} disabled={disabled || state.countdown !== undefined} onClick={onTeleprompterToggle}><ScrollText size={14} /><span>{cueLabel}</span></button>}
    {mode}{aspect}
  </div> : <div className="overlay-camera-settings">
    {mode}{aspect}
    {!presenter && <CameraShapePicker value={state.cameraShape} disabled={disabled} onChange={value => void control({ type: 'camera-shape', value })} />}
    {actions}
  </div>;
}
