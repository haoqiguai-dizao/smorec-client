import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CanvasPanel } from '../src/components/inspector/CanvasPanel';
import { usePreviewResolution } from '../src/hooks/usePreviewResolution';
import { renderFrame, getCanvasSize } from '../src/services/compositor';
import { screenGeometry } from '../src/services/compositor-decoration';
import { exportVideo } from '../src/services/export-video';
import { boardAt } from '../shared/whiteboard/model';
import { boardViewport } from '../shared/whiteboard/viewport';
import { parseBoardRecording } from '../shared/whiteboard/validation';
import { DEFAULT_STYLE } from '../shared/constants';
import type { CanvasStyle, Project } from '../shared/types';
import type { ExportVideoApi } from '../shared/export-render';
import '../src/styles/index.css';

const raster = (color: string) => {
  const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = color; ctx.fillRect(0, 0, 1280, 720);
  // Asymmetric markers reveal crop/mirror drift as well as aspect drift.
  for (const [x, c] of [[0, '#2862b8'], [1120, '#b86228']] as const) {
    ctx.fillStyle = c; ctx.fillRect(x, 0, 160, 720);
  }
  return canvas;
};
const screen = raster('#364557'), camera = raster('#408060');
const recording = parseBoardRecording({ separateCanvas: true, events: [
  { t: 0, action: { kind: 'layout', visible: false, bounds: { x: 0, y: 0, width: 1, height: 1 } } },
  { t: .1, action: { kind: 'viewport', view: { x: 600, y: 350, zoom: 1 } } },
  { t: .2, action: { kind: 'stroke', id: 'left-ink', color: '#ff999d', size: 20, points: [{ x: 90, y: 350 }, { x: 240, y: 350 }] } },
  { t: .3, action: { kind: 'stroke', id: 'right-ink', color: '#ffe28a', size: 20, points: [{ x: 960, y: 350 }, { x: 1110, y: 350 }] } },
  { t: 1, action: { kind: 'layout', visible: true, bounds: { x: 0, y: 0, width: 1, height: 1 }, backdrop: 'camera', shade: .4,
    cameraTransition: { direction: 'enter', duration: 1.1, camera: { x: .7, y: .7, width: .25, height: .25 } } } },
  { t: 2.1, action: { kind: 'layout', visible: true, bounds: { x: 0, y: 0, width: 1, height: 1 }, backdrop: 'camera', shade: .4 } },
  { t: 3.2, action: { kind: 'layout', visible: true, bounds: { x: 0, y: 0, width: 1, height: 1 }, backdrop: 'white', shade: .4,
    cameraTransition: { direction: 'exit', duration: 1.1, camera: { x: .7, y: .7, width: .25, height: .25 } } } },
  { t: 4.3, action: { kind: 'layout', visible: true, bounds: { x: 0, y: 0, width: 1, height: 1 }, backdrop: 'white' } },
  { t: 5, action: { kind: 'layout', visible: false, bounds: { x: 0, y: 0, width: 1, height: 1 } } },
] }, 6);
const initial: Project = { id: 'whiteboard-aspect', name: '合成画布比例验收', createdAt: '', duration: 6, width: 1280, height: 720,
  fps: 30, media: { screen: 'synthetic-screen', camera: 'synthetic-camera' }, clips: [{ id: 'all', start: 0, end: 6 }],
  cursor: [], zooms: [], style: { ...DEFAULT_STYLE, background: '#1c2638', showCursor: false }, audio: { system: 0, microphone: 0 },
  whiteboard: recording, camera: { offset: 0, enabled: true, position: 'bottom-right', size: .2, mirror: false, shape: 'rounded', shrinkOnZoom: false } };
let active = initial, currentTime = 0;
const images: { name: string; data: string }[] = [];
const check = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
const nextPaint = async () => { for (let n = 0; n < 3; n++) await new Promise(requestAnimationFrame); };
const pixel = (ctx: CanvasRenderingContext2D, x: number, y: number) => Array.from(ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data);
const same = (a: number[], b: number[], tolerance = 1) => a.every((v, i) => Math.abs(v - b[i]) <= tolerance);

