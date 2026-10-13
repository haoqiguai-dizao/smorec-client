import { EFFECTS_KERNEL as K } from './parameters';

export const clamp = (value: number) => Math.max(0, Math.min(1, value));
export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
export function skinMask(red: number, green: number, blue: number): number {
  const luma = 0.299 * red + 0.587 * green + 0.114 * blue;
  const chromaScale = K.skinChromaScale / Math.max(luma, K.skinLumaFloor);
  const cr = 0.5 + (0.5 * red - 0.418688 * green - 0.081312 * blue) * chromaScale;
  const cb = 0.5 + (-0.168736 * red - 0.331264 * green + 0.5 * blue) * chromaScale;
  const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
  return smoothstep(K.skinCrMin[0], K.skinCrMin[1], cr) * (1 - smoothstep(K.skinCrMax[0], K.skinCrMax[1], cr))
    * smoothstep(K.skinCbMin[0], K.skinCbMin[1], cb) * (1 - smoothstep(K.skinCbMax[0], K.skinCbMax[1], cb))
    * smoothstep(K.skinLumaMin[0], K.skinLumaMin[1], luma) * smoothstep(K.skinChromaMin[0], K.skinChromaMin[1], chroma);
}
