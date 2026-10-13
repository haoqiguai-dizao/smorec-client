import { useCallback, useMemo, useRef, useState } from 'react';
import type { CompositionSegment, Project } from '../../shared/types';
import { removeCompositionSegment, splitCompositionSegment, updateCompositionSegment, upsertCompositionSegment } from '../../shared/compositions';
import { outputToSourceTime } from '../../shared/timeline';
import { selectCompositionAtSource, type CompositionSelectionOptions } from '../../shared/composition-selection';

interface Selection { projectId: string; id: string }
interface Draft { base: Project; id: string; patch: Partial<CompositionSegment> }

export function useCompositionEditor(project: Project | null, change: (patch: Partial<Project>) => void, onError: (message: string) => void) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const current = useRef(project);
  const importing = useRef(false);
  current.current = project;
  const selectedId = selection && selection.projectId === project?.id && project?.compositions?.some(item => item.id === selection.id) ? selection.id : null;
  const previewProject = useMemo(() => {
    if (!project || draft?.base !== project) return project;
    return { ...project, compositions: updateCompositionSegment(project.compositions ?? [], draft.id, draft.patch, project.duration) };
  }, [project, draft]);

  const select = useCallback((id: string | null) => {
    setDraft(null);
    setSelection(id && current.current ? { id, projectId: current.current.id } : null);
  }, []);
  const preview = useCallback((id: string, patch: Partial<CompositionSegment> | null) => {
    setDraft(patch && current.current ? { base: current.current, id, patch } : null);
  }, []);
  const update = useCallback((id: string, patch: Partial<CompositionSegment>) => {
    const active = current.current;
    setDraft(null);
    if (!active) return;
    const segments = active.compositions ?? [];
    const next = updateCompositionSegment(segments, id, patch, active.duration);
    const item = next.find(item => item.id === id);
    if (next === segments || !item) return;
    if (item.end - item.start < 1 / active.fps - 1e-8) { onError('局部镜头至少保留一帧'); return; }
    change({ compositions: next });
  }, [change, onError]);
  const selectAtSource = useCallback((sourceTime: number, options: CompositionSelectionOptions = {}) => {
    const active = current.current;
    if (!active) return;
    const result = selectCompositionAtSource(active, sourceTime, options);
    if (!result) { onError('这里不足一帧，请调整播放位置'); return; }
    if (!result.existing) {
      const segments = active.compositions ?? [];
      const next = upsertCompositionSegment(segments, result.segment, active.duration);
      if (next === segments) return;
      change({ compositions: next });
    }
    select(result.segment.id);
    return result;
  }, [change, onError, select]);
  const add = useCallback((outputTime: number) => {
    const active = current.current;
    return active ? selectAtSource(outputToSourceTime(active.clips, outputTime), { outputTime }) : undefined;
  }, [selectAtSource]);
  const split = useCallback((id: string, time: number) => {
    const active = current.current;
    const segment = active?.compositions?.find(item => item.id === id);
    if (!active || !segment) return;
    if (time - segment.start < 1 / active.fps - 1e-8 || segment.end - time < 1 / active.fps - 1e-8) {
      onError('请在局部镜头内部选择分割位置，两侧至少保留一帧'); return;
    }
    setDraft(null);
    change({ compositions: splitCompositionSegment(active.compositions!, id, time) });
  }, [change, onError]);
  const remove = useCallback((id: string) => {
    const active = current.current;
    if (!active?.compositions?.some(item => item.id === id)) return;
    change({ compositions: removeCompositionSegment(active.compositions, id) }); select(null);
  }, [change, select]);
  const chooseBackground = useCallback(async (id: string) => {
    const active = current.current;
    if (!active || !window.studio) { onError('请从桌面版选择背景图片'); return; }
    if (importing.current) return;
    importing.current = true;
    try {
      const asset = await window.studio.importBackground(active.id);
      const latest = current.current;
      if (!asset || !latest || latest.id !== active.id || !latest.compositions?.some(item => item.id === id)) return;
      const backgrounds = [...(latest.backgrounds ?? []).filter(item => item.id !== asset.id), asset];
      const compositions = updateCompositionSegment(latest.compositions, id, { screen: 'background', background: `asset:${asset.id}` }, latest.duration);
      setDraft(null); change({ backgrounds, compositions });
    } catch (error) { onError(error instanceof Error ? error.message : '背景图片导入失败'); }
    finally { importing.current = false; }
  }, [change, onError]);

  return { selectedId, select, selectAtSource, add, update, preview, split, remove, chooseBackground, previewProject };
}
