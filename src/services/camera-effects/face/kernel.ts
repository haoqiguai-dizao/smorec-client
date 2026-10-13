import type { CameraEffects } from '../../../../shared/types';
import { beautyValue as value } from '../../../../shared/beauty';
import { samplePixel } from '../sampling';
import { smoothstep } from '../skin';
import { polygonMask, warpPoint, type FaceGeometry } from './geometry';

/** CPU counterpart of face/shader.ts. Uses the same geometry, masks and premultiplied sampling. */
export function applyFaceEffects(input: ImageData, output: ImageData, effects: CameraEffects, face: FaceGeometry): void {
  const { width, height, data } = input, target = output.data;
  if (width !== output.width || height !== output.height || data.buffer === target.buffer) throw new RangeError('Face effects require separate, matching buffers');
  const p = new Float64Array(2), c = new Float64Array(4), feather = Math.max(face.width * 0.008, 0.0005);
  const white = value(effects.skinWhitening), rose = value(effects.rosiness), bright = value(effects.eyeBrightening), tooth = value(effects.teethWhitening);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    warpPoint((x + 0.5) / height, (y + 0.5) / height, face.warps, p);
    samplePixel(data, width, height, p[0] * height - 0.5, p[1] * height - 0.5, c);
    const luma = c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
    const mouth = polygonMask(p[0], p[1], face.mouth, feather);
    const eyes = Math.max(...face.eyes.map(eye => polygonMask(p[0], p[1], eye, feather)));
    const neutral = (1 - smoothstep(0.08, 0.25, c[0] - c[1]))
      * (1 - smoothstep(0.2, 0.55, Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]))) * smoothstep(0.18, 0.5, luma);
    const teeth = mouth * face.mouthOpen * neutral * tooth, eye = eyes * neutral * bright;
    let gain = 1 + teeth * 0.55 + eye * 0.3;
    for (let i = 0; i < 3; i++) { c[i] += (luma - c[i]) * teeth * 0.6; c[i] = c[i] * gain / (1 + c[i] * (gain - 1)); }
    const dx = p[0] - face.center.x, dy = p[1] - face.center.y;
    const horizontal = (dx * face.axis.x + dy * face.axis.y) / (face.width * 0.52);
    const vertical = (-dx * face.axis.y + dy * face.axis.x) / (face.height * 0.52);
    const oval = 1 - smoothstep(0.72, 1, Math.hypot(horizontal, vertical));
    const skin = smoothstep(0.005, 0.06, c[0] - c[2]) * smoothstep(-0.03, 0.04, c[0] - c[1])
      * (1 - smoothstep(0.25, 0.5, c[0] - c[1])) * smoothstep(0.08, 0.25, luma);
    const mask = oval * skin * (1 - mouth) * (1 - eyes);
    gain = 1 + white * mask * 0.65;
    const offset = (y * width + x) * 4;
    for (let i = 0; i < 3; i++) {
      c[i] = c[i] * gain / (1 + c[i] * (gain - 1));
      target[offset + i] = (c[i] + [0.05, -0.014, -0.006][i] * rose * mask * 4 * c[i] * (1 - c[i])) * 255;
    }
    target[offset + 3] = c[3] * 255;
  }
}
