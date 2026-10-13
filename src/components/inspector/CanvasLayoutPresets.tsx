import { Frame, Maximize } from 'lucide-react';
import { BACKGROUND_CANVAS_STYLE, FILL_CANVAS_STYLE, hasCanvasFrame, isFillCanvasStyle } from '../../../shared/canvas-style';
import type { CanvasStyle } from '../../../shared/types';
import { Section } from './Controls';

export function CanvasLayoutPresets({ style, onChange }: {
  style: CanvasStyle; onChange: (patch: Partial<CanvasStyle>) => void;
}) {
  return <Section title="画面布局" help="铺满画布会恢复原始比例，并去掉边距、圆角与阴影。">
    <div className="canvas-layout-presets">
      <button aria-pressed={isFillCanvasStyle(style)} onClick={() => onChange(FILL_CANVAS_STYLE)}>
        <Maximize size={15} />铺满画布
      </button>
      <button aria-pressed={hasCanvasFrame(style)} onClick={() => onChange(BACKGROUND_CANVAS_STYLE)}>
        <Frame size={15} />背景留白
      </button>
    </div>
  </Section>;
}
