import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Whiteboard } from '../src/components/whiteboard/Whiteboard';
import { useCameraPreviewReceiver } from '../src/hooks/useCameraPreviewReceiver';
import { parseBoardAction } from '../shared/whiteboard/validation';
import type { BoardEvent, BoardSnapshot, WhiteboardApi } from '../shared/whiteboard/types';
import { CAMERA_BOARD_DURATION } from '../shared/whiteboard/camera-scene';
import { DEFAULT_STYLE } from '../shared/constants';
import type { Project } from '../shared/types';
import { renderFrame } from '../src/services/compositor';
import { preparedCamera } from './whiteboard-camera-fixture';
import { speechFixture } from './whiteboard-speech-fixture';
import '../src/styles/whiteboard.css';

const nativeFixture = (window as Window & { cameraFixtureEnvironment?: { insets: BoardSnapshot['controlsInsets']; backdrop(camera: boolean): void } }).cameraFixtureEnvironment;
const camera = await preparedCamera(), origin = performance.now();
const time = () => (performance.now() - origin) / 1000;
const saved: BoardEvent[] = [], listeners = new Set<(state: Omit<BoardSnapshot, 'events'>) => void>();
let sceneRevision = 0;
const speechMode = new URLSearchParams(location.search).has('speech');
const tracingMode = new URLSearchParams(location.search).has('tracing');
document.body.dataset.fixtureTracing = String(tracingMode);
document.getElementById('fixture-tracing-reference')!.hidden = !tracingMode;
let state: Omit<BoardSnapshot, 'events'> = { session: 'camera-fixture', available: true, visible: true, backdrop: speechMode ? 'camera' : 'white',
  speechSupported: speechMode, controlsInsets: nativeFixture?.insets, shade: .4, presentation: 'canvas', camera: camera.state, windowOptions: { pinned: false, transparent: false, passthrough: false } };
const result = document.getElementById('fixture-result')!;
let downloadUrl: string | undefined;
const publish = () => {
  for (const listener of listeners) listener({ ...state });
  result.dataset.state = state.backdrop; result.dataset.busy = String(!!state.sceneBusy);
  result.dataset.events = JSON.stringify(saved); result.textContent = `${state.backdrop === 'camera' ? '摄像头白板' : '普通白板'} · ${saved.length} 个保存事件`;
  for (const id of ['fixture-tools', 'fixture-result']) document.getElementById(id)?.toggleAttribute('hidden', !!nativeFixture && state.visible && (state.backdrop === 'camera' || !!state.cameraTransition));
  document.getElementById('fixture-hud')?.toggleAttribute('hidden', state.backdrop === 'camera' || !!state.cameraTransition);
};
const layout = () => ({ t: time(), action: { kind: 'layout' as const, visible: state.visible,
  bounds: { x: 0, y: 0, width: 1, height: 1 }, backdrop: state.backdrop, shade: state.shade,
  ...(state.cameraTransition ? { cameraTransition: { direction: state.cameraTransition.direction,
    duration: state.cameraTransition.duration, camera: state.cameraTransition.camera } } : {}) } });
