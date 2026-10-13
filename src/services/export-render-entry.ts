import { exportVideo } from './export-video';

/** Dedicated renderer: no editor, playback loop, device capture or React tree. */
export async function runExportRenderer(): Promise<void> {
  const api = window.exportRenderer;
  if (!api) throw new Error('导出进程未连接');
  const abort = new AbortController(), unsubscribe = api.onCancel(() => abort.abort());
  try {
    const project = await api.ready();
    const path = await exportVideo(api, project, value => api.progress(value), abort.signal);
    api.complete({ path });
  } catch (error) { api.complete({ error: error instanceof Error ? error.message : String(error) }); }
  finally { unsubscribe(); }
}
