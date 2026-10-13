import { ChevronDown, LoaderCircle, type LucideIcon } from 'lucide-react';
import type { SessionDevice } from './types';

export function ToolbarDevice({ label, ariaLabel, icon: Icon, device, compact = false, className = '' }: {
  label: string; ariaLabel?: string; icon: LucideIcon; device: SessionDevice;
  compact?: boolean; className?: string;
}) {
  const title = device.title ?? `${device.enabled ? '关闭' : '开启'}${label}`;
  const control = <button type="button" className={`session-device ${className}`} aria-label={ariaLabel ?? title} title={title}
    aria-pressed={device.enabled} aria-busy={device.pending}
    disabled={device.disabled || device.pending && !device.allowToggleWhilePending} onClick={device.toggle}>
    <span className="session-device-symbol">
      {device.pending ? <LoaderCircle className="launcher-spinning" size={21} /> : <Icon size={21} />}
      <i aria-hidden="true" data-active={device.enabled && device.ready !== false && !device.pending} />
    </span>
    {!compact && <span className="session-device-label">{label}</span>}
  </button>;
  if (!device.settings || compact) return control;
  return <div className="session-device-group">
    {control}
    <button type="button" className="session-device-settings" aria-label={device.settings.label}
      aria-expanded={device.settings.open} disabled={device.settings.disabled || device.pending}
      onClick={device.settings.toggle}><ChevronDown size={11} /></button>
  </div>;
}
