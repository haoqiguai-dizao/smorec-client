import { CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX } from '../../shared/camera-zoom';
import { DEFAULT_PRESENTER, parsePresenterSettings, type PresenterSettings } from '../../shared/presenter';
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BACKGROUNDS, DEFAULT_STYLE } from '../../shared/constants';
import { FILL_CANVAS_STYLE } from '../../shared/canvas-style';
import { isCameraShape } from '../../shared/camera-shapes';
import type { CameraLayoutKeyframe, CameraMode, CanvasStyle, Project, Rect } from '../../shared/types';

type CameraDefaults = Omit<CameraLayoutKeyframe, 't'>;
export interface DesktopPreferenceData {
  presenter?: PresenterSettings;
  style: CanvasStyle;
  audio: Project['audio'];
  camera: CameraDefaults;
  cameraMode: CameraMode;
  cameraShrinkOnZoom: boolean;
  exportDirectory: string;
  importDirectory: string;
  editorBounds?: Rect;
  editorMaximized: boolean;
  launcherBounds?: Rect;
  toolbarBounds?: Rect;
  toolbarArea?: Rect;
}
export type DesktopPreferencePatch = Partial<Omit<DesktopPreferenceData, 'style' | 'audio' | 'camera'>> & {
  style?: Partial<CanvasStyle>; audio?: Partial<Project['audio']>; camera?: Partial<CameraDefaults>;
};
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const finite = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
function rectangle(value: unknown): Rect | undefined {
  const r = object(value);
  return finite(r.x, -100000, 100000) && finite(r.y, -100000, 100000) && finite(r.width, 60, 16000) && finite(r.height, 60, 16000)
    ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } : undefined;
}
function defaults(): DesktopPreferenceData {
  return { style: { ...DEFAULT_STYLE }, audio: { system: 1, microphone: 1 },
    camera: { x: .85, y: .8, size: .22, shape: 'circle', mirror: true, visible: true },
    cameraMode: 'overlay', presenter: structuredClone(DEFAULT_PRESENTER), cameraShrinkOnZoom: false, exportDirectory: '', importDirectory: '', editorMaximized: false };
}
function merge(previous: DesktopPreferenceData, value: unknown): DesktopPreferenceData {
  const input = object(value), style = object(input.style), audio = object(input.audio), camera = object(input.camera);
  const next = structuredClone(previous);
  if (input.presenter !== undefined) {
    try { next.presenter = parsePresenterSettings(input.presenter); } catch { /* Ignore corrupt saved preferences. */ }
  }
  if (BACKGROUNDS.some(item => item.id === style.background)) next.style.background = style.background as string;
  if (['auto', '16:9', '9:16', '1:1'].includes(style.aspect as string)) next.style.aspect = style.aspect as CanvasStyle['aspect'];
  for (const [key, min, max] of [['padding', 0, 240], ['radius', 0, 120], ['shadow', 0, 100], ['cursorScale', .5, 5], ['smoothing', 0, 1]] as const) {
    if (finite(style[key], min, max)) next.style[key] = style[key];
  }
  for (const key of ['showCursor', 'clickHighlight'] as const) if (typeof style[key] === 'boolean') next.style[key] = style[key];
  for (const key of ['system', 'microphone'] as const) if (finite(audio[key], 0, 1)) next.audio[key] = audio[key];
  if (typeof camera.mirror === 'boolean') next.camera.mirror = camera.mirror;
  if (isCameraShape(camera.shape)) next.camera.shape = camera.shape;
  if (input.cameraMode === 'overlay' || input.cameraMode === 'presenter') next.cameraMode = input.cameraMode;
  if (finite(camera.zoom, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX)) next.camera.zoom = camera.zoom;
  if (finite(camera.size, .12, .42)) next.camera.size = camera.size;
  for (const key of ['x', 'y'] as const) if (finite(camera[key], 0, 1)) next.camera[key] = camera[key];
  for (const key of ['exportDirectory', 'importDirectory'] as const) {
    if (typeof input[key] === 'string' && input[key].length < 4096 && !input[key].includes('\0') && (input[key] === '' || path.isAbsolute(input[key]))) next[key] = input[key];
  }
  for (const key of ['editorBounds', 'launcherBounds', 'toolbarBounds', 'toolbarArea'] as const) {
    const bounds = rectangle(input[key]); if (bounds) next[key] = bounds;
  }
  if (typeof input.editorMaximized === 'boolean') next.editorMaximized = input.editorMaximized;
  if (typeof input.cameraShrinkOnZoom === 'boolean') next.cameraShrinkOnZoom = input.cameraShrinkOnZoom;
  return next;
}

/** Small local preferences; project files and their media remain authoritative. */
export class DesktopPreferences {
  private data?: DesktopPreferenceData;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private readonly directory: () => string) {}
  read(): DesktopPreferenceData {
    if (!this.data) {
      this.data = defaults();
      try {
        const saved = object(JSON.parse(readFileSync(path.join(this.directory(), 'preferences.json'), 'utf8')));
        if (saved.version === 1) {
          this.data = merge(this.data, saved);
          if (saved.canvasDefaultsVersion !== 2) {
            // Upgrade future-project defaults once; project manifests remain authoritative.
            Object.assign(this.data.style, FILL_CANVAS_STYLE);
            this.flush();
          }
        }
      } catch { /* First run or damaged optional preferences use defaults. */ }
    }
    return structuredClone(this.data);
  }
  update(patch: DesktopPreferencePatch): void {
    this.data = merge(this.read(), patch);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 150); this.timer.unref();
  }
  flush(): void {
    clearTimeout(this.timer); this.timer = undefined;
    if (!this.data) return;
    try {
      const directory = this.directory();
      mkdirSync(directory, { recursive: true });
      const temporary = path.join(directory, 'preferences.tmp.json');
      writeFileSync(temporary, JSON.stringify({ version: 1, canvasDefaultsVersion: 2, ...this.data }), 'utf8');
      renameSync(temporary, path.join(directory, 'preferences.json'));
    } catch { /* Preference failures must never prevent recording or saving a project. */ }
  }
  existingDirectory(key: 'exportDirectory' | 'importDirectory'): string | undefined {
    const directory = this.read()[key];
    try { return directory && statSync(directory).isDirectory() ? directory : undefined; }
    catch { return undefined; }
  }
}
