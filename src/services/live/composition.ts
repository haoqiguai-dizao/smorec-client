import type { LiveConfiguration, LiveFrame } from '../../../shared/live-types';
import type { CursorSample, Project } from '../../../shared/types';
import { LiveZoom } from '../../../shared/live-zoom';
import { renderFrame } from '../compositor';
import { disposeWebcamEffects } from '../webcam-compositor';
import { disposeCompositionDecoration } from '../compositor-decoration';
import { LiveBoardPlayback } from './whiteboard';
import { prepareBoardImages, releaseBoardImages } from '../whiteboard-images';

function swapRedBlue(bytes: Uint8ClampedArray): void {
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  for (let i = 0; i < words.length; i++) {
    const value = words[i];
    words[i] = (value & 0xff00ff00) | ((value & 0xff) << 16) | ((value >>> 16) & 0xff);
  }
}

/** Uses the editor/export compositor with a causal live camera transform. */
export class LiveComposition {
  readonly zoom = new LiveZoom();
  readonly canvas = document.createElement('canvas');
  private source = document.createElement('canvas');
  private context: CanvasRenderingContext2D;
  private sourceContext: CanvasRenderingContext2D;
  private bitmap?: ImageData;
  private cursor: CursorSample[] = [];
  private board = new LiveBoardPlayback();
  constructor(private config: LiveConfiguration) {
    this.canvas.width = config.width; this.canvas.height = config.height;
    this.context = this.canvas.getContext('2d', { willReadFrequently: true })!;
    this.sourceContext = this.source.getContext('2d')!;
  }
  render(frame: LiveFrame, webcam?: HTMLVideoElement): ArrayBuffer {
    if (this.board.ingest(frame.whiteboard)) {
      void prepareBoardImages(this.board.session, this.board.recording).catch(error => console.warn('直播白板图片读取失败', error));
    }
    if (!this.bitmap || this.bitmap.width !== frame.width || this.bitmap.height !== frame.height) {
      this.source.width = frame.width; this.source.height = frame.height;
      this.bitmap = this.sourceContext.createImageData(frame.width, frame.height);
    }
    this.bitmap.data.set(frame.pixels); swapRedBlue(this.bitmap.data);
    this.sourceContext.putImageData(this.bitmap, 0, 0);
    this.zoom.ingest(frame.input);
    this.cursor.push(...frame.input.flatMap(event => event.cursor ? [event.cursor] : []));
    this.cursor.sort((a, b) => a.t - b.t);
    // Keep the last stationary pointer as well as recent click highlights.
    const last = this.cursor.at(-1);
    this.cursor = this.cursor.filter(sample => sample.t >= frame.time - .6).slice(-128);
    if (!this.cursor.length && last) this.cursor.push(last);
    const camera = frame.camera;
    const project: Project = {
      id: this.board.session || this.config.id, name: '直播', createdAt: '', duration: frame.time + 1,
      width: frame.width, height: frame.height, fps: 30, media: { screen: '' },
      clips: [], zooms: [], cursor: this.cursor, style: this.config.style,
      audio: { system: 0, microphone: 0 },
      whiteboard: this.board.recording,
      ...(frame.demoVisible ? { demoCapture: [{ start: 0, end: frame.time + 1,
        ...(frame.demoCameraIndependent ? { camera: 'independent' as const } : {}) }] } : {}),
      camera: { offset: 0, enabled: camera.cameraAvailable && camera.cameraVisible,
        mode: camera.cameraAvailable && camera.cameraVisible ? camera.cameraMode : 'overlay', position: 'bottom-right', placement: frame.placement,
        zoom: camera.cameraZoom, size: camera.cameraSize, mirror: camera.cameraMirror, shape: camera.cameraShape,
        shrinkOnZoom: frame.shrinkOnZoom, effects: camera.cameraEffects },
    };
    renderFrame(this.context, this.source, project, frame.time, this.config.width, this.config.height,
      webcam?.readyState && webcam.readyState >= 2 ? webcam : undefined, 'preview', undefined, this.zoom.at(frame.time));
    const output = this.context.getImageData(0, 0, this.config.width, this.config.height);
    swapRedBlue(output.data);
    return output.data.buffer as ArrayBuffer;
  }
  dispose(): void {
    releaseBoardImages(this.board.session);
    disposeWebcamEffects(this.context); disposeCompositionDecoration(this.context);
    this.canvas.width = 0; this.source.width = 0;
  }
}
