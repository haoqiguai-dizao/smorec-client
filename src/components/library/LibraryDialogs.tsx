import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { ProjectSummary } from '../../../shared/types';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import type { LibraryDeletion } from '../../hooks/useProjectLibrary';

function useOperationFocus(panel: RefObject<HTMLElement | null>, busy: boolean) {
  useEffect(() => {
    // Disabling an active control can move focus to body. Restore the safe first
    // control after a failed operation while the dialog remains open.
    if (!busy && panel.current && !panel.current.contains(document.activeElement)) {
      panel.current.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled)')?.focus();
    }
  }, [panel, busy]);
}

export function RenameProjectDialog({ project, busy, error, onClose, onSave }: {
  project: ProjectSummary; busy: boolean; error: string; onClose: () => void; onSave: (name: string) => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const [name, setName] = useState(project.name);
  useDialogFocus(panel, onClose, '.library-manage-button');
  useOperationFocus(panel, busy);
  return createPortal(<div className="modal-backdrop library-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={panel} tabIndex={-1} className="modal library-dialog" role="dialog" aria-modal="true" aria-labelledby="library-rename-title" onKeyDown={event => event.stopPropagation()}>
      <h2 id="library-rename-title">重命名项目</h2>
      <form onSubmit={event => { event.preventDefault(); if (!busy && name.trim()) onSave(name.trim()); }}>
        <input aria-label="项目名称" value={name} maxLength={120} disabled={busy} onFocus={event => event.currentTarget.select()} onChange={event => setName(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault(); }} />
        {error && <p className="library-operation-error" role="alert">{error}</p>}
        <div className="library-dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>取消</button><button className="button primary" type="submit" disabled={busy || !name.trim()}>{busy ? '保存中…' : '保存'}</button></div>
      </form>
    </section>
  </div>, document.body);
}

export function DeleteProjectsDialog({ deletion, busy, onClose, onConfirm }: {
  deletion: LibraryDeletion; busy: boolean; onClose: () => void; onConfirm: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  useDialogFocus(panel, onClose, '.library-manage-button');
  useOperationFocus(panel, busy);
  const failures = Object.keys(deletion.errors).length > 0;
  return createPortal(<div className="modal-backdrop library-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={panel} tabIndex={-1} className="modal library-dialog" role="dialog" aria-modal="true" aria-labelledby="library-delete-title" aria-describedby="library-delete-description" onKeyDown={event => event.stopPropagation()}>
      <h2 id="library-delete-title">移到回收站</h2>
      <p id="library-delete-description">{deletion.projects.length === 1 ? '这个项目' : `所选 ${deletion.projects.length} 个项目`}的工程与素材将一起移到回收站。</p>
      {failures && <p className="library-operation-error" role="alert">以下项目未能移到回收站，可重试。</p>}
      <ul className="library-delete-projects">{deletion.projects.map(project => <li key={project.id}><strong>{project.name}</strong>{deletion.errors[project.id] && <span>{deletion.errors[project.id]}</span>}</li>)}</ul>
      <div className="library-dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>取消</button><button type="button" className="button library-confirm-delete" disabled={busy} onClick={onConfirm}>{busy ? '正在移到回收站…' : '移到回收站'}</button></div>
    </section>
  </div>, document.body);
}
