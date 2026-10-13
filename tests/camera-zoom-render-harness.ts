import { DEFAULT_STYLE } from '../shared/constants';
import type { LiveRecordingState, Project } from '../shared/types';
import { renderFrame } from '../src/services/compositor';
import { LiveComposition } from '../src/services/live/composition';

/** Deterministic center target, no media devices: blue at 1x becomes red at 2x. */
export function cameraZoomPixels() {
  const camera = document.createElement('canvas'), screen = document.createElement('canvas'), output = document.createElement('canvas');
  for (const canvas of [camera, screen, output]) { canvas.width = 200; canvas.height = 200; }
  const paint = camera.getContext('2d')!, context = output.getContext('2d')!;
  paint.fillStyle = '#0000ff'; paint.fillRect(0, 0, 200, 200);
  paint.fillStyle = '#ff0000'; paint.fillRect(80, 80, 40, 40);
  Object.defineProperty(camera, 'readyState', { value: 4 });
  const project: Project = { id: 'fixture', name: 'zoom pixels', createdAt: '', duration: 6, width: 200, height: 200, fps: 30,
    media: { screen: '' }, clips: [{ id: 'clip', start: 0, end: 6 }], cursor: [], zooms: [], style: { ...DEFAULT_STYLE }, audio: { system: 0, microphone: 0 },
    camera: { offset: 0, enabled: true, position: 'bottom-right', placement: { x: .5, y: .5 }, size: .4, mirror: false, shape: 'rounded', shrinkOnZoom: false },
    compositions: [{ id: 'closeup', start: 2, end: 5, screen: 'recording', camera: { zoom: 2 } }] };
  const samples: { mode: string; time: number; rgb: number[] }[] = [];
  for (const mode of ['source', 'preview'] as const) {
    for (const time of [1.99, 2, 4.99, 5]) {
      renderFrame(context, screen, project, time, 200, 200, camera, mode);
      samples.push({ mode, time, rgb: [...context.getImageData(111, 100, 1, 1).data].slice(0, 3) });
    }
  }
  const presenter = [1, 2].map(zoom => {
    renderFrame(context, screen, { ...project, compositions: [], camera: { ...project.camera!, mode: 'presenter', zoom } }, 0, 200, 200, camera);
    return [...context.getImageData(130, 100, 1, 1).data].slice(0, 3);
  });
  const state: LiveRecordingState = { status: 'recording', cameraAvailable: true, cameraVisible: true, cameraShape: 'rounded', cameraSize: .4, cameraMirror: false,
    microphoneEnabled: false, microphoneMuted: false, microphoneName: '', systemAudioEnabled: false, systemAudioMuted: false };
  const compositor = new LiveComposition({ id: 'live-fixture', width: 200, height: 200, fps: 30, style: DEFAULT_STYLE });
  const live = [1, 2].map(zoom => {
    const bytes = new Uint8Array(compositor.render({ width: 200, height: 200, time: 0, pixels: new Uint8Array(200 * 200 * 4),
      input: [], camera: { ...state, cameraZoom: zoom }, placement: { x: .5, y: .5 }, shrinkOnZoom: false }, camera as unknown as HTMLVideoElement));
    const index = (100 * 200 + 111) * 4;
    return [bytes[index + 2], bytes[index + 1], bytes[index]];
  });
  compositor.dispose();
  return { samples, presenter, live };
}
