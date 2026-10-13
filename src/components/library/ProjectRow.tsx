import { MoreHorizontal, Video } from 'lucide-react';
import type { MouseEvent } from 'react';
import type { ProjectSummary } from '../../../shared/types';
import type { LibraryMenu } from '../../hooks/useProjectLibrary';

interface Props {
  project: ProjectSummary; active: boolean; managing: boolean; selected: boolean; disabled: boolean;
  onLoad: (id: string) => void; onSelect: (id: string) => void; onMenu: (menu: LibraryMenu) => void;
}
function durationLabel(value: number) {
  const seconds = Math.max(0, Math.floor(value));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
export function ProjectRow({ project, active, managing, selected, disabled, onLoad, onSelect, onMenu }: Props) {
  const contextMenu = (event: MouseEvent) => {
    event.preventDefault();
    if (disabled) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    onMenu({ project, x: event.clientX || bounds.right - 20, y: event.clientY || bounds.bottom });
  };
  return <div className={`project-row ${selected && managing ? 'is-selected' : ''}`} onContextMenu={contextMenu}>
    {managing && <input className="project-selection" type="checkbox" aria-label={`选择项目 ${project.name}`} checked={selected} disabled={disabled} onChange={() => onSelect(project.id)} />}
    <button title={project.name} aria-label={`${managing ? '选择' : '打开'} ${project.name}`} aria-current={active ? 'true' : undefined}
      aria-pressed={managing ? selected : undefined} className={`project-card ${active ? 'active' : ''}`}
      onClick={() => managing ? onSelect(project.id) : onLoad(project.id)} disabled={disabled}>
      <span className="project-icon"><Video size={19} /></span>
      <span className="project-info"><strong>{project.name}</strong><span>{new Date(project.createdAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}<span className="project-duration">{durationLabel(project.duration)}</span></span></span>
    </button>
    <button id={`project-action-${project.id}`} className="project-menu-trigger" title="项目操作" aria-label={`项目操作 ${project.name}`} aria-haspopup="menu" disabled={disabled}
      onClick={event => { const bounds = event.currentTarget.getBoundingClientRect(); onMenu({ project, x: bounds.right - 184, y: bounds.bottom + 4 }); }}><MoreHorizontal size={16} /></button>
  </div>;
}
