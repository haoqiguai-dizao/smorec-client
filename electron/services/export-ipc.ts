import { shell, type BrowserWindow } from 'electron';
import type { Exporter } from './exporter';
import type { ExportRenderer } from './export-renderer';

interface Options {
  handle: (channel: string, handler: (...args: unknown[]) => unknown) => void;
  window: () => BrowserWindow; exporter: Exporter; renderer: ExportRenderer;
  capturing: () => boolean; finished: (success: boolean) => void;
}

/** Registration reuses the editor's existing sender checks; the renderer has its own narrow IPC. */
export function installExportIpc({ handle, window, exporter, renderer, capturing, finished }: Options): void {
  handle('studio:export-render', async project => {
    if (capturing()) throw new Error('请先结束录制或直播，再导出视频');
    try { const result = await renderer.start(window(), project); if (result) finished(true); return result; }
    catch (error) { finished(false); throw error; }
  });
  handle('studio:export-render-cancel', () => renderer.cancel());
  handle('studio:export-start', (project, settings) => {
    if (capturing() || renderer.isActive()) throw new Error('请先结束当前采集或导出');
    return exporter.start(window(), project, settings);
  });
  handle('studio:export-cancel-preparation', () => exporter.cancelPreparation());
  handle('studio:export-append', (id, data) => exporter.append(id, data));
  handle('studio:export-finish', async id => {
    try { const result = await exporter.finish(id); finished(true); return result; }
    catch (error) { finished(false); throw error; }
  });
  handle('studio:export-cancel', id => exporter.cancel(id));
  handle('studio:export-reveal', file => {
    if (!exporter.isCompleted(file)) throw new Error('只能显示本次导出的文件');
    shell.showItemInFolder(file);
  });
}
