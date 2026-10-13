import { Eye, RotateCcw, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CameraEffects } from '../../../shared/types';
import { CAMERA_BEAUTY_PRESETS, DEFAULT_CAMERA_EFFECTS, cameraBeautyPreset } from '../../../shared/camera-effects';
import { BeautyParameters } from './BeautyParameters';
import { BEAUTY_ZERO } from '../../../shared/beauty';
import './camera-effects-controls.css';

interface Props {
  value: CameraEffects;
  disabled?: boolean;
  onChange: (effects: CameraEffects, patch: Partial<CameraEffects>) => void;
  /** Optional, temporary preview only. Comparing must not change the saved effects. */
  onCompare?: (original: boolean) => void;
}

export function CameraEffectsControls({ value, disabled = false, onChange, onCompare }: Props) {
  const [comparing, setComparing] = useState(false);
  const comparisonActive = useRef(false), comparisonCallback = useRef(onCompare);
  comparisonCallback.current = onCompare;
  const finishCompare = useCallback(() => {
    if (!comparisonActive.current) return;
    comparisonActive.current = false; setComparing(false); comparisonCallback.current?.(false);
  }, []);
  const beginCompare = () => {
    if (disabled || !value.enabled || comparisonActive.current || !onCompare) return;
    comparisonActive.current = true; setComparing(true); comparisonCallback.current?.(true);
  };
  useEffect(() => { if (disabled || !value.enabled) finishCompare(); }, [disabled, value.enabled, finishCompare]);
  useEffect(() => () => { if (comparisonActive.current) comparisonCallback.current?.(false); }, []);
  const inactive = disabled || !value.enabled;
  const update = (patch: Partial<CameraEffects>) => onChange({ ...value, ...patch }, patch);
  return <section className="camera-effects-controls" aria-label="美颜与滤镜">
    <label className="camera-effects-toggle"><Sparkles size={14} /><span>美颜与滤镜</span><input type="checkbox" aria-label="启用美颜与滤镜" checked={value.enabled} disabled={disabled} onChange={event => update({ enabled: event.target.checked })} /></label>
    <div className="camera-effects-presets" role="group" aria-label="美颜预设">{CAMERA_BEAUTY_PRESETS.map(preset => <button
      key={preset.id} disabled={disabled} aria-pressed={cameraBeautyPreset(value) === preset.id}
      onClick={() => { finishCompare(); update({ ...BEAUTY_ZERO, ...preset.effects }); }}>{preset.label}</button>)}</div>
    <BeautyParameters value={value} disabled={inactive} update={update} />
    <div className="camera-effects-actions">
      {onCompare && <button className="camera-effects-compare" disabled={inactive} aria-pressed={comparing} title="按住查看未经处理的原图，松开恢复" onPointerDown={event => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId); beginCompare();
      }} onPointerUp={finishCompare} onPointerCancel={finishCompare} onLostPointerCapture={finishCompare} onBlur={finishCompare}
        onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); beginCompare(); } }}
        onKeyUp={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); finishCompare(); } }}><Eye size={12} />按住看原图</button>}
      <button className="camera-effects-reset" disabled={disabled} title="恢复自然肤质预设" onClick={() => { finishCompare(); update({ ...BEAUTY_ZERO, ...DEFAULT_CAMERA_EFFECTS }); }}><RotateCcw size={12} />恢复自然</button>
    </div>
  </section>;
}