saved.push(layout());
const noop = async () => {};
function traceTransition() {
  const trace: { t: number; width: number; shade: number; ink: string }[] = [], started = performance.now();
  const sample = () => {
    const frame = document.querySelector('.whiteboard .board-camera-frame'), shade = document.querySelector('.whiteboard .board-camera-shade');
    if (frame && shade) trace.push({ t: (performance.now() - started) / 1000, width: frame.getBoundingClientRect().width,
      shade: Number(getComputedStyle(shade).opacity), ink: document.documentElement.style.getPropertyValue('--board-camera-ink') });
    result.dataset.trace = JSON.stringify(trace);
    if (performance.now() - started < 1150) requestAnimationFrame(sample);
  }; requestAnimationFrame(sample);
}
window.whiteboard = {
  cameraPreview: camera.receiver,
  snapshot: async () => ({ ...state, events: structuredClone(saved) }),
  onState: callback => { listeners.add(callback); return () => listeners.delete(callback); },
  act: async (_session, value) => { saved.push({ t: time(), action: parseBoardAction(value) }); publish(); },
  setBackdrop: async (_session, backdrop, shade = state.shade) => {
    if (state.sceneBusy && backdrop === 'white') { sceneRevision++; state = { ...state, backdrop, sceneBusy: false, cameraTransition: undefined }; nativeFixture?.backdrop(false); saved.push(layout()); publish(); return; }
    if (state.sceneBusy) throw new Error('模式切换中');
    const revision = ++sceneRevision;
    if (backdrop === state.backdrop) { state = { ...state, shade }; saved.push(layout()); publish(); return; }
    state = { ...state, backdrop, shade, sceneBusy: true, cameraTransition: { direction: backdrop === 'camera' ? 'enter' : 'exit',
      duration: CAMERA_BOARD_DURATION, camera: { x: .7, y: .68, width: .25, height: .25 }, startedAt: Date.now() / 1000 } };
    if (backdrop === 'camera') nativeFixture?.backdrop(true); saved.push(layout()); publish(); traceTransition();
    await new Promise(resolve => setTimeout(resolve, CAMERA_BOARD_DURATION * 1000));
    if (revision !== sceneRevision) return;
    state = { ...state, sceneBusy: false, cameraTransition: undefined }; nativeFixture?.backdrop(backdrop === 'camera'); saved.push(layout()); publish();
  },
  setVisible: async visible => {
    if (visible && !state.visible) { sceneRevision++; saved.push({ t: time(), action: { kind: 'reset' } });
      state = { ...state, session: crypto.randomUUID(), backdrop: 'white', sceneBusy: false, cameraTransition: undefined }; nativeFixture?.backdrop(false); }
    state = { ...state, visible }; if (!visible) nativeFixture?.backdrop(false); saved.push(layout()); publish();
    document.getElementById('root')!.style.visibility = visible ? 'visible' : 'hidden';
  },
  setMaximized: noop,
  setWindowOptions: async (_session, options) => { state = { ...state, windowOptions: { ...state.windowOptions!, ...options } }; publish(); },
  choosePresentation: noop, ...speechFixture(),
  ...(tracingMode ? { chooseMode: noop } : {}),
  importImage: async () => { throw new Error('Not enabled in fixture'); }, pasteImage: async () => undefined,
} satisfies WhiteboardApi;

function Hud() {
  const video = useRef<HTMLVideoElement>(null);
  const preview = useCameraPreviewReceiver(true, camera.state.cameraSessionId, video, true, camera.receiver);
  useEffect(() => { if (video.current) video.current.srcObject = preview.stream; }, [preview.stream]);
  return <div id="fixture-hud"><video ref={video} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div>;
}
function Live() { useEffect(publish, []); return <><Whiteboard /><Hud /></>; }
const project = (): Project => ({ id: 'fixture', name: '摄像头白板', createdAt: '', duration: time(), width: 1280, height: 720, fps: 30,
  media: { screen: '' }, clips: [{ id: 'clip', start: 0, end: time() }], cursor: [], zooms: [],
  style: { ...DEFAULT_STYLE, padding: 0, radius: 0, shadow: 0 }, audio: { system: 0, microphone: 0 }, whiteboard: { events: structuredClone(saved) },
  camera: { offset: 0, enabled: true, position: 'bottom-right', size: .3, mirror: false, shape: 'rounded', shrinkOnZoom: false } });
