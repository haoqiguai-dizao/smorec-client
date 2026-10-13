import { Focus, Sparkles, Trash2 } from 'lucide-react';
import type { Project, ZoomSegment } from '../../../shared/types';
import { NumberField, Section, Slider } from './Controls';

interface Props { project: Project; selectedId: string | null; onSelect: (id: string | null) => void; onChange: (zooms: ZoomSegment[]) => void; onAutoZoom: () => void }

export function ZoomPanel({ project, selectedId, onSelect, onChange, onAutoZoom }: Props) {
  const selected = project.zooms.find(zoom => zoom.id === selectedId);
  const ordered = [...project.zooms].sort((a, b) => a.start - b.start);
  const selectedIndex = ordered.findIndex(zoom => zoom.id === selectedId);
  const earliestStart = ordered[selectedIndex - 1]?.end ?? 0;
  const latestEnd = ordered[selectedIndex + 1]?.start ?? project.duration;
  const minLength = Math.min(1 / project.fps, Math.max(0, latestEnd - earliestStart));
  const update = (patch: Partial<ZoomSegment>) => { if (selected) onChange(project.zooms.map(zoom => zoom.id === selected.id ? { ...zoom, ...patch } : zoom)); };
  const hasActivity = project.cursor.some(sample => sample.click || sample.primaryDown)
    || project.inputActivity?.some(activity => activity.kind === 'typing')
    || project.whiteboard?.events.some(event => event.action.kind === 'focus'
      || event.action.kind === 'stroke' || event.action.kind === 'shape' || event.action.kind === 'text'
      || event.action.kind === 'image' || event.action.kind === 'line' || event.action.kind === 'replace'
      || event.action.kind === 'connect-node' || event.action.kind === 'erase');
  return <><Section title="自动镜头" help="根据点击、输入、文字拖选和白板操作生成镜头，持续操作时保持放大。重新生成会替换现有镜头，你可以继续手动调整。"><button className="button autozoom-button" disabled={!hasActivity} onClick={onAutoZoom}><Sparkles size={15} />生成自动缩放</button></Section>
    <Section title={`镜头 · ${project.zooms.length}`} help="选中镜头后按 Delete 或 Backspace 删除，也可使用时间轴删除按钮。Ctrl/⌘+Z 撤销，Ctrl/⌘+Shift+Z 重做。删除镜头只移除缩放效果，保留原视频。"><div className="zoom-list">{project.zooms.map((zoom, index) => <button aria-pressed={selectedId === zoom.id} data-editor-selection="zoom" className={`zoom-list-item ${selectedId === zoom.id ? 'active' : ''}`} key={zoom.id} onClick={() => onSelect(zoom.id)}><Focus size={15} /><strong>镜头 {String(index + 1).padStart(2, '0')}</strong><span>{zoom.scale.toFixed(1)}×</span></button>)}{!project.zooms.length && <span className="inspector-note">在时间轴上添加一个镜头</span>}</div></Section>
    {selected && <Section title="镜头参数" help="时间基于原始素材，相邻镜头不能重叠。焦点坐标是画面宽高的百分比。"><div className="number-pair"><NumberField label="开始 / 秒" value={selected.start} min={earliestStart} max={Math.max(earliestStart, selected.end - minLength)} onChange={start => update({ start })} /><NumberField label="结束 / 秒" value={selected.end} min={Math.min(latestEnd, selected.start + minLength)} max={latestEnd} onChange={end => update({ end })} /></div><Slider label="缩放倍率" value={selected.scale} min={1} max={3} step={0.05} unit="×" onChange={scale => update({ scale })} /><div className="number-pair"><NumberField label="焦点 X / %" value={selected.x * 100} min={0} max={100} step={1} onChange={x => update({ x: x / 100 })} /><NumberField label="焦点 Y / %" value={selected.y * 100} min={0} max={100} step={1} onChange={y => update({ y: y / 100 })} /></div><button className="button danger-subtle" onClick={() => { onChange(project.zooms.filter(zoom => zoom.id !== selected.id)); onSelect(null); }}><Trash2 size={14} />删除镜头</button></Section>}
  </>;
}
