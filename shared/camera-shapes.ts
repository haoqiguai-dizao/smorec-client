/** Width-based size keeps existing circle/rounded projects visually compatible. */
export const CAMERA_SHAPES = ['circle', 'rounded', 'square', 'portrait', 'landscape', 'capsule'] as const;
export type CameraShape = typeof CAMERA_SHAPES[number];
export const CAMERA_SHAPE_PRESETS = [
  { id: 'circle', label: '圆形', aspect: 1, radius: .5 },
  { id: 'rounded', label: '圆角', aspect: 1.25, radius: .16 },
  { id: 'square', label: '方形', aspect: 1, radius: .06 },
  { id: 'portrait', label: '竖版', aspect: 3 / 4, radius: .14 },
  { id: 'landscape', label: '宽屏', aspect: 16 / 9, radius: .1 },
  // Retain the saved ID so existing selections adopt the new large-corner square.
  { id: 'capsule', label: '大圆角', aspect: 1, radius: .32 },
] as const;
export function isCameraShape(value: unknown): value is CameraShape {
  return typeof value === 'string' && CAMERA_SHAPES.some(shape => shape === value);
}
export function cameraShapePreset(shape: CameraShape) {
  return CAMERA_SHAPE_PRESETS.find(preset => preset.id === shape) ?? CAMERA_SHAPE_PRESETS[0];
}
/** CSS, SVG and Canvas consume the same circular-corner geometry. Fits preserve the aspect ratio. */
export function cameraShapeGeometry(shape: CameraShape, requestedWidth: number, maxWidth = Infinity, maxHeight = Infinity) {
  const preset = cameraShapePreset(shape);
  const wanted = Number.isFinite(requestedWidth) ? Math.max(0, requestedWidth) : 0;
  const width = Math.min(wanted, Math.max(0, maxWidth), Math.max(0, maxHeight) * preset.aspect);
  const height = width / preset.aspect;
  return { width, height, radius: Math.min(width * preset.radius, width / 2, height / 2) };
}
export function nextCameraShape(shape: CameraShape): CameraShape {
  return CAMERA_SHAPES[(CAMERA_SHAPES.indexOf(shape) + 1) % CAMERA_SHAPES.length];
}
