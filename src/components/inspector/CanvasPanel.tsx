import { isFillCanvasStyle } from '../../../shared/canvas-style';
import type { CanvasStyle } from '../../../shared/types';
import { Section, Slider } from './Controls';
import { CanvasLayoutPresets } from './CanvasLayoutPresets';
import { CanvasBackgroundPanel, type CanvasBackgroundProps } from './CanvasBackgroundPanel';

export function CanvasPanel({ style, onChange, ...backgroundProps }: CanvasBackgroundProps & {
  style: CanvasStyle; onChange: (patch: Partial<CanvasStyle>) => void;
}) {
  return <><CanvasLayoutPresets style={style} onChange={onChange} />
    {!isFillCanvasStyle(style) && <CanvasBackgroundPanel selected={style.background} onSelect={background => onChange({ background })} {...backgroundProps} />}
    <Section title="画布比例"><div className="aspect-options">{(['auto', '16:9', '9:16', '1:1'] as const).map(aspect => <button key={aspect} className={style.aspect === aspect ? 'selected' : ''} aria-pressed={style.aspect === aspect} onClick={() => onChange({ aspect })}><span className={`aspect-icon aspect-${aspect.replace(':', '-')}`} />{aspect === 'auto' ? '原始' : aspect}</button>)}</div></Section>
    <Section title="画面样式"><Slider label="边距" value={style.padding} min={0} max={180} unit=" px" onChange={padding => onChange({ padding })} /><Slider label="圆角" value={style.radius} min={0} max={64} unit=" px" onChange={radius => onChange({ radius })} /><Slider label="阴影" value={style.shadow} min={0} max={100} unit="%" onChange={shadow => onChange({ shadow })} /></Section>
  </>;
}
