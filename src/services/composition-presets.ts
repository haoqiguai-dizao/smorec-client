import { compositionCameraRect } from '../../shared/composition-camera';
import type { CompositionSegment, Project } from '../../shared/types';
import { compositionTransformState } from './composition-transform';

export const COMPOSITION_PRESETS = ['bottom-right', 'reaction', 'centered', 'person-only'] as const;
export type CompositionPreset = typeof COMPOSITION_PRESETS[number];

const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));

/** A local edit patch only: recorded camera tracks and desktop preferences stay untouched. */
export function compositionPresetPatch(project: Project, segment: CompositionSegment, sourceTime: number,
  preset: CompositionPreset): Partial<CompositionSegment> | undefined {
  if (!project.media.camera || !Number.isFinite(sourceTime)) return undefined;
  const state = compositionTransformState(project, segment, sourceTime);
  if (!state) return undefined;
  const { width, height } = state.output, short = Math.min(width, height);
  if (!Number.isFinite(short) || short <= 0) return undefined;
  const currentSize = state.rect.width / short;
  const size = preset === 'bottom-right' ? .22 : preset === 'centered' ? .5 : preset === 'person-only' ? .6
    : Math.max(currentSize, Math.min(.7, Math.max(.42, currentSize * 1.4)));
  const camera = { ...segment.camera, size, visible: true };
  const rect = compositionCameraRect(state.style, camera, width, height);
  const centerX = preset === 'reaction' ? state.rect.x + state.rect.width / 2 : width / 2;
  const centerY = preset === 'reaction' ? state.rect.y + state.rect.height / 2 : height / 2;
  const gap = short * .035;
  const x = preset === 'bottom-right' ? width - rect.width - gap : centerX - rect.width / 2;
  const y = preset === 'bottom-right' ? height - rect.height - gap : centerY - rect.height / 2;
  const patch = { camera: { ...camera, x: clamp(x, width - rect.width) / width, y: clamp(y, height - rect.height) / height } };
  return preset === 'person-only' ? { ...patch, screen: 'hidden' } : patch;
}
