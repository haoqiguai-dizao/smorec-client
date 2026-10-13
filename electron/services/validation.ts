import { CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX } from '../../shared/camera-zoom';
import { BEAUTY_FIELDS, SIGNED_BEAUTY_FIELDS } from '../../shared/beauty';
import { BACKGROUNDS } from '../../shared/constants';
import { CAMERA_SHAPES } from '../../shared/camera-shapes';
import { normalizeMicrophoneEffects } from '../../shared/microphone-effects';
import { RECORDING_RESOLUTIONS } from '../../shared/recording';
import { MAX_EXPORT_DIMENSION, isSupportedExportSize } from '../../shared/canvas';
import type { CameraEffects, ExportSettings, Project, RecordingOptions } from '../../shared/types';
import { parseInputActivity } from './input-activity';
import { assertCompositionBackgrounds, parseCompositions } from './composition-validation';
import { parseBackgroundAssets } from './background-asset-validation';
import { parseBoardRecording } from '../../shared/whiteboard/validation';
import { parseDemoRanges } from '../../shared/demo';
import { parseExcludedApplications } from './live/validation';

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('数据格式不正确');
  return value as Record<string, unknown>;
}
export function number(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error('数值超出允许范围');
  }
  return value;
}
export function string(value: unknown, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('文字格式不正确');
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('开关格式不正确');
  return value;
}
function choice<T extends string | number>(value: unknown, choices: readonly T[]): T {
  if (!choices.includes(value as T)) throw new Error('选项不受支持');
  return value as T;
}
function array<T>(value: unknown, max: number, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > max) throw new Error('列表格式不正确或过大');
  return value.map(parse);
}
export function projectId(value: unknown): string {
  const id = string(value, 36);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) {
    throw new Error('工程标识无效');
  }
  return id;
}
export function parseCameraEffects(value: unknown): CameraEffects {
  const effects = object(value);
  const result: CameraEffects = { enabled: boolean(effects.enabled), smoothing: number(effects.smoothing, 0, 1),
    brightness: number(effects.brightness, 0, 1), filter: choice(effects.filter, ['natural', 'warm', 'cool', 'mono']),
    intensity: number(effects.intensity, 0, 1) };
  for (const key of BEAUTY_FIELDS) if (effects[key] !== undefined) result[key] = number(effects[key], SIGNED_BEAUTY_FIELDS.includes(key) ? -1 : 0, 1);
  return result;
}
export function parseCameraEffectsPatch(value: unknown): Partial<CameraEffects> {
  const effects = object(value), keys = Reflect.ownKeys(effects);
  if (!keys.length) throw new Error('摄像头效果修改不能为空');
  const patch: Partial<CameraEffects> = {};
  for (const key of keys) {
    switch (key) {
      case 'enabled': patch.enabled = boolean(effects.enabled); break;
      case 'filter': patch.filter = choice(effects.filter, ['natural', 'warm', 'cool', 'mono'] as const); break;
      case 'smoothing': case 'brightness': case 'intensity': patch[key] = number(effects[key], 0, 1); break;
      default: {
        const field = BEAUTY_FIELDS.find(field => field === key);
        if (!field) throw new Error('摄像头效果修改包含未知字段');
        patch[field] = number(effects[field], SIGNED_BEAUTY_FIELDS.includes(field) ? -1 : 0, 1);
      }
    }
  }
  return patch;
}
export function recordingOptions(value: unknown): RecordingOptions {
  const data = object(value);
  const result: RecordingOptions = {
    sourceId: string(data.sourceId), systemAudio: boolean(data.systemAudio),
    microphone: boolean(data.microphone), fps: choice(data.fps, [30, 60]),
    resolution: data.resolution === undefined ? 'native' : choice(data.resolution, RECORDING_RESOLUTIONS),
  };
  if (data.crop) {
    const crop = object(data.crop);
    result.crop = { x: number(crop.x, 0, 32000), y: number(crop.y, 0, 32000),
      width: number(crop.width, 32, 16000), height: number(crop.height, 32, 16000) };
  }
  if (data.excludedApplications !== undefined) result.excludedApplications = parseExcludedApplications(data.excludedApplications);
  if (data.inputRecording !== undefined) result.inputRecording = boolean(data.inputRecording);
  if (data.cameraSessionId !== undefined) result.cameraSessionId = projectId(data.cameraSessionId);
  if (data.cameraEffects !== undefined) result.cameraEffects = parseCameraEffects(data.cameraEffects);
  if (data.microphoneEffects !== undefined) result.microphoneEffects = normalizeMicrophoneEffects(object(data.microphoneEffects));
  if (data.microphoneDeviceId !== undefined && data.microphoneDeviceId !== '') result.microphoneDeviceId = string(data.microphoneDeviceId, 1024);
  return result;
}
export function parseProject(value: unknown): Project {
  const p = object(value);
  const duration = number(p.duration, 0.01, 24 * 3600);
  const style = object(p.style);
  const audio = object(p.audio);
  const media = object(p.media);
  const createdAt = string(p.createdAt, 50);
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error('工程创建时间无效');
  const backgrounds = p.backgrounds === undefined ? undefined : parseBackgroundAssets(p.backgrounds);
  const project: Project = {
    id: projectId(p.id), name: string(p.name, 120), createdAt, duration,
    width: number(p.width, 2, 16384), height: number(p.height, 2, 16384),
    fps: choice(p.fps, [30, 60]),
    media: { screen: string(media.screen, 4096) },
    cursor: array(p.cursor, 5_184_000, (item) => {
      const v = object(item);
      return { t: number(v.t, 0, duration + 5), x: number(v.x, -10, 10), y: number(v.y, -10, 10),
        visible: boolean(v.visible), ...(v.click === undefined ? {} : { click: boolean(v.click) }),
        ...(v.shape === undefined ? {} : { shape: choice(v.shape, ['arrow', 'hand', 'ibeam'] as const) }),
        ...(v.primaryDown === undefined ? {} : { primaryDown: boolean(v.primaryDown) }) };
    }),
    clips: array(p.clips, 500, (item) => {
      const v = object(item);
      const start = number(v.start, 0, duration);
      const end = number(v.end, 0, duration);
      if (end <= start) throw new Error('片段终点必须晚于起点');
      return { id: string(v.id), start, end };
    }),
    zooms: array(p.zooms, 5000, (item) => {
      const v = object(item);
      const start = number(v.start, 0, duration);
      const end = number(v.end, start, duration);
      return { id: string(v.id), start, end, x: number(v.x, 0, 1), y: number(v.y, 0, 1), scale: number(v.scale, 1, 4),
        ...(v.exitToFullView === undefined ? {} : { exitToFullView: boolean(v.exitToFullView) }) };
    }),
    style: {
      background: choice(style.background, [...BACKGROUNDS.map((b) => b.id), ...(backgrounds?.map(asset => `asset:${asset.id}`) ?? [])]),
      padding: number(style.padding, 0, 240), radius: number(style.radius, 0, 120),
      shadow: number(style.shadow, 0, 100), aspect: choice(style.aspect, ['auto', '16:9', '9:16', '1:1']),
      cursorScale: number(style.cursorScale, 0.5, 5), smoothing: number(style.smoothing, 0, 1),
      showCursor: boolean(style.showCursor), clickHighlight: boolean(style.clickHighlight),
    },
    audio: { system: number(audio.system, 0, 1), microphone: number(audio.microphone, 0, 1),
      ...(audio.microphoneEffects === undefined ? {} : { microphoneEffects: normalizeMicrophoneEffects(object(audio.microphoneEffects)) }) },
  };
  if (p.inputActivity !== undefined) project.inputActivity = parseInputActivity(p.inputActivity, duration);
  if (p.demoCapture !== undefined) project.demoCapture = parseDemoRanges(p.demoCapture, duration);
  if (p.whiteboard !== undefined) project.whiteboard = parseBoardRecording(p.whiteboard, duration);
  if (p.compositions !== undefined) project.compositions = parseCompositions(p.compositions, duration, project.fps);
  if (backgrounds !== undefined) project.backgrounds = backgrounds;
  assertCompositionBackgrounds(project.compositions ?? [], new Set(project.backgrounds?.map(asset => asset.id)));
  for (const key of ['systemAudio', 'microphone', 'camera', 'whiteboard'] as const) {
    if (media[key] !== undefined) project.media[key] = string(media[key], 4096);
  }
  const needsBoardVideo = project.whiteboard?.interfaceCapture !== 'screen' && project.whiteboard?.events.some(event => event.action.kind === 'layout'
    && event.action.visible && event.action.presentation === 'interface');
  if (needsBoardVideo && (!project.media.whiteboard || !project.whiteboard?.video)) throw new Error('完整白板缺少界面视频或同步记录');
  if (Boolean(project.media.whiteboard) !== Boolean(project.whiteboard?.video)) throw new Error('白板视频与同步记录不匹配');
  if (p.camera !== undefined) {
    const camera = object(p.camera);
    project.camera = { offset: number(camera.offset, -30, 120), enabled: boolean(camera.enabled),
      position: choice(camera.position, ['bottom-right', 'bottom-left', 'top-right', 'top-left']),
      size: number(camera.size, 0.12, 0.42), mirror: boolean(camera.mirror),
      shape: choice(camera.shape, CAMERA_SHAPES), shrinkOnZoom: boolean(camera.shrinkOnZoom) };
    if (camera.presenterCrop !== undefined) {
      const point = object(camera.presenterCrop);
      project.camera.presenterCrop = { x: number(point.x, 0, 1), y: number(point.y, 0, 1) };
    }
    if (camera.zoom !== undefined) project.camera.zoom = number(camera.zoom, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX);
    if (camera.placement !== undefined) {
      const point = object(camera.placement);
      project.camera.placement = { x: number(point.x, 0, 1), y: number(point.y, 0, 1) };
    }
    if (camera.useRecordedLayout !== undefined) project.camera.useRecordedLayout = boolean(camera.useRecordedLayout);
    if (camera.useRecordedMirror !== undefined) project.camera.useRecordedMirror = boolean(camera.useRecordedMirror);
    if (camera.mode !== undefined) project.camera.mode = choice(camera.mode, ['overlay', 'presenter'] as const);
    if (camera.useRecordedMode !== undefined) project.camera.useRecordedMode = boolean(camera.useRecordedMode);
    if (camera.modeKeyframes !== undefined) {
      project.camera.modeKeyframes = array(camera.modeKeyframes, 1_728_001, item => {
        const frame = object(item);
        return { t: number(frame.t, 0, duration), mode: choice(frame.mode, ['overlay', 'presenter'] as const) };
      });
      if (project.camera.modeKeyframes.some((frame, index, frames) => index > 0 && frame.t < frames[index - 1].t)) {
        throw new Error('摄像头模式时间必须递增');
      }
    }
    if (camera.effects !== undefined) project.camera.effects = parseCameraEffects(camera.effects);
    if (camera.useRecordedEffects !== undefined) project.camera.useRecordedEffects = boolean(camera.useRecordedEffects);
    if (camera.effectKeyframes !== undefined) {
      project.camera.effectKeyframes = array(camera.effectKeyframes, 1_728_001, item => {
        const frame = object(item);
        return { t: number(frame.t, 0, duration), effects: parseCameraEffects(frame.effects) };
      });
      if (project.camera.effectKeyframes.some((frame, index, frames) => index > 0 && frame.t < frames[index - 1].t)) {
        throw new Error('摄像头效果时间必须递增');
      }
    }
    if (camera.keyframes !== undefined) {
      project.camera.keyframes = array(camera.keyframes, 1_728_001, item => {
        const frame = object(item);
        return { t: number(frame.t, 0, duration + 0.1), x: number(frame.x, 0, 1), y: number(frame.y, 0, 1),
          size: number(frame.size, 0.12, 0.42), shape: choice(frame.shape, CAMERA_SHAPES),
          mirror: boolean(frame.mirror), visible: boolean(frame.visible),
          ...(frame.zoom === undefined ? {} : { zoom: number(frame.zoom, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX) }) };
      });
      if (project.camera.keyframes.some((frame, index, frames) => index > 0 && frame.t < frames[index - 1].t)) {
        throw new Error('摄像头布局时间必须递增');
      }
    }
    // A failed camera attachment can retain disabled presenter metadata to mask the screen.
    // Missing media remains invalid for ordinary layouts and for an enabled camera.
    const hasPresenter = project.camera.mode === 'presenter' || project.camera.modeKeyframes?.some(frame => frame.mode === 'presenter');
    if (!project.media.camera && (project.camera.enabled || !hasPresenter)) throw new Error('摄像头布局缺少对应媒体');
  }
  if (!project.clips.length) throw new Error('工程至少需要一个有效片段');
  if (project.cursor.some((sample, i) => i > 0 && sample.t < project.cursor[i - 1].t)) {
    throw new Error('光标轨道时间必须递增');
  }
  return project;
}
export function exportSettings(value: unknown): ExportSettings {
  const s = object(value);
  const width = number(s.width, 2, MAX_EXPORT_DIMENSION);
  const height = number(s.height, 2, MAX_EXPORT_DIMENSION);
  const frames = number(s.frames, 1, 5_184_000);
  if (width % 2 || height % 2 || !Number.isInteger(frames)) throw new Error('导出尺寸必须为偶数，帧数必须为整数');
  if (!isSupportedExportSize({ width, height })) throw new Error('导出尺寸超过支持的像素上限');
  return { width, height, frames, fps: choice(s.fps, [30, 60]), ...(s.codec === undefined ? {} : { codec: choice(s.codec, ['vp8', 'h264', 'hevc'] as const) }) };
}
