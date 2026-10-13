import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useState } from 'react';
import type { Project, StudioApi } from '../shared/types';
import { Inspector } from '../src/components/Inspector';
import { useCanvasBackgroundEditor } from '../src/hooks/useCanvasBackgroundEditor';
import { usePreview } from '../src/hooks/usePreview';
import { exportVideo } from '../src/services/export-video';
import '../src/styles/index.css';

async function call(method: string, args: unknown[] = []) {
  const response = await fetch(`/api/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
window.studio = {
  importBackground: id => call('importBackground', [id]),
  getStatus: async () => ({ platform: 'darwin' }),
  exportStart: (project, settings) => call('exportStart', [project, settings]),
  exportAppend: async (id, data) => {
    const response = await fetch(`/append/${id}`, { method: 'POST', body: data });
    if (!response.ok) throw new Error(await response.text());
  },
  exportFinish: id => call('exportFinish', [id]),
  exportCancel: id => call('exportCancel', [id]),
  cancelExportPreparation: () => call('cancelExportPreparation'),
} as StudioApi;

function Harness() {
  const [project, setProject] = useState<Project | null>(null), [message, setMessage] = useState(''), [error, setError] = useState('');
  const report = useCallback((value: string) => setError(value), []);
  const change = useCallback((patch: Partial<Project>) => setProject(previous => previous ? { ...previous, ...patch } : previous), []);
  const background = useCanvasBackgroundEditor(project, change, report);
  const preview = usePreview(project, report);
  useEffect(() => { void call('initial').then(setProject).catch(report); }, [report]);
  const run = async (method: string) => {
    try {
      if (project) await call('save', [project]);
      if (method !== 'save') setProject(await call(method, [project?.id]));
      setMessage(method === 'save' ? '项目已保存' : method === 'restart' ? '重启后已恢复' : '新项目已创建');
    } catch (cause) { report(String(cause)); }
  };
  return <div className="workspace-shell">
    <header style={{ padding: 16, display: 'flex', gap: 12 }}>
      <button onClick={() => void run('save')}>保存项目</button>
      <button onClick={() => void run('restart')}>模拟重启并恢复</button>
      <button onClick={() => void run('newProject')}>新建项目</button>
      <button onClick={() => void call('removeOriginal').then(() => setMessage('原图已移动')).catch(report)}>移动原图</button>
      <button onClick={() => {
        if (!project) return;
        void call('save', [project]).then(() => exportVideo(window.studio!, project, progress => setMessage(progress.phase), new AbortController().signal))
          .then(path => setMessage(`导出完成：${path}`)).catch(report);
      }}>导出测试视频</button>
    </header>
    <div className="workspace-body">
      <aside className="library-panel"><div className="library-heading">隔离验证项目</div></aside>
      <main className="editor-main"><section className="canvas-stage">
        <div className="canvas-toolbar">画布背景验证 · 隔离项目</div>
        <div className="canvas-viewport"><canvas ref={preview.canvasRef} className="preview-canvas" aria-label="视频画面预览" /></div>
        <output style={{ padding: 16 }} aria-label="验证状态">{message}</output>
        <output style={{ padding: 16 }} aria-label="项目背景">{project?.style.background}</output>
        {error && <p role="alert">{error}</p>}
      </section></main>
      {project && <Inspector project={project} currentTime={0} onChange={change} selectedZoomId={null}
        onSelectZoom={() => {}} onAutoZoom={() => {}} onChooseBackground={() => void background.choose()} importingBackground={background.importing} />}
    </div>
  </div>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
