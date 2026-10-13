import { useCallback, useRef, useState } from 'react';
import type { Project } from '../../shared/types';
import { exportVideo } from '../services/export-video';
import { ExportProgressStore } from '../services/export-progress';

export function useExport(reportError: (message: string) => void) {
  const [progress, setProgress] = useState<ExportProgressStore | null>(null);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const start = useCallback(async (project: Project) => {
    if (!window.studio || controller.current) return;
    const abort = new AbortController(); controller.current = abort;
    const store = new ExportProgressStore();
    let published = false;
    const api = window.studio;
    const update = (value: { progress: number; phase: string }) => {
      store.update(value);
      if (!published) { published = true; setProgress(store); }
    };
    const unsubscribe = api.onRenderExportProgress?.(update);
    const cancel = () => { void api.cancelRenderExport?.().catch(() => {}); };
    abort.signal.addEventListener('abort', cancel, { once: true });
    setExportPath(null);
    try {
      update({ progress: 0, phase: '准备导出' });
      const path = api.renderExport ? await api.renderExport(project) : await exportVideo(api, project, update, abort.signal);
      if (path) setExportPath(path);
    } catch (error) {
      if (!abort.signal.aborted) reportError(error instanceof Error ? error.message : '导出失败');
    } finally {
      unsubscribe?.(); abort.signal.removeEventListener('abort', cancel);
      setProgress(null); controller.current = null;
    }
  }, [reportError]);
  return { progress, exportPath, start, cancel: () => controller.current?.abort(), dismiss: () => setExportPath(null) };
}
