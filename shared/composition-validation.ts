import { CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX } from './camera-zoom';
import { BACKGROUNDS } from './constants';
import { isCameraShape } from './camera-shapes';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const id = (value: unknown) => typeof value === 'string' && value.trim().length > 0 && value.length <= 200;

function validCamera(camera: unknown): boolean {
  if (!record(camera)) return false;
  return Reflect.ownKeys(camera).every((key) => {
    switch (key) {
      case 'x': case 'y': return finite(camera[key], 0, 1);
      case 'zoom': return finite(camera.zoom, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX);
      case 'size': return finite(camera.size, 0.08, 2);
      case 'visible': case 'mirror': return typeof camera[key] === 'boolean';
      case 'shape': return isCameraShape(camera.shape);
      default: return false;
    }
  });
}

/** Draft validation is independent of the main process's authoritative asset checks. */
export function validCompositionDraft(value: unknown): boolean {
  if (!record(value) || !id(value.id) || Reflect.ownKeys(value).some((key) =>
    typeof key !== 'string' || !['id', 'start', 'end', 'camera', 'screen', 'background'].includes(key))) return false;
  if (value.screen !== 'recording' && value.screen !== 'hidden' && value.screen !== 'background') return false;
  if (value.camera !== undefined && !validCamera(value.camera)) return false;
  if (value.background !== undefined && (!id(value.background) || (typeof value.background === 'string'
    && !BACKGROUNDS.some((item) => item.id === value.background)
    && !/^asset:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.background)))) return false;
  return value.screen !== 'background' || typeof value.background === 'string';
}