function Harness() {
  const [project, setProject] = useState(initial), [time, setTime] = useState(0), canvas = useRef<HTMLCanvasElement>(null);
  active = project; currentTime = time;
  const redraw = useCallback(() => {
    const target = canvas.current, size = resolution.current;
    if (!target || !size) return;
    target.width = size.width; target.height = size.height;
    renderFrame(target.getContext('2d')!, screen, active, currentTime, size.width, size.height, camera, 'preview');
  }, []);
  const resolution = usePreviewResolution(canvas, project, redraw, () => {});
  useLayoutEffect(redraw, [project, time, redraw]);
  const change = (patch: Partial<CanvasStyle>) => setProject(value => ({ ...value, style: { ...value.style, ...patch } }));
  window.aspectFixture = { sources: { screen, camera }, patch: patch => setProject(value => ({ ...value, ...patch })) };
  return <div className="workspace-shell"><header style={{ padding: 12, display: 'flex', gap: 16 }}>
    <button onClick={() => setTime(0)}>正常录屏</button><button onClick={() => setTime(2.5)}>摄像头白板</button>
    <button onClick={() => setTime(4.5)}>普通白板</button><button onClick={() => setTime(5.5)}>返回录屏</button>
    <span>合成素材 · 不使用摄像头或麦克风</span></header><div className="workspace-body">
    <aside className="library-panel"><div className="library-heading">隔离合成工程</div></aside>
    <main className="editor-main"><section className="canvas-stage"><div className="canvas-viewport">
      <canvas ref={canvas} className="preview-canvas" aria-label="视频画面预览" /></div></section></main>
    <aside className="inspector-panel"><CanvasPanel style={project.style} onChange={change} /></aside>
  </div></div>;
}
createRoot(document.getElementById('root')!).render(<Harness />);

