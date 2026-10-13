import { useCallback, useEffect, useRef, useState } from 'react';
import { getOutputDuration, outputToSourceTime, sourceToOutputTime } from '../../shared/timeline';
import { useExport } from './useExport';
import { useKeyboard } from './useKeyboard';
import { usePreview } from './usePreview';
import { useProjectEditor } from './useProjectEditor';
import { useRecording } from './useRecording';
import { useCompositionEditor } from './useCompositionEditor';
import { useEditorSelection } from './useEditorSelection';
import { useCanvasBackgroundEditor } from './useCanvasBackgroundEditor';

export function useStudioController() {
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const workingRef = useRef(false);
  const reportError = useCallback((message: string) => setError(message), []);
  const editor = useProjectEditor(reportError);
  const canvasBackground = useCanvasBackgroundEditor(editor.project, editor.change, reportError);
  const composition = useCompositionEditor(editor.project, editor.change, reportError);
  const selection = useEditorSelection(editor.project, editor.selectedZoomId, composition.selectedId, editor.setSelectedZoomId, composition.select);
  const preview = usePreview(composition.previewProject, reportError);
  // Returning to the launcher keeps the editor mounted; its playback must stop before hiding.
  useEffect(() => window.studio?.onBeforeClose(async () => { preview.pause(); }), [preview.pause]);
  const recording = useRecording(reportError, editor.beforeSwitch);
  const exporting = useExport(reportError);
  const duration = editor.project ? getOutputDuration(editor.project.clips) : 0;
  const recordingBusy = ['starting', 'recording', 'stopping'].includes(recording.state.status);
  const busy = working || recordingBusy || exporting.progress !== null;

  const run = useCallback(async (task: () => Promise<unknown>) => {
    if (workingRef.current) return;
    workingRef.current = true;
    setWorking(true);
    try { await task(); }
    catch (error) { reportError(error instanceof Error ? error.message : '操作失败'); }
    finally { workingRef.current = false; setWorking(false); }
  }, [reportError]);
  const manage = async <T,>(task: () => Promise<T>): Promise<T> => {
    if (workingRef.current || recordingBusy || exporting.progress !== null) throw new Error('请等待当前操作完成');
    workingRef.current = true; setWorking(true); preview.pause();
    try { return await task(); }
    finally { workingRef.current = false; setWorking(false); }
  };
  const renameProject = (id: string, name: string) => manage(() => editor.rename(id, name));
  const revealProject = (id: string) => manage(() => editor.reveal(id));
  const deleteProjects = (ids: string[]) => manage(() => editor.remove(ids));
  const renameCurrent = (name: string) => {
    if (editor.project) void renameProject(editor.project.id, name).catch(error => reportError(error instanceof Error ? error.message : '重命名失败'));
  };
  const startExport = () => {
    if (!editor.project) return;
    preview.pause();
    void run(async () => { await editor.save(); await exporting.start(editor.project!); });
  };
  const load = (id: string) => { preview.pause(); void run(() => editor.load(id)); };
  const importVideo = () => { preview.pause(); void run(editor.importVideo); };
  const openProject = () => { preview.pause(); void run(editor.open); };
  const record = () => { preview.pause(); void recording.open(); };
  const split = () => {
    preview.pause();
    if (composition.selectedId && editor.project) composition.split(composition.selectedId, outputToSourceTime(editor.project.clips, preview.currentTime));
    else editor.split(preview.currentTime);
  };
  const deleteClip = (id: string) => { preview.pause(); editor.deleteClip(id); preview.seek(0); };
  const trim = (id: string, start: number, end: number) => { preview.pause(); editor.trim(id, start, end); preview.seek(0); };
  const deleteSelected = () => {
    if (busy || !selection.selected) return;
    preview.pause();
    if (selection.selected.kind === 'zoom') editor.deleteZoom(selection.selected.id);
    else if (selection.selected.kind === 'composition') composition.remove(selection.selected.id);
    else if (!selection.deletion.enabled) { reportError(selection.deletion.reason); return; }
    else deleteClip(selection.selected.id);
    selection.clear();
  };
  const selectZoom = (id: string | null) => {
    selection.zoom(id); if (!id || !editor.project) return;
    preview.pause();
    const zoom = editor.project.zooms.find(item => item.id === id);
    const time = outputToSourceTime(editor.project.clips, preview.currentTime);
    if (!zoom || time >= zoom.start && time < zoom.end) return;
    const clip = editor.project.clips.find(item => item.start < zoom.end && item.end > zoom.start);
    if (clip) preview.seek(sourceToOutputTime(editor.project.clips, Math.max(clip.start, zoom.start)));
  };

  useKeyboard({ save: () => { void run(editor.save); }, undo: editor.undo, redo: editor.redo, play: () => { void preview.togglePlay(); }, split,
    remove: deleteSelected, deselect: selection.clear,
    step: (direction, seconds) => { preview.pause(); preview.seek(Math.max(0, Math.min(duration - 1 / editor.project!.fps,
      preview.currentTime + direction * (seconds ? 1 : 1 / editor.project!.fps)))); },
    enabled: Boolean(editor.project) && !busy });

  const selectComposition = (id: string | null) => {
    selection.composition(id);
    if (!id || !editor.project) return;
    editor.setSelectedZoomId(null);
    const selected = editor.project.compositions?.find(item => item.id === id);
    if (!selected) return;
    const source = outputToSourceTime(editor.project.clips, preview.currentTime);
    if (source < selected.start || source >= selected.end) {
      const visible = editor.project.clips.find(clip => clip.start < selected.end && clip.end > selected.start);
      if (visible) preview.seek(sourceToOutputTime(editor.project.clips, Math.max(visible.start, selected.start)));
    }
  };
  const addComposition = () => {
    preview.pause(); selection.clear();
    const result = composition.add(preview.currentTime);
    if (result) preview.seek(result.outputTime);
  };
  const selectCamera = () => {
    if (busy) return;
    const snapshot = preview.interactionSnapshot();
    if (!snapshot || snapshot.projectId !== editor.project?.id || !snapshot.cameraAvailable) return;
    preview.pause(); selection.clear();
    const result = composition.selectAtSource(snapshot.sourceTime, snapshot);
    if (result) preview.seek(result.outputTime);
  };

  return { editor, canvasBackground, composition, selection, preview, recording, exporting, error, dismissError: () => setError(null), busy, recordingBusy,
    selectZoom, selectClip: (id: string | null) => { preview.pause(); selection.clip(id); }, deleteSelected,
    selectComposition, addComposition, selectCamera,
    duration, load, importVideo, openProject, record, split, deleteClip, trim, startExport, renameProject, revealProject, deleteProjects, renameCurrent,
    save: () => { void run(editor.save); } };
}
