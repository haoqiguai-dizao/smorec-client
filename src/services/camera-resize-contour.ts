import { cameraShapeGeometry, type CameraShape } from '../../shared/camera-shapes';
import type { CameraResizeEdge } from './camera-resize';

/** Intersect a ray with the same rounded rectangle used by the camera renderer. */
function boundary(width: number, height: number, radius: number, angle: number) {
  const dx = Math.cos(angle), dy = Math.sin(angle), ax = Math.abs(dx), ay = Math.abs(dy);
  const hw = width / 2, hh = height / 2;
  let distance = Math.min(hw / (ax || 1e-10), hh / (ay || 1e-10));
  if (radius && distance * ax > hw - radius && distance * ay > hh - radius) {
    const cx = hw - radius, cy = hh - radius, dot = ax * cx + ay * cy;
    distance = dot + Math.sqrt(Math.max(0, dot * dot - cx * cx - cy * cy + radius * radius));
  }
  return { x: hw + dx * distance, y: hh + dy * distance };
}
const edges: { edge: CameraResizeEdge; label: string }[] = [
  { edge: 'n', label: '上边缘' }, { edge: 'ne', label: '右上角' }, { edge: 'e', label: '右边缘' }, { edge: 'se', label: '右下角' },
  { edge: 's', label: '下边缘' }, { edge: 'sw', label: '左下角' }, { edge: 'w', label: '左边缘' }, { edge: 'nw', label: '左上角' },
];
export function cameraResizeContour(shape: CameraShape, requestedWidth = 100) {
  const { width, height, radius } = cameraShapeGeometry(shape, requestedWidth);
  return { width, height, segments: edges.map((entry, index) => {
    const angle = -Math.PI / 2 + index * Math.PI / 4;
    const points = Array.from({ length: 17 }, (_, step) => boundary(width, height, radius, angle - Math.PI / 8 + step * Math.PI / 64));
    const x = Math.min(...points.map(p => p.x)) - 7, y = Math.min(...points.map(p => p.y)) - 7;
    const bounds = { x, y, width: Math.max(...points.map(p => p.x)) + 7 - x, height: Math.max(...points.map(p => p.y)) + 7 - y };
    return { ...entry, bounds, point: boundary(width, height, radius, angle),
      path: points.map((point, i) => `${i ? 'L' : 'M'}${point.x.toFixed(4)},${point.y.toFixed(4)}`).join(' ') };
  }) };
}