declare global { interface Window {
  aspectFixture: { sources: { screen: HTMLCanvasElement; camera: HTMLCanvasElement }; patch(patch: Partial<Project>): void };
  runWhiteboardAspectChecks(baseline: boolean): Promise<unknown>;
} }
window.runWhiteboardAspectChecks = async baseline => {
  await nextPaint(); const original = JSON.stringify(recording);
  const click = async (label: string) => {
    const button = Array.from(document.querySelectorAll('button')).find(value => value.textContent === label);
    check(!!button, `Missing button: ${label}`); button!.click(); await nextPaint();
  };
  const output = (project = active, time = currentTime, mode: 'preview' | 'source' = 'source') => {
    const canvas = document.createElement('canvas'), size = getCanvasSize(project);
    canvas.width = size.width; canvas.height = size.height;
    renderFrame(canvas.getContext('2d')!, screen, project, time, size.width, size.height, camera, mode);
    return canvas;
  };
  const capture = (name: string, canvas = output()) => { images.push({ name, data: canvas.toDataURL('image/png') }); return canvas; };
  const checks: unknown[] = [];
  // User's exact order: normal screen -> select 9:16 -> camera whiteboard.
  await click('正常录屏'); await click('9:16');
  const normal = capture('normal-9-16'); await click('摄像头白板');
  const board = capture('camera-board-9-16'), ctx = board.getContext('2d')!, normalCtx = normal.getContext('2d')!;
  const outsideMatches = same(pixel(ctx, board.width / 2, 30), pixel(normalCtx, normal.width / 2, 30));
  const ui = document.querySelector<HTMLCanvasElement>('.preview-canvas')!, rect = ui.getBoundingClientRect();
  check(Math.abs(rect.width / rect.height - 9 / 16) < .002, 'CSS canvas must be portrait and centered');
  const viewport = ui.parentElement!.getBoundingClientRect();
  check(Math.abs(rect.left + rect.width / 2 - (viewport.left + viewport.width / 2)) < 1, 'Canvas must stay centered');
  if (!baseline) check(outsideMatches, 'Camera board covered the portrait letterbox/background');
  else check(!outsideMatches, 'Baseline bug was not reproduced');
  checks.push({ phase: 'normal-portrait-then-camera-board', outsideMatches, css: { width: rect.width, height: rect.height },
    normalOutside: pixel(normalCtx, normal.width / 2, 30), boardOutside: pixel(ctx, board.width / 2, 30) });
  for (const aspect of ['原始', '16:9', '9:16', '1:1']) {
    await click(aspect); await click('摄像头白板');
    const project = active, canvas = capture(`camera-board-${project.style.aspect.replace(':', '-')}`), c = canvas.getContext('2d')!;
    const geometry = screenGeometry(project, canvas.width, canvas.height), view = boardViewport(geometry.frameWidth, geometry.frameHeight, boardAt(recording, 2.5).view);
    const inkSamples = [165, 1035].map(x => pixel(c, geometry.left + view.left + x * view.scale, geometry.top + view.top + 350 * view.scale));
    if (!baseline) { check(inkSamples[0][0] > 240 && inkSamples[0][1] > 100, 'Left ink must retain its source coordinate');
      check(inkSamples[1][0] > 240 && inkSamples[1][1] > 180, 'Right ink must retain its source coordinate'); }
    const preview = output(project, 2.5, 'preview').getContext('2d')!;
    check(same(pixel(preview, canvas.width / 2, canvas.height / 2), pixel(c, canvas.width / 2, canvas.height / 2)), 'Preview/source composition drift');
    await click('普通白板'); capture(`white-board-${project.style.aspect.replace(':', '-')}`);
    await click('返回录屏'); capture(`returned-screen-${project.style.aspect.replace(':', '-')}`);
    await click('摄像头白板');
    check(JSON.stringify(recording) === original, 'Mode/aspect changes must preserve journal and ink history');
    checks.push({ phase: 'aspect-and-mode-roundtrip', aspect: project.style.aspect, size: getCanvasSize(project), inkSamples, journalUnchanged: true });
  }
  await click('9:16');
  // Every animation frame, and a zoomed/panned board, must leave the outer background alone.
  for (const time of [1, 1.15, 1.5, 2.099, 2.5, 3.2, 3.5, 4.29, 4.5]) {
    const c = output(active, time).getContext('2d')!;
    if (!baseline) check(same(pixel(c, 360, 20), pixel(normalCtx, 360, 20)), 'Transition escaped source frame at ' + time);
  }
  const zoomed = { ...active, zooms: [{ id: 'focus', start: 0, end: 6, x: .4, y: .5, scale: 1.8 }],
    style: { ...active.style, padding: 64, radius: 20, shadow: 20 } };
  capture('camera-board-portrait-framed-zoom', output(zoomed, 2.5));
  const reopened = { ...active, whiteboard: parseBoardRecording(JSON.parse(JSON.stringify(recording)), 6) };
  check(same(pixel(output(reopened).getContext('2d')!, 360, 640), pixel(output().getContext('2d')!, 360, 640)), 'Serialized journal changed output');
  // Actual shipping exportVideo, encoder, and packet queue; only decoded media is synthetic.
  const exports: unknown[] = [];
  for (const aspect of ['9:16', '1:1', 'auto'] as const) {
    const project = { ...active, style: { ...active.style, aspect } }, packets: number[][] = []; let settings: unknown;
    const api = { getStatus: async () => ({ platform: 'synthetic' }), cancelExportPreparation: async () => {},
      exportStart: async (_project: Project, value: unknown) => { settings = value; return { id: 'synthetic-export' }; },
      exportAppend: async (_id: string, bytes: ArrayBuffer) => { packets.push(Array.from(new Uint8Array(bytes))); },
      exportFinish: async () => 'synthetic.mp4', exportCancel: async () => {},
    } as unknown as ExportVideoApi;
    await exportVideo(api, project, () => {}, new AbortController().signal);
    exports.push({ aspect, settings, packets });
  }
  return { result: baseline ? 'REPRODUCED' : 'PASS', physicalDevicesUsed: false, baseline, checks, images, exports,
    source: { width: 1280, height: 720 }, journalUnchanged: original === JSON.stringify(recording) };
};
