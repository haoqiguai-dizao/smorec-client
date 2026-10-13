import { Crop, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import type { CaptureSource, Rect } from '../../../shared/types';
import '../../../shared/region-selection';

export function RegionEditor({ source, crop, valid, disabled, onChange }: { source: CaptureSource; crop: Rect; valid: boolean; disabled: boolean; onChange: (crop: Rect) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const select = async () => {
    if (!window.regionSelection) { setError('请在小录桌面版中框选区域'); return; }
    setBusy(true); setError(undefined);
    try { const next = await window.regionSelection.select(source.id, valid ? crop : undefined); if (next) onChange(next); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '框选失败，请重试'); }
    finally { setBusy(false); }
  };
  return <section className="recorder-region">
    <div className="region-description"><Crop size={13} /><span>录制区域</span><small>{valid ? `${crop.width} × ${crop.height}` : '尚未选择'}</small>
      <button className="launcher-start" disabled={disabled || busy} onClick={() => void select()}>{busy && <LoaderCircle size={13} />}{valid ? '重新框选' : '框选区域'}</button></div>
    {error && <div className="launcher-inline-error" role="alert">{error}</div>}
  </section>;
}
