import { MAX_WARPS } from './geometry';

const polygon = (name: string, count: number) => `
uniform vec2 ${name}[${count}];
float ${name}Mask(vec2 p, float feather) {
  bool inside = false; float nearest = 10.0;
  for (int i = 0; i < ${count}; i++) {
    vec2 a = ${name}[i]; vec2 b = ${name}[0];
    if (i < ${count - 1}) b = ${name}[i + 1];
    vec2 d = b - a; float t = clamp(dot(p - a, d) / max(dot(d, d), 0.0000000001), 0.0, 1.0);
    nearest = min(nearest, length(p - a - t * d));
    if ((a.y > p.y) != (b.y > p.y)) {
      if (p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside ? smoothstep(0.0, feather, nearest) : 0.0;
}`;

const shader = (premultiplied: boolean) => `
precision highp float;
uniform sampler2D image;
uniform float aspect;
uniform vec4 effectBounds;
uniform vec4 warps[${MAX_WARPS}];
uniform vec2 shifts[${MAX_WARPS}];
uniform vec4 face; // center, width, height
uniform vec2 axis;
uniform vec4 amounts; // white, rose, eyes, teeth
uniform float mouthOpen;
varying vec2 uv;
${polygon('mouth', 20)}
${polygon('leftEye', 8)}
${polygon('rightEye', 8)}
void main() {
  vec2 p = vec2(uv.x * aspect, 1.0 - uv.y);
  if (p.x < effectBounds.x || p.y < effectBounds.y || p.x > effectBounds.z || p.y > effectBounds.w) {
    vec4 original = texture2D(image, uv);
    gl_FragColor = ${premultiplied ? 'original' : 'vec4(original.a > 0.0 ? original.rgb / original.a : vec3(0.0), original.a)'};
    return;
  }
  for (int i = 0; i < ${MAX_WARPS}; i++) {
    if (warps[i].z > 0.0) {
      vec2 d = p - warps[i].xy - shifts[i];
      float w = pow(max(0.0, 1.0 - dot(d, d) / (warps[i].z * warps[i].z)), 2.0);
      p -= (shifts[i] + d * warps[i].w) * w;
    }
  }
  vec4 sample = texture2D(image, vec2(p.x / aspect, 1.0 - p.y));
  vec3 c = sample.a > 0.0 ? sample.rgb / sample.a : vec3(0.0);
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  float feather = max(face.z * 0.008, 0.0005);
  float m = mouthMask(p, feather);
  float e = max(leftEyeMask(p, feather), rightEyeMask(p, feather));
  float neutral = (1.0 - smoothstep(0.08, 0.25, c.r - c.g))
    * (1.0 - smoothstep(0.2, 0.55, max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b))))
    * smoothstep(0.18, 0.5, luma);
  float teeth = m * mouthOpen * neutral * amounts.w;
  float eyes = e * neutral * amounts.z;
  c = mix(c, vec3(luma), teeth * 0.6);
  float gain = 1.0 + teeth * 0.55 + eyes * 0.3;
  c = c * gain / (1.0 + c * (gain - 1.0));
  vec2 d = p - face.xy;
  vec2 local = vec2(dot(d, axis), dot(d, vec2(-axis.y, axis.x)));
  float oval = 1.0 - smoothstep(0.72, 1.0, length(local / (face.zw * vec2(0.52, 0.52))));
  // Conservative chroma/luminance gate, restricted to the landmark oval and excluding eyes/lips.
  float skin = smoothstep(0.005, 0.06, c.r - c.b) * smoothstep(-0.03, 0.04, c.r - c.g)
    * (1.0 - smoothstep(0.25, 0.5, c.r - c.g)) * smoothstep(0.08, 0.25, luma);
  float mask = oval * skin * (1.0 - m) * (1.0 - e);
  gain = 1.0 + amounts.x * mask * 0.65;
  c = c * gain / (1.0 + c * (gain - 1.0));
  c += vec3(0.05, -0.014, -0.006) * amounts.y * mask * 4.0 * c * (1.0 - c);
  gl_FragColor = vec4(clamp(c, 0.0, 1.0)${premultiplied ? ' * sample.a' : ''}, sample.a);
}`;

export const FACE_SHADER = shader(false);
// The next pass samples premultiplied RGBA, matching the existing 2D canvas upload.
export const FACE_TEXTURE_SHADER = shader(true);
