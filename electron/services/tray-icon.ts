import { nativeImage, type NativeImage } from 'electron';
import { deflateSync } from 'node:zlib';
import { applicationIcon } from './app-icon';

function crc(data: Buffer): number {
  let value = 0xffffffff;
  for (const byte of data) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(name: string, data: Buffer): Buffer {
  const type = Buffer.from(name), length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, checksum]);
}

export function trayIcon(recordingActive: boolean): NativeImage {
  if (!recordingActive) {
    const icon = applicationIcon();
    if (icon) return icon.resize({ width: 24, height: 24 });
  }
  // A red recording indicator remains unambiguous at Windows tray sizes. The
  // generated idle fallback also keeps controls usable if artwork is unavailable.
  const header = Buffer.alloc(13); header.writeUInt32BE(24, 0); header.writeUInt32BE(24, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc(24 * (1 + 24 * 4));
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
    const offset = y * 97 + 1 + x * 4, inside = Math.hypot(x - 11.5, y - 11.5) < 9;
    pixels[offset] = recordingActive ? 245 : 112; pixels[offset + 1] = recordingActive ? 81 : 145;
    pixels[offset + 2] = recordingActive ? 100 : 247; pixels[offset + 3] = inside ? 255 : 0;
  }
  return nativeImage.createFromBuffer(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]));
}
