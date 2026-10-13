import { EFFECTS_KERNEL as K } from './parameters';

const scalar = (value: number) => value.toFixed(8);
const vector = (value: readonly number[]) => `vec3(${value.map(scalar).join(', ')})`;
const range = (value: readonly number[]) => value.map(scalar).join(', ');

// Keep the formulas synchronized with kernel.ts; all tuning parameters are shared.
export const VERTEX_SHADER = `
attribute vec2 aPosition;
varying vec2 uv;
void main() { uv = aPosition * 0.5 + 0.5; gl_Position = vec4(aPosition, 0.0, 1.0); }
`;

export const FRAGMENT_SHADER = `
precision highp float;
uniform sampler2D image;
uniform vec4 sampleStep; // micro.xy, tone.zw
uniform vec4 settings; // smoothing, brightness gain, filter, intensity
varying vec2 uv;
vec4 sampleColor(vec2 position) {
  vec4 c = texture2D(image, position);
  return vec4(c.a > 0.0 ? c.rgb / c.a : vec3(0.0), c.a);
}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float skinMask(vec3 c) {
  float light = luma(c);
  float chromaScale = ${scalar(K.skinChromaScale)} / max(light, ${scalar(K.skinLumaFloor)});
  float cr = 0.5 + dot(c, vec3(0.5, -0.418688, -0.081312)) * chromaScale;
  float cb = 0.5 + dot(c, vec3(-0.168736, -0.331264, 0.5)) * chromaScale;
  float chroma = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  return smoothstep(${range(K.skinCrMin)}, cr) * (1.0 - smoothstep(${range(K.skinCrMax)}, cr))
    * smoothstep(${range(K.skinCbMin)}, cb) * (1.0 - smoothstep(${range(K.skinCbMax)}, cb))
    * smoothstep(${range(K.skinLumaMin)}, light) * smoothstep(${range(K.skinChromaMin)}, chroma);
}
vec3 midtone(vec3 c) { return 4.0 * c * (1.0 - c); }
void main() {
  vec4 original = sampleColor(uv);
  vec3 color = original.rgb;
  float amount = settings.x * (1.0 + ${scalar(K.smoothingCurve)} * (1.0 - settings.x))
    * ${scalar(K.smoothingMix)} * skinMask(color);
  if (amount > 0.0 && original.a > 0.0) {
    vec3 fineSum = vec3(0.0); float fineTotal = 0.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec4 neighbor = sampleColor(uv + vec2(float(x), float(y)) * sampleStep.xy);
        float spatial = (x == 0 ? 2.0 : 1.0) * (y == 0 ? 2.0 : 1.0);
        vec3 delta = neighbor.rgb - original.rgb;
        float distance = dot(delta, delta);
        float weight = spatial * (1.0 - smoothstep(${range(K.bilateralEdge)}, distance))
          * neighbor.a / (1.0 + ${scalar(K.bilateralFalloff)} * distance);
        fineSum += neighbor.rgb * weight; fineTotal += weight;
      }
    }
    vec3 toneSum = vec3(0.0); float toneTotal = 0.0;
    for (int y = -2; y <= 2; y++) {
      for (int x = -2; x <= 2; x++) {
        vec4 neighbor = sampleColor(uv + vec2(float(x), float(y)) * sampleStep.zw);
        float wx = x == 0 ? 6.0 : (x == -1 || x == 1 ? 4.0 : 1.0);
        float wy = y == 0 ? 6.0 : (y == -1 || y == 1 ? 4.0 : 1.0);
        vec3 delta = neighbor.rgb - original.rgb;
        float distance = dot(delta, delta);
        float weight = wx * wy * (1.0 - smoothstep(${range(K.bilateralEdge)}, distance))
          * neighbor.a / (1.0 + ${scalar(K.bilateralFalloff)} * distance);
        toneSum += neighbor.rgb * weight; toneTotal += weight;
      }
    }
    if (fineTotal > 0.0 && toneTotal > 0.0) {
      vec3 tone = toneSum / toneTotal;
      float detail = luma(color - fineSum / fineTotal);
      vec3 restored = clamp(tone + vec3(detail * ${scalar(K.detailRetention)}), min(color, tone), max(color, tone));
      float protection = 1.0 - smoothstep(${range(K.detailProtection)}, abs(detail));
      color = mix(color, restored, amount * protection);
    }
  }
  color = color * settings.y / (1.0 + color * (settings.y - 1.0));
  vec3 filtered;
  if (settings.z < 0.5) {
    vec3 saturated = clamp(mix(vec3(luma(color)), color, ${scalar(K.naturalSaturation)}), 0.0, 1.0);
    filtered = saturated + (${scalar(K.naturalContrast)} * (saturated - 0.5) + ${vector(K.naturalTint)}) * midtone(saturated);
  }
  else if (settings.z < 1.5) filtered = color + ${vector(K.warmTint)} * midtone(color);
  else if (settings.z < 2.5) filtered = color + ${vector(K.coolTint)} * midtone(color);
  else filtered = vec3(luma(color));
  color = mix(color, clamp(filtered, 0.0, 1.0), settings.w);
  gl_FragColor = vec4(color, original.a);
}
`;
