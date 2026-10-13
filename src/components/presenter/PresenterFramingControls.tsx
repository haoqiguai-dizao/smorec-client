import { DEFAULT_PRESENTER, type PresenterAspect, type PresenterCrop } from '../../../shared/presenter';
import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import './presenter-framing.css';

export function PresenterAspectSelect({ value, disabled, onChange }: {
  value: PresenterAspect | 'auto' | '1:1'; disabled?: boolean; onChange: (aspect: PresenterAspect) => void;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), id = useId();
  const choices = [{ value: '16:9' as const, label: '横屏 16:9' }, { value: '9:16' as const, label: '竖屏 9:16' }];
  const label = choices.find(item => item.value === value)?.label ?? (value === 'auto' ? '原始画幅' : '方形 1:1');
  useEffect(() => {
    if (disabled) { setOpen(false); return; }
    if (!open) return;
    container.current?.querySelector<HTMLButtonElement>('[aria-selected=true]')?.focus();
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, disabled]);
  return <div className="presenter-aspect-picker" ref={container} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
    if (event.key === 'Tab') setOpen(false);
    if (disabled || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (!open) { setOpen(true); return; }
    const items = [...container.current!.querySelectorAll<HTMLButtonElement>('[role=option]')];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  }}>
    <button ref={trigger} type="button" className="presenter-aspect" aria-label="口播画幅" aria-haspopup="listbox"
      aria-controls={id} aria-expanded={open && !disabled} disabled={disabled}
      title={disabled ? '录制开始后画幅保持固定' : '口播画幅'} onClick={() => setOpen(previous => !previous)}>
      <span>{label}</span><ChevronDown size={13} /></button>
    {open && !disabled && <div id={id} className="presenter-aspect-options" role="listbox" aria-label="选择口播画幅">
      {choices.map(item => <button type="button" role="option" aria-selected={value === item.value} key={item.value}
        onClick={() => { onChange(item.value); setOpen(false); trigger.current?.focus(); }}>
        <span>{item.label}</span>{value === item.value && <Check size={13} />}</button>)}
    </div>}
  </div>;
}
export function PresenterCropControls({ value = DEFAULT_PRESENTER.crop, disabled, onChange }: {
  value?: PresenterCrop; disabled?: boolean; onChange: (crop: PresenterCrop) => void;
}) {
  return <div className="presenter-crop-controls" role="group" aria-label="口播取景">
    {(['x', 'y'] as const).map(axis => <label key={axis}><span>{axis === 'x' ? '水平取景' : '垂直取景'}</span>
      <input type="range" aria-label={axis === 'x' ? '水平取景' : '垂直取景'} min="0" max="100" value={Math.round(value[axis] * 100)} disabled={disabled}
        onChange={event => onChange({ ...value, [axis]: Number(event.target.value) / 100 })} /></label>)}
    <button type="button" disabled={disabled} onClick={() => onChange({ ...DEFAULT_PRESENTER.crop })}>取景居中</button>
  </div>;
}
