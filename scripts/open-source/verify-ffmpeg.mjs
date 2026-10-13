import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// Inspect the executable actually used by this platform, without running the GPL npm wrapper.
const require = createRequire(import.meta.url);
const ffmpeg = process.platform === 'darwin' ? path.resolve('output/ffmpeg-gpl/ffmpeg')
  : process.env.FFMPEG_BIN || path.join(path.dirname(require.resolve('ffmpeg-static/package.json')),
    process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
if (!existsSync(ffmpeg)) throw new Error('FFmpeg missing; on macOS run npm run ffmpeg:mac:build first');
const version = execFileSync(ffmpeg, ['-version'], { encoding: 'utf8', timeout: 15000 });
const license = execFileSync(ffmpeg, ['-L'], { encoding: 'utf8', timeout: 15000 });
if (/--enable-nonfree\b/.test(version) || /nonfree and unredistributable|not legally redistributable/i.test(license)) {
  throw new Error('FFmpeg is not redistributable. On macOS run npm run ffmpeg:mac:build. Never ship this binary.');
}
const source = path.join(process.cwd(), 'output/ffmpeg-gpl/SOURCE-BUILD.json');
console.log(JSON.stringify({
  executable: ffmpeg, sha256: createHash('sha256').update(readFileSync(ffmpeg)).digest('hex'),
  version: version.split('\n')[0], nonfree: false, sourceBuildReceiptAvailable: existsSync(source),
  remaining: 'Keep matching sources, configuration and all upstream notices with any binary distribution.',
}));
