import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Whiteboard } from '../src/components/whiteboard/Whiteboard';
import { drawRecordedBoard } from '../src/services/whiteboard-renderer';
import { parseBoardAction } from '../shared/whiteboard/validation';
import type { BoardEvent, BoardRecording, BoardShape, WhiteboardApi } from '../shared/whiteboard/types';
import '../src/styles/whiteboard.css';

// Uses the shipping speech hook, live canvas and replay renderer. Only native audio/IPC is synthetic.
const saved: BoardEvent[] = [];
const eventsOutput = document.getElementById('fixture-events')!;
const frameOutput = document.getElementById('fixture-frame')!;
let paints = 0, labels: string[] = [], dashes: number[] = [];
const samples: { t: number; text: string; dashes: number[] }[] = [];
const nativeClear = CanvasRenderingContext2D.prototype.clearRect;
const nativeText = CanvasRenderingContext2D.prototype.fillText;
const nativeStroke = CanvasRenderingContext2D.prototype.stroke;
CanvasRenderingContext2D.prototype.clearRect = function(...args) {
  if (paints) {
    samples.push({ t: performance.now() / 1000, text: labels.join('|'), dashes: [...dashes] });
    if (samples.length > 200) samples.shift();
    frameOutput.dataset.samples = JSON.stringify(samples);
  }
  paints++; labels = []; dashes = [];
  frameOutput.dataset.paints = String(paints);
  frameOutput.dataset.text = ''; frameOutput.dataset.dashes = '[]';
  frameOutput.textContent = `文字：— · 绘制 ${paints} 帧`;
  return nativeClear.apply(this, args);
};
CanvasRenderingContext2D.prototype.fillText = function(...args) {
  labels.push(args[0]); frameOutput.dataset.text = labels.join('|');
  frameOutput.textContent = `文字：${labels.join(' / ')} · 绘制 ${paints} 帧`;
  return nativeText.apply(this, args);
};
CanvasRenderingContext2D.prototype.stroke = function(path?: Path2D) {
  if (this.getLineDash().length) dashes.push(this.lineDashOffset);
  frameOutput.dataset.dashes = JSON.stringify(dashes);
  if (path) return nativeStroke.call(this, path);
  return (nativeStroke as (this: CanvasRenderingContext2D) => void).call(this);
};
const noop = async () => {};
window.whiteboard = {
  setBackdrop: async () => {},
  cameraPreview: { previewReady: async () => ({ sessionId: '' }), sendPreviewSignal: async () => {}, onPreviewSignal: () => () => {} },
  snapshot: async () => ({ session: 'motion-fixture', available: true, visible: true, events: saved,
    presentation: 'canvas', speechSupported: true, windowOptions: { pinned: false, transparent: false, passthrough: false } }),
  onState: () => () => {},
  act: async (_session, value) => {
    const action = parseBoardAction(value); saved.push({ t: performance.now() / 1000, action });
    eventsOutput.textContent = `${saved.length} 个事件 · 最近：${action.kind}`;
    eventsOutput.dataset.events = JSON.stringify(saved);
  },
  setVisible: noop, setMaximized: noop, setWindowOptions: noop, choosePresentation: noop,
  speechReady: async () => true, speechInstall: noop, onSpeechLevel: () => () => {},
  speechStart: async () => 'synthetic-speech',
  speechStop: async () => (document.getElementById('fixture-transcript') as HTMLInputElement).value, speechCancel: noop,
  importImage: async () => { throw new Error('Fixture has no image import'); }, pasteImage: async () => undefined,
} satisfies WhiteboardApi;

const base: BoardShape = { kind: 'shape', id: 'first', shape: 'rectangle', color: '#20242c', size: 4,
  x: 100, y: 250, width: 240, height: 140, text: '提出想法' };
const recording: BoardRecording = { events: [
  { t: 0, action: { kind: 'layout', visible: true, bounds: { x: 0, y: 0, width: 1, height: 1 } } },
  { t: 1, action: { kind: 'reveal', element: base } },
  { t: 3, action: { kind: 'reveal', element: { kind: 'line', id: 'link-a', size: 4, color: '#20242c', arrow: true,
    start: { x: 345, y: 320 }, end: { x: 475, y: 320 } } } },
  { t: 3.8, action: { kind: 'reveal', element: { ...base, id: 'second', x: 480, shape: 'ellipse', text: '梳理关系' } } },
  { t: 6.2, action: { kind: 'reveal', element: { kind: 'line', id: 'link-b', size: 4, color: '#20242c', arrow: true,
    start: { x: 725, y: 320 }, end: { x: 855, y: 320 } } } },
  { t: 7, action: { kind: 'reveal', element: { ...base, id: 'third', x: 860, shape: 'diamond', text: '形成结论' } } },
] };
function Playback({ source = recording }: { source?: BoardRecording }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [time, setTime] = useState(1.4), [playing, setPlaying] = useState(false);
  const duration = Math.max(10, (source.events.at(-1)?.t ?? 0) + 3.2);
  useEffect(() => {
    const target = canvas.current!;
    const paint = () => {
      const bounds = target.getBoundingClientRect();
      target.width = Math.round(bounds.width * devicePixelRatio); target.height = Math.round(bounds.height * devicePixelRatio);
      const ctx = target.getContext('2d')!; ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      ctx.clearRect(0, 0, bounds.width, bounds.height);
      drawRecordedBoard(ctx, source, time, 0, 0, bounds.width, bounds.height);
    };
    const observer = new ResizeObserver(paint); observer.observe(target); paint();
    return () => observer.disconnect();
  }, [time, source]);
  useEffect(() => {
    if (!playing) return;
    let frame = 0, previous = performance.now();
    const tick = (now: number) => {
      const elapsed = (now - previous) / 1000; previous = now;
      setTime(value => Math.min(duration, value + elapsed)); frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [playing, duration]);
  useEffect(() => { if (time >= duration) setPlaying(false); }, [time, duration]);
  return <main id="playback"><nav>
    <label>源时间 <input aria-label="源时间" type="number" min="0" max={duration} step=".1" value={time}
      onChange={event => { setPlaying(false); setTime(Number(event.target.value)); }} /></label>
    <button onClick={() => { if (time >= duration) setTime(0); setPlaying(value => !value); }}>{playing ? '暂停回放' : '播放回放'}</button>
  </nav><canvas aria-label="白板回放与导出共用绘制器" ref={canvas} /></main>;
}
const root = createRoot(document.getElementById('root')!);
document.getElementById('fixture-replay')!.onclick = () => root.render(<Playback />);
document.getElementById('fixture-saved-replay')!.onclick = () => root.render(<Playback source={{ events: [
  { t: 0, action: { kind: 'layout', visible: true, bounds: { x: 0, y: 0, width: 1, height: 1 } } }, ...structuredClone(saved),
] }} />);
document.getElementById('fixture-live')!.onclick = () => root.render(<Whiteboard />);
root.render(<Whiteboard />);
import.meta.hot?.dispose(() => {
  root.unmount();
  CanvasRenderingContext2D.prototype.clearRect = nativeClear;
  CanvasRenderingContext2D.prototype.fillText = nativeText;
  CanvasRenderingContext2D.prototype.stroke = nativeStroke;
});
