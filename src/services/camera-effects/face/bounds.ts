import type { FaceGeometry } from './geometry';

/** Conservative support in top-left isotropic coordinates; pixels outside cannot change. */
export function faceEffectBounds(face: FaceGeometry): [number, number, number, number] {
  const horizontal = face.width * .52, vertical = face.height * .52;
  const rx = Math.hypot(face.axis.x * horizontal, face.axis.y * vertical);
  const ry = Math.hypot(face.axis.y * horizontal, face.axis.x * vertical);
  let left = face.center.x - rx, top = face.center.y - ry, right = face.center.x + rx, bottom = face.center.y + ry;
  const include = (x: number, y: number, radius = 0) => {
    left = Math.min(left, x - radius); top = Math.min(top, y - radius);
    right = Math.max(right, x + radius); bottom = Math.max(bottom, y + radius);
  };
  for (const warp of face.warps) include(warp.center.x + warp.dx, warp.center.y + warp.dy, warp.radius);
  for (const point of [...face.mouth, ...face.eyes.flat()]) include(point.x, point.y);
  const margin = .00001; // Keep floating-point boundary differences inside the full calculation.
  return [left - margin, top - margin, right + margin, bottom + margin];
}
