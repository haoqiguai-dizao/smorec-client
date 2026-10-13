import { build } from 'esbuild';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../public/beauty/', import.meta.url);
const model = await fs.readFile(new URL('face_landmarker.task', root));
if (createHash('sha256').update(model).digest('hex') !== '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff') {
  throw new Error('Local face landmark model checksum mismatch');
}
await fs.cp(new URL('../node_modules/@mediapipe/tasks-vision/wasm/', import.meta.url), new URL('runtime/', root), { recursive: true });
await build({ entryPoints: ['src/services/camera-effects/face/worker.ts'], outfile: 'public/beauty/worker.js',
  bundle: true, platform: 'browser', format: 'iife', target: 'es2022', legalComments: 'eof' });
