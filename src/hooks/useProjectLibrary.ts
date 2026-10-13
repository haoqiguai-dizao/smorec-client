import { useEffect, useRef, useState } from 'react';
import type { ProjectSummary } from '../../shared/types';
import { readAppPreferences, updateAppPreferences } from '../services/app-preferences';

export interface LibraryDeleteResult { deletedIds: string[]; failed: { id: string; error: string }[] }
export interface LibraryActions {
  onRename: (id: string, name: string) => Promise<void>;
  onReveal: (id: string) => Promise<void>;
  onDelete: (ids: string[]) => Promise<LibraryDeleteResult>;
}
export interface LibraryMenu { project: ProjectSummary; x: number; y: number }
export interface LibraryDeletion { projects: ProjectSummary[]; errors: Record<string, string> }
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function useProjectLibrary(projects: ProjectSummary[], busy: boolean, actions: LibraryActions) {
  const [collapsed, setCollapsed] = useState(() => readAppPreferences().editor.libraryCollapsed ?? false);
  const [query, setQuery] = useState('');
  const [managing, setManaging] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [menu, setMenu] = useState<LibraryMenu | null>(null);
  const [renaming, setRenaming] = useState<ProjectSummary | null>(null);
  const [renameError, setRenameError] = useState('');
  const [deletion, setDeletion] = useState<LibraryDeletion | null>(null);
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const disabled = busy || pending;
  const filtered = projects.filter(project => project.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const selectedProjects = projects.filter(project => selected.includes(project.id));
  const allFilteredSelected = filtered.length > 0 && filtered.every(project => selected.includes(project.id));
  useEffect(() => { setSelected(previous => previous.filter(id => projects.some(project => project.id === id))); }, [projects]);
  useEffect(() => { if (busy) setMenu(null); }, [busy]);

  const changeCollapsed = (value: boolean) => {
    setCollapsed(value); setMenu(null);
    updateAppPreferences({ editor: { libraryCollapsed: value } });
  };
  const toggleManaging = () => {
    if (disabled) return;
    setMenu(null);
    if (collapsed) { changeCollapsed(false); setManaging(true); }
    else { setManaging(!managing); setSelected([]); }
  };
  const select = (id: string) => {
    if (!disabled) setSelected(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id]);
  };
  const selectFiltered = () => {
    if (disabled) return;
    const ids = new Set(filtered.map(project => project.id));
    setSelected(previous => allFilteredSelected ? previous.filter(id => !ids.has(id)) : [...new Set([...previous, ...ids])]);
  };
  const beginRename = (project: ProjectSummary) => { setMenu(null); setRenameError(''); setRenaming(project); };
  const beginDelete = (targets: ProjectSummary[]) => {
    if (disabled || !targets.length) return;
    setMenu(null); setDeletion({ projects: targets, errors: {} });
  };
  const dismissRename = () => { if (!pendingRef.current) setRenaming(null); };
  const dismissDeletion = () => { if (!pendingRef.current) setDeletion(null); };
  const rename = async (name: string) => {
    if (!renaming || disabled || pendingRef.current || !name.trim()) return;
    pendingRef.current = true; setPending(true); setRenameError('');
    try { await actions.onRename(renaming.id, name.trim()); setRenaming(null); }
    catch (error) { setRenameError(message(error)); }
    finally { pendingRef.current = false; setPending(false); }
  };
  const reveal = async (project: ProjectSummary) => {
    if (disabled || pendingRef.current) return;
    setMenu(null); setNotice(''); pendingRef.current = true; setPending(true);
    try { await actions.onReveal(project.id); }
    catch (error) { setNotice(message(error)); }
    finally { pendingRef.current = false; setPending(false); }
  };
  const remove = async () => {
    if (!deletion || disabled || pendingRef.current) return;
    const targets = deletion.projects;
    pendingRef.current = true; setPending(true);
    try {
      const result = await actions.onDelete(targets.map(project => project.id));
      const deleted = new Set(result.deletedIds);
      setSelected(previous => previous.filter(id => !deleted.has(id)));
      const remaining = targets.filter(project => !deleted.has(project.id));
      setDeletion(remaining.length ? { projects: remaining, errors: Object.fromEntries(remaining.map(project =>
        [project.id, result.failed.find(item => item.id === project.id)?.error ?? '未能移到回收站，请重试。'])) } : null);
    } catch (error) {
      setDeletion({ projects: targets, errors: Object.fromEntries(targets.map(project => [project.id, message(error)])) });
    } finally { pendingRef.current = false; setPending(false); }
  };
  return { collapsed, query, setQuery, managing, selected, selectedProjects, filtered, allFilteredSelected,
    menu, setMenu, renaming, renameError, deletion, notice, clearNotice: () => setNotice(''), disabled, pending,
    toggleCollapsed: () => changeCollapsed(!collapsed), toggleManaging, select, selectFiltered,
    beginRename, beginDelete, dismissRename, dismissDeletion, rename, reveal, remove };
}
