/** Shared scalar parameters keep the CPU kernel and generated GLSL in step. */
export const EFFECTS_KERNEL = {
  skinLumaFloor: 0.12,
  skinChromaScale: 0.45,
  skinCrMin: [0.495, 0.53],
  skinCrMax: [0.69, 0.80],
  skinCbMin: [0.20, 0.28],
  skinCbMax: [0.55, 0.63],
  skinLumaMin: [0.018, 0.07],
  skinChromaMin: [0.012, 0.045],
  smoothingMix: 0.90,
  smoothingCurve: 0.35,
  bilateralFalloff: 32,
  bilateralEdge: [0.012, 0.065],
  microRadiusScale: 1 / 1920,
  toneRadiusScale: 1 / 320,
  detailRetention: 0.22,
  detailProtection: [0.045, 0.12],
  brightnessStops: 1.5,
  naturalSaturation: 1.25,
  naturalContrast: 0.18,
  naturalTint: [0.035, 0.015, -0.02],
  warmTint: [0.10, 0.022, -0.08],
  coolTint: [-0.065, 0.01, 0.10],
} as const;

export function cameraBrightnessGain(brightness: number): number {
  return 2 ** (brightness * EFFECTS_KERNEL.brightnessStops);
}
