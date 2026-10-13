import { cameraShapeGeometry, cameraShapePreset, type CameraShape } from './camera-shapes';
import type { CompositionCamera, WebcamStyle } from './types';

export const COMPOSITION_CAMERA_MIN_SIZE = 0.08;
export const COMPOSITION_CAMERA_MAX_SIZE = 2;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function compositionCameraMaxSize(shape: CameraShape, width: number, height: number): number {
  const short = Math.min(width, height);
  return short > 0 ? Math.min(COMPOSITION_CAMERA_MAX_SIZE, width / short, height * cameraShapePreset(shape).aspect / short) : 1;
}

/** Same fitted shape and clipping rules as drawWebcam, with an editable top-left. */
export function compositionCameraRect(style: WebcamStyle, override: CompositionCamera | undefined, width: number, height: number, zoom = 1) {
  const shape = override?.shape ?? style.shape;
  const fixedSize = override?.size !== undefined;
  const shrink = !fixedSize && style.shrinkOnZoom ? 1 - clamp(zoom - 1, 0, 1) * 0.24 : 1;
  const size = fixedSize ? clamp(override.size!, COMPOSITION_CAMERA_MIN_SIZE, compositionCameraMaxSize(shape, width, height)) : style.size;
  const geometry = cameraShapeGeometry(shape, Math.min(width, height) * size * shrink, width, height);
  const gap = Math.min(width, height) * 0.035;
  const originalX = style.placement ? style.placement.x * width - geometry.width / 2
    : style.position.endsWith('right') ? width - gap - geometry.width : gap;
  const originalY = style.placement ? style.placement.y * height - geometry.height / 2
    : style.position.startsWith('bottom') ? height - gap - geometry.height : gap;
  return {
    x: clamp(override?.x === undefined ? originalX : override.x * width, 0, width - geometry.width),
    y: clamp(override?.y === undefined ? originalY : override.y * height, 0, height - geometry.height),
    ...geometry,
  };
}

/** The original recorded layout/effect tracks stay untouched. */
export function compositionCameraStyle(style: WebcamStyle, override: CompositionCamera | undefined, width: number, height: number, zoom = 1): WebcamStyle {
  const rect = compositionCameraRect(style, override, width, height, zoom);
  return { ...style, ...(override?.zoom === undefined ? {} : { zoom: override.zoom }), enabled: override?.visible ?? style.enabled, shape: override?.shape ?? style.shape,
    mirror: override?.mirror ?? style.mirror, size: rect.width / Math.min(width, height), shrinkOnZoom: false,
    placement: { x: (rect.x + rect.width / 2) / width, y: (rect.y + rect.height / 2) / height } };
}
