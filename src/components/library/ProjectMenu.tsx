import { FolderOpen, PencilLine, Trash2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ProjectSummary } from '../../../shared/types';
import type { LibraryMenu } from '../../hooks/useProjectLibrary';

interface Props { menu: LibraryMenu; onClose: () => void; onRename: (project: ProjectSummary) => void; onReveal: (project: ProjectSummary) => void; onDelete: (project: ProjectSummary) => void }
export function ProjectMenu({ menu, onClose, onRename, onReveal, onDelete }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const element = panel.current;
    const items = () => [...element?.querySelectorAll<HTMLButtonElement>('button') ?? []];
    items()[0]?.focus();
    const close = () => closeRef.current();
    const outside = (event: PointerEvent) => { if (!element?.contains(event.target as Node)) close(); };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); close();
        document.getElementById(`project-action-${menu.project.id}`)?.focus();
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const controls = items(), current = controls.indexOf(document.activeElement as HTMLButtonElement);
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 :
          (current + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length;
        controls[index]?.focus();
      } else if (event.key === 'Tab') close();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', keydown, true);
    window.addEventListener('resize', close);
    document.querySelector('.project-list')?.addEventListener('scroll', close);
    return () => {
      document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keydown, true);
      window.removeEventListener('resize', close); document.querySelector('.project-list')?.removeEventListener('scroll', close);
    };
  }, [menu.project.id]);
  return createPortal(<div ref={panel} className="project-context-menu" role="menu" aria-label={`${menu.project.name} 项目操作`}
    style={{ left: Math.max(8, Math.min(menu.x, innerWidth - 192)), top: Math.max(8, Math.min(menu.y, innerHeight - 134)) }}
    onKeyDown={event => event.stopPropagation()}>
    <button role="menuitem" onClick={() => onRename(menu.project)}><PencilLine size={14} />重命名</button>
    <button role="menuitem" onClick={() => onReveal(menu.project)}><FolderOpen size={14} />打开所在文件夹</button>
    <div className="project-menu-separator" />
    <button role="menuitem" className="project-menu-delete" onClick={() => onDelete(menu.project)}><Trash2 size={14} />移到回收站</button>
  </div>, document.body);
}
