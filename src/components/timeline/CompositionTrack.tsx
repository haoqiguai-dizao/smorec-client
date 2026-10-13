import { Plus } from 'lucide-react';
import type { Project } from '../../../shared/types';
import type { CompositionEditingProps } from '../composition-types';
import { RangeBlock } from './RangeBlock';
import '../../styles/composition.css';

export function CompositionTrack({ project, total, sourceAt, onSeek, ...editing }: CompositionEditingProps & {
  project: Project; total: number; sourceAt: (clientX: number) => number; onSeek: (clientX: number) => void;
}) {
  let offset = 0;
  const clips = project.clips.map(clip => { const value = { ...clip, offset }; offset += clip.end - clip.start; return value; });
  const segments = [...project.compositions ?? []].sort((a, b) => a.start - b.start);
  return <div className="timeline-track composition-track" aria-label="局部镜头轨道">
    {segments.flatMap((segment, index) => clips.flatMap(clip => {
      const start = Math.max(segment.start, clip.start), end = Math.min(segment.end, clip.end);
      if (end <= start) return [];
      return [<RangeBlock key={`${segment.id}-${clip.id}`} kind="composition" name={`局部镜头 ${index + 1}`}
        range={segment} offset={clip.offset + start - clip.start} segment={clip} total={total} fps={project.fps}
        min={segments[index - 1]?.end ?? 0} max={segments[index + 1]?.start ?? project.duration}
        selected={editing.selectedCompositionId === segment.id} sourceAt={sourceAt}
        onSelect={() => editing.onSelectComposition?.(segment.id)} onSeek={onSeek}
        onPreview={range => editing.onPreviewComposition?.(segment.id, range)}
        onCommit={(start, end) => editing.onUpdateComposition?.(segment.id, { start, end })} />];
    }))}
    {!segments.length && <button className="empty-track-add" onPointerDown={event => event.stopPropagation()}
      onClick={editing.onAddComposition}><Plus size={12} />添加局部镜头</button>}
  </div>;
}
