import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Inspector } from '../src/components/Inspector';
import { Timeline } from '../src/components/Timeline';
import { CameraCanvasControls } from '../src/components/CameraCanvasControls';
import { useCompositionEditor } from '../src/hooks/useCompositionEditor';
import { useEditorSelection } from '../src/hooks/useEditorSelection';
import { renderFrame } from '../src/services/compositor';
import { DEFAULT_STYLE } from '../shared/constants';
import { outputToSourceTime, sourceToOutputTime } from '../shared/timeline';
import type { Project } from '../shared/types';
import { demoCameraEmbeddedAt } from '../shared/demo';
import { drawWebcam } from '../src/services/webcam-compositor';
import { webcamStyleAt } from '../shared/camera-layout';
import '../src/styles/index.css';
import '../src/app.css';

const source = document.createElement('canvas'), person = document.createElement('canvas');
source.width = 1280; source.height = 720; person.width = 320; person.height = 320;
const screenContext = source.getContext('2d')!, cameraContext = person.getContext('2d')!;
screenContext.fillStyle = '#e4ebe7'; screenContext.fillRect(0, 0, 1280, 720);
screenContext.fillStyle = '#385956'; screenContext.fillRect(0, 0, 1280, 65); screenContext.fillStyle = '#fff'; screenContext.font = '24px sans-serif'; screenContext.fillText('Controlled recording preview', 32, 43);
for (let index = 0; index < 7; index++) { screenContext.fillStyle = index % 2 ? '#a9c2bf' : '#cedbd5'; screenContext.fillRect(40, 100 + index * 78, 860 - index * 45, 46); }
cameraContext.fillStyle = '#6a9297'; cameraContext.fillRect(0, 0, 320, 320);
cameraContext.fillStyle = '#dfb594'; cameraContext.beginPath(); cameraContext.ellipse(160, 123, 68, 86, 0, 0, Math.PI * 2); cameraContext.fill();
cameraContext.fillStyle = '#5d6575'; cameraContext.beginPath(); cameraContext.ellipse(160, 330, 130, 140, 0, 0, Math.PI * 2); cameraContext.fill();
cameraContext.fillStyle = '#433f40'; cameraContext.fillRect(122, 102, 12, 9); cameraContext.fillRect(184, 102, 12, 9); cameraContext.fillRect(141, 163, 38, 7);
const initial: Project = { id: 'ad8402ec-2461-420e-93a6-4247e1a3a7f0', name: '局部镜头测试', createdAt: '2026-09-08T00:00:00Z',
  duration: 12, width: 1280, height: 720, fps: 30, media: { screen: 'synthetic-screen', camera: 'synthetic-camera' },
  cursor: [], zooms: [], clips: [{ id: 'clip-1', start: 0, end: 12 }], style: { ...DEFAULT_STYLE, padding: 0, radius: 0 }, audio: { system: 1, microphone: 1 },
  camera: { offset: 0, enabled: true, position: 'bottom-right', size: .22, mirror: false, shape: 'circle', shrinkOnZoom: true,
    keyframes: [{ t: 0, x: .82, y: .75, size: .22, shape: 'circle', mirror: false, visible: true }], useRecordedLayout: true } };
const fixture = new URLSearchParams(location.search).get('fixture');
const independentDemo = fixture?.startsWith('demo-independent');
if (fixture?.startsWith('demo')) {
  initial.demoCapture = [{ start: 1, end: 5, ...(independentDemo ? { camera: 'independent' as const } : {}) }];
  initial.compositions = [{ id: 'demo-local', start: 0, end: 8, screen: 'recording',
    camera: independentDemo ? { visible: true } : { visible: true, x: .35, y: .2, size: .4 } }];
  if (fixture.endsWith('board') || fixture === 'demo-partial') initial.whiteboard = { separateCanvas: true, events: [
    { t: 0, action: { kind: 'layout', visible: true, presentation: 'canvas',
      bounds: { x: fixture === 'demo-partial' ? .82 : 0, y: 0, width: fixture === 'demo-partial' ? .18 : 1, height: 1 } } },
  ] };
}
const recordedScreen = document.createElement('canvas'); recordedScreen.width = source.width; recordedScreen.height = source.height;
recordedScreen.getContext('2d')!.drawImage(source, 0, 0);
drawWebcam(recordedScreen.getContext('2d')!, person, webcamStyleAt(initial.camera!, 2), 1280, 720, 1);

