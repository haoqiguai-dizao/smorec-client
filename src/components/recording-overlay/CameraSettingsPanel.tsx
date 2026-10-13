import { FlipHorizontal2, Settings2, X } from 'lucide-react';
import type { LiveRecordingState, RecordingControlAction } from '../../../shared/types';
import { ORIGINAL_CAMERA_EFFECTS } from '../../../shared/camera-effects';
import { DEFAULT_PRESENTER } from '../../../shared/presenter';
import { PresenterCropControls } from '../presenter/PresenterFramingControls';
import { CameraEffectsControls } from '../camera-effects/CameraEffectsControls';
import { CameraShapePicker } from '../camera-shapes/CameraShapePicker';
import './camera-settings-panel.css';

interface Props {
  state: LiveRecordingState;
  disabled: boolean;
  control: (action: RecordingControlAction) => Promise<void>;
  onClose: () => void;
  onCompare: (original: boolean) => void;
}
export function CameraSettingsPanel({ state, disabled, control, onClose, onCompare }: Props) {
  const bounds = state.cameraPanel?.settings;
  if (!bounds) return null;
  const presenter = state.cameraMode === 'presenter';
  const framing = state.cameraPresenter ?? DEFAULT_PRESENTER;
  return <section className="camera-settings-panel" aria-label="画面设置"
    style={{ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }}>
    <header><Settings2 size={15} /><strong>画面设置</strong><button type="button" aria-label="收起画面设置" title="收起画面设置 · Esc" onClick={onClose}><X size={15} /></button></header>
    <div className="camera-settings-body">
      <CameraEffectsControls value={state.cameraEffects ?? ORIGINAL_CAMERA_EFFECTS} disabled={disabled}
        onChange={(_value, patch) => void control({ type: 'camera-effects', value: patch })} onCompare={onCompare} />
      <div className="camera-settings-layout">
        {presenter && <PresenterCropControls value={framing.crop}
          disabled={disabled || !state.cameraPreviewing || !['idle', 'error'].includes(state.status) || state.countdown !== undefined}
          onChange={crop => void control({ type: 'camera-presenter', value: { ...framing, crop } })} />}
        <div className="camera-settings-layout-heading"><span>画面</span><button type="button" aria-label="镜像摄像头" aria-pressed={state.cameraMirror}
          disabled={disabled} onClick={() => void control({ type: 'camera-mirror', value: !state.cameraMirror })}><FlipHorizontal2 size={14} />镜像</button></div>
        {!presenter && <><CameraShapePicker value={state.cameraShape} disabled={disabled} onChange={value => void control({ type: 'camera-shape', value })} />
          <label className="overlay-size"><span>大小</span><input aria-label="摄像头大小" type="range" min="12" max="42" value={Math.round(state.cameraSize * 100)} disabled={disabled}
            onChange={event => void control({ type: 'camera-size', value: Number(event.target.value) / 100 })} /><output>{Math.round(state.cameraSize * 100)}%</output></label></>}
      </div>
    </div>
  </section>;
}
