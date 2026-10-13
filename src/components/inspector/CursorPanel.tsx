import { MousePointer2 } from 'lucide-react';
import type { CanvasStyle } from '../../../shared/types';
import { Section, Slider, Toggle } from './Controls';

export function CursorPanel({ style, hasCursor, onChange }: { style: CanvasStyle; hasCursor: boolean; onChange: (patch: Partial<CanvasStyle>) => void }) {
  return <><div className="cursor-preview"><MousePointer2 size={Math.min(60, 22 * style.cursorScale)} fill="currentColor" strokeWidth={1} /><span>独立光标</span></div><Section title="光标设置" help="仅原生录制的独立光标轨道可编辑。导入视频中的光标属于画面本身。"><Toggle label="显示光标" checked={style.showCursor} disabled={!hasCursor} onChange={showCursor => onChange({ showCursor })} /><Slider label="光标大小" value={style.cursorScale} min={0.5} max={3} step={0.1} unit="×" disabled={!hasCursor || !style.showCursor} onChange={cursorScale => onChange({ cursorScale })} /><Slider label="移动平滑度" value={Math.round(style.smoothing * 100)} min={0} max={100} unit="%" disabled={!hasCursor || !style.showCursor} onChange={smoothing => onChange({ smoothing: smoothing / 100 })} /><Toggle label="点击反馈" checked={style.clickHighlight} disabled={!hasCursor || !style.showCursor} onChange={clickHighlight => onChange({ clickHighlight })} /></Section>{!hasCursor && <div className="inspector-note">此视频没有独立光标轨道</div>}</>;
}