function Harness() {
  const [project, setProject] = useState(initial), [time, setTime] = useState(2), [error, setError] = useState('');
  const [selectedZoom, setZoom] = useState<string | null>(null);
  const history = useRef<Project[]>([]), commits = useRef<object[]>([]), canvas = useRef<HTMLCanvasElement>(null);
  const projectRef = useRef(project); projectRef.current = project;
  const change = useCallback((patch: Partial<Project>) => {
    const current = projectRef.current; history.current.push(current); commits.current.push({ patch, stack: new Error().stack });
    const next = { ...current, ...patch }; projectRef.current = next; setProject(next);
  }, []);
  const composition = useCompositionEditor(project, change, setError);
  const selection = useEditorSelection(project, selectedZoom, composition.selectedId, setZoom, composition.select);
  const sourceTime = outputToSourceTime(project.clips, time), segment = project.compositions?.find(item => item.id === composition.selectedId);
  const previewSegment = composition.previewProject?.compositions?.find(item => item.id === composition.selectedId);
  const select = (id: string | null) => {
    selection.composition(id);
    const chosen = project.compositions?.find(item => item.id === id);
    if (chosen && (sourceTime < chosen.start || sourceTime >= chosen.end)) setTime(sourceToOutputTime(project.clips, chosen.start));
  };
  const selectPerson = () => {
    const selected = composition.selectAtSource(sourceTime, { outputTime: time });
    if (selected) { setTime(selected.outputTime); setZoom(null); }
  };
  const props = { selectedCompositionId: composition.selectedId, onSelectComposition: select, onAddComposition: () => {
    const selected = composition.add(time); if (selected) setTime(selected.outputTime);
  },
    onUpdateComposition: composition.update, onPreviewComposition: composition.preview, onDeleteComposition: composition.remove, onSplitComposition: composition.split };
  useEffect(() => {
    const context = canvas.current!.getContext('2d')!;
    const screen = demoCameraEmbeddedAt(project.demoCapture, sourceTime) ? recordedScreen : source;
    renderFrame(context, screen, composition.previewProject!, sourceTime, 1280, 720, person);
  }, [composition.previewProject, sourceTime]);
  Object.assign(window, { compositionUi: { state: () => ({ project, time, selectedId: composition.selectedId, history: history.current.length, commits: commits.current, error }),
    seek: setTime, select, undo: () => { const previous = history.current.pop(); if (previous) setProject(previous); },
    reset: () => { history.current = []; setProject(structuredClone(initial)); composition.select(null); setTime(2); },
  } });
  return <div className="workspace-shell"><div className="composition-test-title">小录 · 局部镜头编辑</div><div className="composition-test-body">
    <main className="editor-main"><section className="canvas-stage"><div className="canvas-toolbar"><span>画面预览</span><button aria-label="测试撤销" onClick={() => { const previous = history.current.pop(); if (previous) setProject(previous); }}>撤销</button>
      {fixture && <><button onClick={() => setTime(.5)}>演示前</button><button onClick={() => setTime(2)}>演示中</button><button onClick={() => setTime(5)}>演示后</button></>}
      {fixture && <><button onClick={() => change({ zooms: [] })}>镜头还原</button><button onClick={() => change({ zooms: [
        { id: 'demo-zoom', start: 0, end: 8, x: .3, y: .4, scale: 2.5 },
      ] })}>放大白板</button></>}
    </div>
      <div className="canvas-viewport"><canvas className="preview-canvas" ref={canvas} width={1280} height={720} aria-label="视频画面预览" />
        <CameraCanvasControls project={composition.previewProject!} selectedSegment={previewSegment} sourceTime={sourceTime} canvasRef={canvas}
          onSelect={selectPerson} onPreview={composition.preview} onCommit={composition.update} /></div></section>
      <Timeline project={project} currentTime={time} duration={12} playing={false} onSeek={setTime} onTogglePlay={() => {}}
        selectedClipId={selection.clipId} onSelectClip={selection.clip} deletion={selection.deletion} onDeleteSelected={() => {
          if (selection.selected?.kind === 'composition') composition.remove(selection.selected.id);
          if (selection.selected?.kind === 'zoom') change({ zooms: project.zooms.filter(item => item.id !== selection.selected?.id) });
          selection.clear();
        }}
        onSplit={() => { if (segment) composition.split(segment.id, sourceTime); }} onDeleteClip={() => {}}
        onTrim={(id, start, end) => change({ clips: project.clips.map(clip => clip.id === id ? { ...clip, start, end } : clip) })}
        onAddZoom={() => { composition.select(null); change({ zooms: [...project.zooms, { id: 'zoom-test', start: time, end: Math.min(12, time + 2), x: .5, y: .5, scale: 1.5 }] }); }}
        selectedZoomId={selectedZoom} onSelectZoom={selection.zoom} {...props} />
    </main><Inspector project={project} currentTime={time} onChange={change} selectedZoomId={selectedZoom} onSelectZoom={setZoom}
      onAutoZoom={() => {}} {...props} /></div>{error && <div role="alert">{error}</div>}</div>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
