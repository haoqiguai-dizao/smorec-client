import type { CameraEffects } from '../../../../shared/types';
import { beautyValue as value } from '../../../../shared/beauty';

export interface Point { x: number; y: number }
export interface Warp { center: Point; radius: number; zoom: number; dx: number; dy: number }
export interface FaceGeometry {
  aspect: number; warps: Warp[]; mouth: Point[]; eyes: Point[][];
  center: Point; axis: Point; width: number; height: number; mouthOpen: number;
}
export const MAX_WARPS = 16;
export const MOUTH = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95];
const EYES = [[33, 160, 158, 133, 153, 145, 144, 163], [362, 385, 387, 263, 373, 374, 380, 381]];
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const middle = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Coordinates are top-left, isotropic (x multiplied by image aspect). No mirrored-input assumptions. */
export function faceGeometry(points: Point[], aspect: number, effects: CameraEffects): FaceGeometry | undefined {
  if (points.length < 468 || !Number.isFinite(aspect) || aspect <= 0
    || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return;
  const p = (index: number) => ({ x: points[index].x * aspect, y: points[index].y });
  const left = p(234), right = p(454), top = p(10), bottom = p(152);
  const width = distance(left, right), height = distance(top, bottom);
  if (width < 0.035 || height < 0.06 || width > aspect * 1.2 || height > 1.5) return;
  const axis = { x: (right.x - left.x) / width, y: (right.y - left.y) / width };
  const vertical = { x: -axis.y, y: axis.x }, center = middle(top, bottom);
  const noseOffset = Math.abs((p(1).x - middle(left, right).x) * axis.x + (p(1).y - middle(left, right).y) * axis.y) / width;
  // Fade geometry on large yaw; a profile has too little support for symmetric reshaping.
  const pose = Math.max(0, Math.min(1, (0.3 - noseOffset) / 0.16));
  const warps: Warp[] = [];
  const warp = (center: Point, radius: number, zoom = 0, dx = 0, dy = 0) => {
    if (zoom || dx || dy) warps.push({ center, radius, zoom: zoom * pose, dx: dx * pose, dy: dy * pose });
  };
  const translate = (point: Point, radius: number, amount: number, direction: Point) =>
    warp(point, radius, 0, amount * direction.x, amount * direction.y);
  warp(center, height * 0.72, -value(effects.faceSize) * 0.07);
  for (const [index, sign] of [[132, 1], [361, -1]] as const) translate(p(index), width * 0.32, width * 0.045 * value(effects.faceSlim) * sign, axis);
  for (const [index, sign] of [[172, 1], [397, -1]] as const) translate(p(index), width * 0.28, width * 0.04 * value(effects.jaw) * sign, axis);
  translate(bottom, width * 0.3, height * 0.035 * value(effects.chin), vertical);
  for (const [index, sign] of [[98, 1], [327, -1]] as const) translate(p(index), width * 0.16, width * 0.018 * value(effects.noseSlim) * sign, axis);
  const eyes = EYES.map(indices => indices.map(p));
  for (let i = 0; i < 2; i++) {
    const eye = eyes[i], eyeCenter = middle(eye[0], eye[3]), eyeWidth = distance(eye[0], eye[3]);
    const opening = distance(p(i ? 386 : 159), p(i ? 374 : 145)) / Math.max(eyeWidth, 0.001);
    warp(eyeCenter, eyeWidth * 0.95, value(effects.eyeEnlarge) * 0.2 * Math.min(1, opening / 0.18));
    translate(eyeCenter, eyeWidth * 1.15, value(effects.eyeDistance) * width * 0.018 * (i ? 1 : -1), axis);
  }
  const mouth = MOUTH.map(p), mouthWidth = distance(p(78), p(308));
  warp(middle(p(13), p(14)), mouthWidth * 0.85, value(effects.mouthSize) * 0.12);
  return { aspect, warps, mouth, eyes, center, axis, width, height,
    mouthOpen: Math.max(0, Math.min(1, (distance(p(13), p(14)) / Math.max(mouthWidth, 0.001) - 0.035) / 0.065)) };
}

/** Inverse map with compact support; the transform is identity at every support boundary. */
export function warpPoint(x: number, y: number, warps: Warp[], result: Float64Array): void {
  for (const warp of warps) {
    const dx = x - warp.center.x - warp.dx, dy = y - warp.center.y - warp.dy;
    const weight = Math.max(0, 1 - (dx * dx + dy * dy) / (warp.radius * warp.radius)) ** 2;
    x -= (warp.dx + dx * warp.zoom) * weight;
    y -= (warp.dy + dy * warp.zoom) * weight;
  }
  result[0] = x; result[1] = y;
}

/** Signed polygon distance, feathered only inside the anatomical boundary. */
export function polygonMask(x: number, y: number, points: Point[], feather: number): number {
  let inside = false, closest = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j], dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / Math.max(1e-10, dx * dx + dy * dy)));
    closest = Math.min(closest, Math.hypot(x - a.x - t * dx, y - a.y - t * dy));
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  const t = Math.max(0, Math.min(1, closest / Math.max(feather, 1e-6)));
  return inside ? t * t * (3 - 2 * t) : 0;
}
