import { shortcutLabel } from '../shared/shortcut-label';
import { CheckCircle2, FolderOpen, Info, Loader2, Monitor, Square, Undo2, X } from 'lucide-react';
import { EmptyCanvas } from './components/EmptyCanvas';
import { ExportDialog } from './components/ExportDialog';
import { Inspector } from './components/Inspector';
import { LibraryPanel } from './components/LibraryPanel';
import { Timeline } from './components/Timeline';
import { TitleBar } from './components/TitleBar';
import { useStudioController } from './hooks/useStudioController';
import { CameraCanvasControls } from './components/CameraCanvasControls';

export default function App() {
  const studio = useStudioController();
  const { editor, composition, preview, recording, exporting } = studio;
  const { project } = editor;
  const selectedComposition = composition.previewProject?.compositions?.find(item => item.id === composition.selectedId);
  const selectZoom = studio.selectZoom;
  const compositionProps = {
    selectedCompositionId: composition.selectedId, onSelectComposition: studio.selectComposition,
    onAddComposition: studio.addComposition, onUpdateComposition: composition.update,
    onPreviewComposition: composition.preview, onDeleteComposition: composition.remove,
    onSplitComposition: composition.split, onChooseCompositionBackground: (id: string) => { void composition.chooseBackground(id); },
    compositionBackgrounds: project?.backgrounds?.map(asset => ({ id: `asset:${asset.id}`, name: asset.name, url: asset.src })),
  };
  const seconds = Math.floor(recording.elapsed);
  return <div className="workspace-shell">
    <TitleBar projectName={project?.name ?? '工作区'} dirty={editor.dirty}
      onRename={studio.renameCurrent} onSave={studio.save} onExport={studio.startExport}
      canExport={Boolean(project && preview.ready && recording.appStatus?.ffmpegAvailable)} canSave={Boolean(project)} busy={studio.busy} />
    <div className="workspace-body">
      <LibraryPanel projects={editor.projects} activeId={project?.id} onLoad={studio.load}
        onImport={studio.importVideo} onOpen={studio.openProject} onRecord={studio.record} busy={studio.busy}
        onRename={studio.renameProject} onReveal={studio.revealProject} onDelete={studio.deleteProjects} />
      <main className="editor-main">
        <section className="canvas-stage">
          <div className="canvas-toolbar">
            <span className="toolbar-label"><Monitor size={13} />{project ? '画面预览' : '工作区'}</span>
            {project && <div className="toolbar-controls">
              <button className="icon-button" title={shortcutLabel('撤销 · Ctrl+Z')} aria-label="撤销" onClick={editor.undo} disabled={!editor.canUndo || studio.busy}><Undo2 size={14} /></button>
              <span>{project.width} × {project.height}</span><span>{project.fps} FPS</span>
              {(preview.audioProcessing || preview.originalAudioPreview) && <span role="status"
                title={preview.loadingError ? '声音更新失败，当前使用可用音轨继续预览。' : preview.audioProcessing ? '声音效果在后台准备，播放继续；准备好后自动应用。' : '当前使用原声预览。'}>
                {preview.audioProcessing ? '声音更新中' : '原声预览'} <Info size={12} />
              </span>}
            </div>}
          </div>
          {project ? <>
            <div className="canvas-viewport">
              <canvas ref={preview.canvasRef} className="preview-canvas" aria-label="视频画面预览" style={{ visibility: preview.videoReady ? 'visible' : 'hidden' }} />
              {preview.videoReady && preview.presentedCameraAvailable && !preview.playing && !studio.busy && preview.presentedSourceTime !== undefined && <CameraCanvasControls
                project={composition.previewProject ?? project} selectedSegment={selectedComposition} sourceTime={preview.presentedSourceTime} canvasRef={preview.canvasRef}
                onSelect={studio.selectCamera} onPreview={composition.preview} onCommit={composition.update} />}
              {!preview.videoReady && <div className="preview-loading">{preview.loadingError ? <><Info size={20} /><p>{preview.loadingError}</p></> : <><Loader2 className="spin" size={22} /><span>加载原始画面</span></>}</div>}
            </div>
            <div className="canvas-footer"><span>{project.style.aspect === 'auto' ? '原始比例' : project.style.aspect}</span><span>·</span><span>适应画布</span></div>
          </> : <EmptyCanvas onRecord={studio.record} onImport={studio.importVideo} />}
          {studio.recordingBusy && <div className="recording-overlay">
            <div className="recording-indicator"><i className="record-dot" />{recording.state.status === 'recording' ? '正在录制' : recording.state.status === 'stopping' ? '正在保存原始文件' : '正在准备录制'}</div>
            <div className="recording-time">{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</div>
            <button className="button primary" onClick={() => void recording.stop()} disabled={recording.state.status !== 'recording'}><Square size={14} />停止并编辑</button>
            <kbd>{shortcutLabel('Ctrl + Shift + R')}</kbd>
          </div>}
        </section>
        {project && <Timeline project={project} currentTime={preview.currentTime} duration={studio.duration} playing={preview.playing}
          onSeek={preview.seek} onTogglePlay={() => void preview.togglePlay()} onSplit={studio.split} onDeleteClip={studio.deleteClip}
          onTrim={studio.trim} onAddZoom={() => { preview.pause(); studio.selection.clear(); editor.addZoom(preview.currentTime); }}
          selectedClipId={studio.selection.clipId} onSelectClip={studio.selectClip} onDeleteSelected={studio.deleteSelected}
          deletion={studio.selection.deletion}
          selectedZoomId={editor.selectedZoomId} onSelectZoom={selectZoom} onUpdateZoom={editor.updateZoom} {...compositionProps} />}
      </main>
      {project && <Inspector project={project} currentTime={preview.currentTime} onChange={editor.change} selectedZoomId={editor.selectedZoomId}
        onChooseBackground={() => { void studio.canvasBackground.choose(); }} importingBackground={studio.canvasBackground.importing}
        onSelectZoom={selectZoom} onAutoZoom={editor.autoZoom} {...compositionProps} />}
    </div>
    {!window.studio && <div className="browser-notice"><Info size={14} />浏览器预览模式 · 录制与导出请使用小录桌面版</div>}
    {exporting.progress && <ExportDialog state={exporting.progress} onCancel={exporting.cancel} />}
    {studio.error && <div className="status-message status-error" role="alert"><Info size={17} /><span>{studio.error}</span>
      <button className="icon-button" aria-label="关闭提示" onClick={studio.dismissError}><X size={15} /></button></div>}
    {exporting.exportPath && <div className="status-message" role="status"><CheckCircle2 size={18} /><span>视频已导出</span>
      <button className="button" onClick={() => void window.studio?.revealExport(exporting.exportPath!)}><FolderOpen size={14} />打开文件位置</button>
      <button className="icon-button" aria-label="关闭导出提示" onClick={exporting.dismiss}><X size={15} /></button></div>}
  </div>;
}
