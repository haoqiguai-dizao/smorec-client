import { Camera, Plus } from 'lucide-react';
import type { Project } from '../../../shared/types';
import type { CompositionEditingProps } from '../composition-types';

export function CompositionTimelineTools({ onAddComposition }: CompositionEditingProps & { project: Project; sourceTime: number }) {
  return <div className="composition-timeline-tools" aria-label="局部镜头操作">
    <button type="button" onClick={onAddComposition} title="在播放位置添加局部镜头"><Camera size={14} /><Plus size={11} /><span>局部镜头</span></button>
  </div>;
}
