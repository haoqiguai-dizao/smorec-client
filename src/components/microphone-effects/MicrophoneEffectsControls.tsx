import { AudioLines, ChevronDown, RotateCcw } from 'lucide-react';
import { useId, useState } from 'react';
import { MICROPHONE_PRESETS, microphonePreset, type MicrophoneEffects } from '../../../shared/microphone-effects';
import { MicrophoneAdvanced, MicrophoneHelp, MicrophoneSlider, MicrophoneToggle } from './MicrophoneAdvanced';
import './microphone-effects.css';

export interface MicrophoneEffectsControlsProps {
  value: MicrophoneEffects;
  onChange: (next: MicrophoneEffects) => void;
  disabled?: boolean;
}

export function MicrophoneEffectsControls({ value, onChange, disabled = false }: MicrophoneEffectsControlsProps) {
  const [advanced, setAdvanced] = useState(false), advancedId = useId();
  const inactive = disabled || !value.enabled;
  const update = (patch: Partial<MicrophoneEffects>) => onChange({ ...value, ...patch });
  const enable = (enabled: boolean) => {
    if (enabled && value.preset === 'original') onChange(microphonePreset('natural'));
    else update({ enabled });
  };
  const presetLabel = MICROPHONE_PRESETS.find(preset => preset.id === value.preset)?.label ?? '原声';
  return <section className="microphone-effects-controls" aria-label="麦克风效果">
    <div className="microphone-effects-heading"><AudioLines size={15} />
      <MicrophoneToggle label="麦克风效果" ariaLabel="启用麦克风效果" checked={value.enabled} disabled={disabled} onChange={enable} />
    </div>
    <div className="microphone-presets" role="group" aria-label="声音预设">
      {MICROPHONE_PRESETS.map(preset => <button type="button" key={preset.id} disabled={disabled}
        aria-pressed={value.preset === preset.id} onClick={() => onChange(microphonePreset(preset.id))}>{preset.label}</button>)}
    </div>
    <MicrophoneToggle label="自动音量" checked={value.autoLevel.enabled} disabled={inactive}
      help="轻声自动提升，并限制最大增益；低于检测阈值的底噪不会持续放大。"
      onChange={enabled => update({ autoLevel: { ...value.autoLevel, enabled } })} />
    <div className="microphone-noise-row"><span>降噪</span><MicrophoneHelp label="降噪" text="减少较稳定的背景噪声。建议先用轻度，过强可能影响人声质感。" />
      <div className="microphone-noise-options" role="group" aria-label="麦克风降噪强度">
        {([{ id: 'off', label: '关闭' }, { id: 'light', label: '轻度' }, { id: 'moderate', label: '适中' }] as const).map(option =>
          <button type="button" key={option.id} disabled={inactive} aria-pressed={value.noiseReduction === option.id}
            onClick={() => update({ noiseReduction: option.id })}>{option.label}</button>)}
      </div>
    </div>
    <div className="microphone-slider-pair">
      <MicrophoneSlider label="音量稳定" value={Math.round(value.compression * 100)} min={0} max={100} unit="%" disabled={inactive}
        onChange={compression => update({ compression: compression / 100 })} />
      <MicrophoneSlider label="去齿音" value={Math.round(value.deEss * 100)} min={0} max={100} unit="%" disabled={inactive}
        onChange={deEss => update({ deEss: deEss / 100 })} />
    </div>
    <div className="microphone-advanced">
      <button type="button" className="microphone-advanced-trigger" aria-label="高级声音调节" aria-expanded={advanced}
        aria-controls={advancedId} disabled={disabled} onClick={() => setAdvanced(!advanced)}><span>高级调节</span><ChevronDown size={13} /></button>
      {advanced && <div id={advancedId}><MicrophoneAdvanced value={value} onChange={onChange} disabled={inactive} /></div>}
    </div>
    <div className="microphone-effects-actions">
      <button type="button" className="microphone-bypass" aria-pressed={!value.enabled} disabled={disabled}
        title="临时关闭效果并保留调节参数，再次点击恢复" onClick={() => enable(!value.enabled)}><AudioLines size={12} />原声旁路</button>
      <button type="button" disabled={disabled} title={`恢复「${presetLabel}」的默认参数`} onClick={() => onChange(microphonePreset(value.preset))}>
        <RotateCcw size={12} />恢复预设</button>
    </div>
  </section>;
}
