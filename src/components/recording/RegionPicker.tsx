import { useEffect, useState } from 'react';
import { Check, RotateCcw, X } from 'lucide-react';
import { physicalRegion, validRegion, type RegionSelectionConfiguration } from '../../../shared/region-selection';
import { useRegionDrag } from '../../hooks/useRegionDrag';

export function RegionPicker() {
  const [config, setConfig] = useState<RegionSelectionConfiguration>();
  const [error, setError] = useState<string>();
  const drag = useRegionDrag();
  useEffect(() => { let active = true; void window.regionSelection?.configuration().then(value => {
    if (!active) return; setConfig(value);
    if (value.initial) drag.setRect({ x: value.initial.x / value.source.width * innerWidth,
      y: value.initial.y / value.source.height * innerHeight, width: value.initial.width / value.source.width * innerWidth,
      height: value.initial.height / value.source.height * innerHeight });
  }).catch(() => setError('屏幕选择已失效，请取消后重试')); return () => { active = false; }; }, [drag.setRect]);
  const crop = config && drag.rect ? physicalRegion(drag.rect, { width: innerWidth, height: innerHeight }, config.source) : undefined;
  const valid = !!config && validRegion(crop, config.source.width, config.source.height);
  const complete = () => { if (valid) void window.regionSelection?.complete(crop!).catch(() => setError('选区无效，请重新框选')); };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void window.regionSelection?.cancel();
      if (event.key === 'Enter' && valid) { event.preventDefault(); complete(); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  });
  return <main className={`region-picker ${drag.rect ? 'has-selection' : ''}`} {...drag.events} aria-label="鼠标框选录制区域">
    {!drag.rect && <div className="region-picker-hint">拖动鼠标，框选要录制的区域<span>Esc 取消</span></div>}
    {drag.rect && <div className="region-picker-selection" data-handle="move" style={{ left: drag.rect.x, top: drag.rect.y, width: drag.rect.width, height: drag.rect.height }}>
      <span className="region-picker-size" style={drag.rect.y < 30 ? { top: 8 } : undefined}>{crop?.width ?? 0} × {crop?.height ?? 0}</span>
      {['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(handle => <i key={handle} data-handle={handle} className={`region-handle ${handle}`} />)}
    </div>}
    <footer className="region-picker-actions" style={drag.rect ? { left: Math.max(12, Math.min(innerWidth - 290, drag.rect.x)), top: Math.max(12, Math.min(innerHeight - 64, drag.rect.y + drag.rect.height + 12)) } : undefined}>
      {error && <span role="alert">{error}</span>}
      <button onClick={() => drag.setRect(undefined)}><RotateCcw size={15} />重新框选</button>
      <button onClick={() => void window.regionSelection?.cancel()}><X size={15} />取消</button>
      <button className="confirm" disabled={!valid} onClick={complete}><Check size={15} />使用选区</button>
    </footer>
  </main>;
}