function Playback() {
  const canvas = useRef<HTMLCanvasElement>(null), source = useRef(project());
  useEffect(() => {
    const ctx = canvas.current!.getContext('2d')!, started = performance.now(); let frame = 0;
    const paint = () => {
      const t = Math.min(source.current.duration, (performance.now() - started) / 1000);
      renderFrame(ctx, camera.source, source.current, t, 1280, 720, camera.source, 'source');
      result.dataset.playback = String(t); if (t < source.current.duration) frame = requestAnimationFrame(paint);
    }; paint(); return () => cancelAnimationFrame(frame);
  }, []);
  return <canvas id="fixture-playback" aria-label="共享合成回放" ref={canvas} width={1280} height={720} />;
}
async function encode() {
  const source = project(), canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
  const context = canvas.getContext('2d')!, packets: { bytes: Uint8Array; timestamp: number; type: EncodedVideoChunkType }[] = [];
  const transitions = source.whiteboard!.events.filter(event => event.action.kind === 'layout' && event.action.cameraTransition?.direction === 'enter');
  const entering = transitions.at(-1), frames = 108;
  if (entering) {
    // Bound the acceptance movie; retain actual ink actions and the shipping transition duration.
    const before = source.whiteboard!.events.filter(event => event.t < entering.t && event.action.kind !== 'layout');
    const ink = source.whiteboard!.events.filter(event => event.t >= entering.t && event.action.kind !== 'layout');
    source.whiteboard = { events: [
      { t: 0, action: { kind: 'layout', visible: true, bounds: { x: 0, y: 0, width: 1, height: 1 } } },
      ...before.map(event => ({ ...event, t: 0 })), { ...entering, t: .1 },
      { t: 1.2, action: { kind: 'layout', visible: true, bounds: { x: 0, y: 0, width: 1, height: 1 }, backdrop: 'camera', shade: state.shade } },
      ...ink.map((event, index) => ({ ...event, t: 1.4 + index / Math.max(1, ink.length) * 1.2 })),
    ] };
  }
  source.duration = 3.6; source.clips = [{ id: 'clip', start: 0, end: 3.6 }];
  const encoder = new VideoEncoder({ output: chunk => { const bytes = new Uint8Array(chunk.byteLength); chunk.copyTo(bytes);
    packets.push({ bytes, timestamp: chunk.timestamp, type: chunk.type }); }, error: error => { throw error; } });
  encoder.configure({ codec: 'vp8', width: 1280, height: 720, bitrate: 4000000, framerate: 30 });
  for (let n = 0; n < frames; n++) {
    renderFrame(context, camera.source, source, n / 30, 1280, 720, camera.source, 'source');
    const frame = new VideoFrame(canvas, { timestamp: Math.round(n * 1e6 / 30), duration: 33333 });
    encoder.encode(frame, { keyFrame: n % 60 === 0 }); frame.close();
    if (n % 30 === 29) await encoder.flush();
  }
  await encoder.flush(); encoder.close();
  let decoded = 0;
  const decoder = new VideoDecoder({ output: frame => { decoded++; frame.close(); }, error: error => { throw error; } });
  decoder.configure({ codec: 'vp8', codedWidth: 1280, codedHeight: 720 });
  for (const packet of packets) decoder.decode(new EncodedVideoChunk({ data: packet.bytes, timestamp: packet.timestamp, type: packet.type }));
  await decoder.flush(); decoder.close();
  const bytes = new Uint8Array(32 + packets.reduce((sum, packet) => sum + 12 + packet.bytes.length, 0)), header = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('DKIF')); header.setUint16(6, 32, true); bytes.set(new TextEncoder().encode('VP80'), 8);
  header.setUint16(12, 1280, true); header.setUint16(14, 720, true); header.setUint32(16, 30, true);
  header.setUint32(20, 1, true); header.setUint32(24, packets.length, true); let offset = 32;
  packets.forEach((packet, index) => { header.setUint32(offset, packet.bytes.length, true); header.setBigUint64(offset + 4, BigInt(index), true);
    bytes.set(packet.bytes, offset + 12); offset += packet.bytes.length + 12; });
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = URL.createObjectURL(new Blob([bytes], { type: 'video/x-ivf' }));
  let link = document.getElementById('fixture-download') as HTMLAnchorElement | null;
  if (!link) { link = document.createElement('a'); link.id = 'fixture-download'; link.textContent = '下载编码验证流'; document.getElementById('fixture-tools')!.append(link); }
  link.href = downloadUrl; link.download = 'camera-whiteboard.ivf';
  const receivedVideos = [...document.querySelectorAll('video')].filter(video => video.readyState >= 2 && video.videoWidth > 0).length;
  result.dataset.encoded = JSON.stringify({ encoded: packets.length, decoded, width: 1280, height: 720, receivedVideos });
  result.textContent = `编码/解码 ${packets.length}/${decoded} 帧 · 1280×720`;
}
const root = createRoot(document.getElementById('root')!);
document.getElementById('fixture-live')!.onclick = () => { void window.whiteboard!.setVisible(true).then(() => root.render(<Live />)); };
document.getElementById('fixture-replay')!.onclick = () => root.render(<Playback />);
document.getElementById('fixture-encode')!.onclick = () => { void encode().catch(error => { result.textContent = String(error); result.dataset.error = String(error); }); };
document.getElementById('fixture-sample')!.onclick = async () => {
  await window.whiteboard!.act(state.session, { kind: 'shape', shape: 'rectangle', id: crypto.randomUUID(), color: '#20242c', size: 4,
    x: 110, y: 240, width: 250, height: 160, text: '发现问题' });
  await window.whiteboard!.act(state.session, { kind: 'shape', shape: 'ellipse', id: crypto.randomUUID(), color: '#ffe28a', size: 4,
    x: 470, y: 240, width: 250, height: 160, text: '试出方法' });
  // Native IPC does not echo ink; remount reads the persisted journal after this synthetic input.
  root.render(<Playback />);
};
root.render(<Live />); publish();
import.meta.hot?.dispose(() => { root.unmount(); camera.close(); if (downloadUrl) URL.revokeObjectURL(downloadUrl); });
