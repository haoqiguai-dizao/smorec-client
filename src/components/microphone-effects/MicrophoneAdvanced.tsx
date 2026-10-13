import { CircleHelp } from 'lucide-react';
import { useId } from 'react';
import type { MicrophoneEffects } from '../../../shared/microphone-effects';

export function MicrophoneHelp({ label, text }: { label: string; text: string }) {
  return <button type="button" className="microphone-help" aria-label={`${label}说明`} title={text}><CircleHelp size={12} /></button>;
}

export function MicrophoneToggle({ label, ariaLabel = label, checked, disabled, onChange, help }: {
  label: string; ariaLabel?: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void; help?: string;
}) {
  const id = useId();
  return <div className="microphone-toggle"><label htmlFor={id}>{label}</label>
    {help && <MicrophoneHelp label={label} text={help} />}
    <input id={id} type="checkbox" aria-label={ariaLabel} checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
  </div>;
}

export function MicrophoneSlider({ label, ariaLabel = label, value, min, max, step = 1, unit = '', signed = false, disabled, onChange }: {
  label: string; ariaLabel?: string; value: number; min: number; max: number; step?: number; unit?: string; signed?: boolean;
  disabled?: boolean; onChange: (value: number) => void;
}) {
  const rounded = Number(value.toFixed(1));
  return <label className="microphone-slider"><span><span>{label}</span>
    <output>{signed && rounded > 0 ? '+' : ''}{rounded}{unit}</output></span>
    <input type="range" aria-label={ariaLabel} value={value} min={min} max={max} step={step} disabled={disabled}
      onChange={event => onChange(Number(event.target.value))} />
  </label>;
}

export function MicrophoneAdvanced({ value, onChange, disabled = false }: {
  value: MicrophoneEffects; onChange: (next: MicrophoneEffects) => void; disabled?: boolean;
}) {
  return <div className="microphone-advanced-fields">
    <div className="microphone-processing-group">
      <MicrophoneSlider label="自动音量最大提升" ariaLabel="自动音量最大提升" value={value.autoLevel.maxGainDb}
        min={0} max={18} unit=" dB" disabled={disabled || !value.autoLevel.enabled}
        onChange={maxGainDb => onChange({ ...value, autoLevel: { ...value.autoLevel, maxGainDb } })} />
    </div>
    <div className="microphone-processing-group">
      <MicrophoneToggle label="低切" ariaLabel="启用低切" checked={value.highpass.enabled} disabled={disabled}
        help="减少桌面震动、空调等低频声，保留自然人声。" onChange={enabled => onChange({ ...value, highpass: { ...value.highpass, enabled } })} />
      <MicrophoneSlider label="截止频率" ariaLabel="低切截止频率" value={value.highpass.frequencyHz} min={40} max={200} step={5} unit=" Hz"
        disabled={disabled || !value.highpass.enabled} onChange={frequencyHz => onChange({ ...value, highpass: { ...value.highpass, frequencyHz } })} />
    </div>
    <div className="microphone-processing-group">
      <MicrophoneToggle label="均衡器" ariaLabel="启用均衡器" checked={value.eq.enabled} disabled={disabled}
        help="分别微调声音的厚度、清晰度和明亮度。" onChange={enabled => onChange({ ...value, eq: { ...value.eq, enabled } })} />
      {([{ key: 'lowDb', label: '低频 · 120 Hz', ariaLabel: '低频增益' },
        { key: 'presenceDb', label: '清晰度 · 3 kHz', ariaLabel: '清晰度增益' },
        { key: 'airDb', label: '明亮度 · 8 kHz', ariaLabel: '明亮度增益' }] as const).map(({ key, label, ariaLabel }) =>
        <MicrophoneSlider key={key} label={label} ariaLabel={ariaLabel} value={value.eq[key]} min={-6} max={6} step={.5} unit=" dB" signed
          disabled={disabled || !value.eq.enabled} onChange={gain => onChange({ ...value, eq: { ...value.eq, [key]: gain } })} />)}
    </div>
    <div className="microphone-processing-group">
      <MicrophoneToggle label="停顿降噪" ariaLabel="启用停顿降噪" checked={value.expander.enabled} disabled={disabled}
        help="停顿时柔和压低底噪。阈值过高可能压低轻声或词尾。" onChange={enabled => onChange({ ...value, expander: { ...value.expander, enabled } })} />
      <div className="microphone-slider-pair">
        <MicrophoneSlider label="阈值" ariaLabel="停顿降噪阈值" value={value.expander.thresholdDb} min={-60} max={-20} unit=" dB"
          disabled={disabled || !value.expander.enabled} onChange={thresholdDb => onChange({ ...value, expander: { ...value.expander, thresholdDb } })} />
        <MicrophoneSlider label="比例" ariaLabel="停顿降噪比例" value={value.expander.ratio} min={1} max={4} step={.1} unit=":1"
          disabled={disabled || !value.expander.enabled} onChange={ratio => onChange({ ...value, expander: { ...value.expander, ratio } })} />
      </div>
    </div>
    <div className="microphone-processing-group">
      <MicrophoneToggle label="峰值保护" ariaLabel="启用峰值保护" checked={value.limiter.enabled} disabled={disabled}
        help="限制突然变大的声音，降低削波失真；无法修复麦克风已录坏的爆音。" onChange={enabled => onChange({ ...value, limiter: { ...value.limiter, enabled } })} />
      <MicrophoneSlider label="峰值上限" value={value.limiter.ceilingDb} min={-12} max={-1} unit=" dB"
        disabled={disabled || !value.limiter.enabled} onChange={ceilingDb => onChange({ ...value, limiter: { ...value.limiter, ceilingDb } })} />
    </div>
  </div>;
}
