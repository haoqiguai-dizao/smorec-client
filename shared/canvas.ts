import type { Project } from './types';

export interface CanvasSize { width: number; height: number }
export interface PreviewViewport extends CanvasSize { density: number }

export const MAX_EXPORT_DIMENSION = 8192;
export const MAX_EXPORT_PIXELS = 7680 * 4320;
export const MAX_PREVIEW_DIMENSION = 2560;
export const MAX_PREVIEW_PIXELS = 2560 * 1440;

const even = (value: number) => Math.max(2, Math.floor(value / 2) * 2);
const validSize = ({ width, height }: CanvasSize) =>
  Number.isFinite(width) && Number.isFinite(height) && width >= 2 && height >= 2;

/** Original media sets the resolution tier; changing orientation never enlarges that tier. */
export function getExportCanvasSize(project: Pick<Project, 'width' | 'height' | 'style'>): CanvasSize {
  if (!validSize(project)) throw new Error('原始视频尺寸无效');
  const long = Math.max(project.width, project.height), short = Math.min(project.width, project.height);
  if (project.style.aspect === 'auto') return { width: even(project.width), height: even(project.height) };
  if (project.style.aspect === '1:1') return { width: even(short), height: even(short) };
  const landscapeWidth = Math.min(long, short * 16 / 9);
  const size = { width: even(landscapeWidth), height: even(landscapeWidth * 9 / 16) };
  return project.style.aspect === '9:16' ? { width: size.height, height: size.width } : size;
}

/** Shared renderer/main-process ceiling; support must also be checked with the actual encoder. */
export function isSupportedExportSize(size: CanvasSize): boolean {
  return validSize(size) && Number.isInteger(size.width) && Number.isInteger(size.height)
    && size.width % 2 === 0 && size.height % 2 === 0
    && Math.max(size.width, size.height) <= MAX_EXPORT_DIMENSION
    && size.width * size.height <= MAX_EXPORT_PIXELS;
}

/** Bitmap demand is independent from CSS layout and cannot force the export to a lower resolution. */
export function getPreviewCanvasSize(output: CanvasSize, viewport: PreviewViewport): CanvasSize | null {
  if (!validSize(output) || !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height)
    || viewport.width <= 0 || viewport.height <= 0) return null;
  const density = Number.isFinite(viewport.density) && viewport.density > 0 ? viewport.density : 1;
  const scale = Math.min(1, viewport.width * density / output.width, viewport.height * density / output.height,
    MAX_PREVIEW_DIMENSION / Math.max(output.width, output.height),
    Math.sqrt(MAX_PREVIEW_PIXELS / (output.width * output.height)));
  return { width: even(output.width * scale), height: even(output.height * scale) };
}

/** Aim for eight 1080p frames' worth of pixels; oversized individual frames flush one at a time. */
export function getExportFrameBatchSize(size: CanvasSize): number {
  return Math.max(1, Math.min(8, Math.floor(1920 * 1080 * 8 / (size.width * size.height))));
}
