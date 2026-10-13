import { CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX } from '../../shared/camera-zoom';
import { BACKGROUNDS } from '../../shared/constants';
import { CAMERA_SHAPES } from '../../shared/camera-shapes';
import type { CompositionCamera, CompositionSegment } from '../../shared/types';
import { number, object, projectId, string } from './validation';

function flag(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('局部镜头开关格式无效');
  return value;
}

function parseCamera(value: unknown): CompositionCamera {
  const camera = object(value);
  const result: CompositionCamera = {};
  for (const key of Reflect.ownKeys(camera)) {
    switch (key) {
      case 'x': case 'y': result[key] = number(camera[key], 0, 1); break;
      case 'zoom': result.zoom = number(camera.zoom, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX); break;
      case 'size': result.size = number(camera.size, 0.08, 2); break;
      case 'visible': case 'mirror': result[key] = flag(camera[key]); break;
      case 'shape':
        if (!CAMERA_SHAPES.includes(camera.shape as typeof CAMERA_SHAPES[number])) throw new Error('局部镜头形状无效');
        result.shape = camera.shape as typeof CAMERA_SHAPES[number];
        break;
      default: throw new Error('局部镜头包含未知摄像头设置');
    }
  }
  return result;
}

export function parseCompositions(value: unknown, duration: number, fps: number): CompositionSegment[] {
  if (!Array.isArray(value) || value.length > 5000) throw new Error('局部镜头列表无效或过大');
  const ids = new Set<string>();
  let previousEnd = 0;
  return value.map(item => {
    const segment = object(item);
    if (Reflect.ownKeys(segment).some(key => !['id', 'start', 'end', 'camera', 'screen', 'background'].includes(String(key)))) {
      throw new Error('局部镜头包含未知设置');
    }
    const id = string(segment.id, 200);
    if (ids.has(id)) throw new Error('局部镜头标识重复');
    ids.add(id);
    const start = number(segment.start, 0, duration), end = number(segment.end, 0, duration);
    if (end - start < 1 / fps - 1e-8 || start < previousEnd - 1e-8) throw new Error('局部镜头至少保留一帧，且时间不能重叠');
    previousEnd = end;
    if (segment.screen !== 'recording' && segment.screen !== 'hidden' && segment.screen !== 'background') throw new Error('桌面画面模式无效');
    const result: CompositionSegment = { id, start, end, screen: segment.screen };
    if (segment.camera !== undefined) result.camera = parseCamera(segment.camera);
    if (segment.background !== undefined) {
      const background = string(segment.background, 200);
      if (!BACKGROUNDS.some(item => item.id === background)) {
        if (!background.startsWith('asset:')) throw new Error('替换背景无效');
        projectId(background.slice(6));
      }
      result.background = background;
    }
    if (result.screen === 'background' && !result.background) throw new Error('请选择替换背景');
    return result;
  });
}

export function assertCompositionBackgrounds(segments: CompositionSegment[], ids: ReadonlySet<string>): void {
  for (const segment of segments) {
    if (segment.background?.startsWith('asset:') && !ids.has(segment.background.slice(6))) {
      throw new Error('局部镜头引用的背景图片不存在');
    }
  }
}
