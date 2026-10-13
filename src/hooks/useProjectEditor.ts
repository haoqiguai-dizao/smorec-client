import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Project, ProjectDeletionResult, ProjectSummary, ZoomSegment } from '../../shared/types';
import { generateAutoZooms, outputToSourceTime, splitClip } from '../../shared/timeline';

export function useProjectEditor(reportError: (message: string) => void) {
  const [project, setProject] = useState<Project | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [dirty, setDirty] = useState(false);
  const [selectedZoomId, setSelectedZoomId] = useState<string | null>(null);
  const [history, setHistory] = useState<Project[]>([]);
  const [future, setFuture] = useState<Project[]>([]);
  const projectRef = useRef(project);
  const dirtyRef = useRef(dirty);
  const saving = useRef<Promise<void> | null>(null);
  const removing = useRef(new Set<string>());
  const managing = useRef(false);
  const refreshRevision = useRef(0);
  projectRef.current = project; dirtyRef.current = dirty;

  const refresh = useCallback(async () => {
    const revision = ++refreshRevision.current;
    if (window.studio) {
      const next = await window.studio.listProjects();
      if (revision === refreshRevision.current) setProjects(next);
    }
  }, []);
  const replace = useCallback((next: Project | null) => {
    projectRef.current = next; dirtyRef.current = false;
    setProject(next); setDirty(false); setHistory([]); setFuture([]); setSelectedZoomId(null);
  }, []);
  const accept = useCallback((next: Project) => {
    if (removing.current.has(next.id)) return;
    replace(next);
    void refresh().catch((error: Error) => reportError(error.message));
  }, [replace, refresh, reportError]);
  const save = useCallback(async () => {
    const snapshot = projectRef.current;
    if (!snapshot || !window.studio || removing.current.has(snapshot.id)) return;
    // Chain writes so an older edit can never replace a more recent save.
    const write = (saving.current ?? Promise.resolve()).catch(() => undefined).then(() => window.studio!.saveProject(snapshot));
    saving.current = write;
    try { await write; }
    finally { if (saving.current === write) saving.current = null; }
    if (projectRef.current === snapshot) { dirtyRef.current = false; setDirty(false); }
    await refresh();
  }, [refresh]);
  const beforeSwitch = useCallback(async () => {
    if (!window.studio) throw new Error('请从桌面版打开小录，浏览器仅支持界面预览');
    await saving.current;
    if (dirtyRef.current) await save();
    return window.studio;
  }, [save]);
  const load = useCallback(async (id: string) => {
    const api = await beforeSwitch(); accept(await api.loadProject(id));
  }, [accept, beforeSwitch]);
  const open = useCallback(async () => {
    const api = await beforeSwitch(); const next = await api.openProject(); if (next) accept(next);
  }, [accept, beforeSwitch]);
  const importVideo = useCallback(async () => {
    const api = await beforeSwitch(); const next = await api.importVideo(); if (next) accept(next);
  }, [accept, beforeSwitch]);
  const change = useCallback((patch: Partial<Project>) => {
    const previous = projectRef.current;
    if (!previous || managing.current || removing.current.has(previous.id)) return;
    setHistory((items) => [...items.slice(-49), previous]);
    setFuture([]);
    const next = { ...previous, ...patch };
    projectRef.current = next; dirtyRef.current = true; setProject(next); setDirty(true);
  }, []);
  const undo = useCallback(() => {
    const previous = history.at(-1);
    if (!previous) return;
    if (managing.current || removing.current.has(previous.id)) return;
    const current = projectRef.current;
    if (current) setFuture(items => [...items, current]);
    setHistory((items) => items.slice(0, -1)); projectRef.current = previous; dirtyRef.current = true; setProject(previous); setDirty(true);
  }, [history]);
  const redo = useCallback(() => {
    const next = future.at(-1), previous = projectRef.current;
    if (!next || !previous || managing.current || removing.current.has(next.id)) return;
    setFuture(items => items.slice(0, -1)); setHistory(items => [...items.slice(-49), previous]);
    projectRef.current = next; dirtyRef.current = true; setProject(next); setDirty(true);
  }, [future]);
  const rename = useCallback(async (id: string, name: string) => {
    if (!window.studio) throw new Error('请从桌面版管理项目');
    if (managing.current) throw new Error('请等待当前项目操作完成');
    managing.current = true;
    try {
      // Flush pending edits before the dedicated name mutation; a name is never carried by autosave.
      await saving.current;
      if (projectRef.current?.id === id && dirtyRef.current) await save();
      const renamed = await window.studio.renameProject(id, name);
      const current = projectRef.current;
      if (current?.id === id) {
        const next = { ...current, name: renamed.name };
        projectRef.current = next; setProject(next);
        setHistory(items => items.map(item => item.id === id ? { ...item, name: renamed.name } : item));
        setFuture(items => items.map(item => item.id === id ? { ...item, name: renamed.name } : item));
      }
      await refresh().catch((error: Error) => reportError(error.message));
    } finally { managing.current = false; }
  }, [refresh, reportError, save]);
  const reveal = useCallback(async (id: string) => {
    if (!window.studio) throw new Error('请从桌面版管理项目');
    await window.studio.revealProject(id);
  }, []);
  const remove = useCallback(async (requested: string[]): Promise<ProjectDeletionResult> => {
    if (!window.studio) throw new Error('请从桌面版管理项目');
    const ids = [...new Set(requested)];
    if (!ids.length) return { deletedIds: [], failed: [] };
    if (managing.current) throw new Error('请等待当前项目操作完成');
    managing.current = true;
    try {
      await saving.current;
      const previous = projectRef.current;
      const deletingCurrent = previous && ids.includes(previous.id);
      const restoreCurrent = () => { replace(previous); setHistory(history); setFuture(future); setSelectedZoomId(selectedZoomId); };
      if (deletingCurrent && dirtyRef.current) await save();
      ids.forEach(id => removing.current.add(id));
      // Commit the empty editor and run media effect cleanup before Windows moves its files.
      if (deletingCurrent) flushSync(() => replace(null));
      let deletedIds: string[] = [];
      try {
        const result = await window.studio.deleteProjects(ids);
        deletedIds = result.deletedIds;
        if (deletingCurrent && !deletedIds.includes(previous.id)) restoreCurrent();
        setProjects(items => items.filter(item => !deletedIds.includes(item.id)));
        await refresh().catch((error: Error) => reportError(error.message));
        return result;
      } catch (error) {
        if (deletingCurrent && !deletedIds.includes(previous.id)) restoreCurrent();
        throw error;
      } finally { ids.forEach(id => removing.current.delete(id)); }
    } finally { managing.current = false; }
  }, [history, future, selectedZoomId, refresh, replace, reportError, save]);
  const split = useCallback((time: number) => {
    const active = projectRef.current; if (!active) return;
    const clips = splitClip(active.clips, time, 1 / active.fps);
    if (clips !== active.clips) change({ clips });
  }, [change]);
  const deleteClip = useCallback((id: string) => {
    const active = projectRef.current;
    if (!active) return;
    if (active.clips.length <= 1) { reportError('至少保留一个视频片段'); return; }
    change({ clips: active.clips.filter((clip) => clip.id !== id) });
  }, [change, reportError]);
  const deleteZoom = useCallback((id: string) => {
    const active = projectRef.current;
    if (!active?.zooms.some(zoom => zoom.id === id)) return;
    change({ zooms: active.zooms.filter(zoom => zoom.id !== id) }); setSelectedZoomId(null);
  }, [change]);
  const trim = useCallback((id: string, start: number, end: number) => {
    const active = projectRef.current;
    if (!active || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > active.duration || end - start < 1 / active.fps) {
      reportError('裁剪范围超出原始视频，或片段不足一帧'); return;
    }
    const index = active.clips.findIndex((clip) => clip.id === id);
    if (index < 0) return;
    if ((index > 0 && start < active.clips[index - 1].end) || (index < active.clips.length - 1 && end > active.clips[index + 1].start)) {
      reportError('片段不能与相邻片段重叠'); return;
    }
    change({ clips: active.clips.map((clip) => clip.id === id ? { ...clip, start, end } : clip) });
  }, [change, reportError]);
  const addZoom = useCallback((time: number) => {
    const active = projectRef.current; if (!active) return;
    const start = Math.min(outputToSourceTime(active.clips, time), Math.max(0, active.duration - 0.5));
    const end = Math.min(active.duration, start + 2);
    if (active.zooms.some((zoom) => start < zoom.end && end > zoom.start)) {
      reportError('此处已有缩放镜头，可以在右侧调整'); return;
    }
    const zoom = { id: crypto.randomUUID(), start, end, x: 0.5, y: 0.5, scale: 1.7 };
    change({ zooms: [...active.zooms, zoom].sort((a, b) => a.start - b.start) }); setSelectedZoomId(zoom.id);
  }, [change, reportError]);
  const autoZoom = useCallback(() => {
    const active = projectRef.current; if (!active) return;
    const zooms = generateAutoZooms(active.cursor, active.duration, active.inputActivity, active);
    if (!zooms.length) { reportError('这段视频没有可用的操作轨迹，可以手动添加缩放镜头'); return; }
    change({ zooms }); setSelectedZoomId(null);
  }, [change, reportError]);
  const updateZoom = useCallback((id: string, patch: Partial<ZoomSegment>) => {
    const active = projectRef.current;
    const previous = active?.zooms.find(zoom => zoom.id === id);
    if (!active || !previous) return;
    const next = { ...previous, ...patch, id };
    if (![next.start, next.end, next.x, next.y, next.scale].every(Number.isFinite)
      || next.start < 0 || next.end > active.duration || next.end - next.start < 1 / active.fps
      || next.x < 0 || next.x > 1 || next.y < 0 || next.y > 1 || next.scale < 1 || next.scale > 4) return;
    if (active.zooms.some(zoom => zoom.id !== id && next.start < zoom.end && next.end > zoom.start)) return;
    change({ zooms: active.zooms.map(zoom => zoom.id === id ? next : zoom).sort((a, b) => a.start - b.start) });
  }, [change]);

  useEffect(() => {
    void refresh().catch((error: Error) => reportError(error.message));
    return window.studio?.onProjectReady(accept);
  }, [accept, refresh, reportError]);
  useEffect(() => window.studio?.onBeforeClose(save), [save]);
  useEffect(() => {
    if (!dirty || !project) return;
    const timer = setTimeout(() => { void save().catch((error: Error) => reportError(`保存失败：${error.message}`)); }, 800);
    return () => clearTimeout(timer);
  }, [dirty, project, save, reportError]);

  return { project, projects, dirty, change, save, load, open, importVideo, beforeSwitch, rename, reveal, remove, selectedZoomId, setSelectedZoomId, split, deleteClip, deleteZoom, trim, addZoom, autoZoom, updateZoom, undo, redo, canUndo: history.length > 0, canRedo: future.length > 0 };
}
