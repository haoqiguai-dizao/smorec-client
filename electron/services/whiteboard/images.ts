import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { BOARD_WORLD_LIMIT, IMAGE_CAPTION_HEIGHT,
  type BoardImage, type BoardPoint, type BoardRecording } from '../../../shared/whiteboard/types';

export const imageDirectory = 'whiteboard-assets';
const identifier = /^[a-f0-9-]{36}$/;

export function imageAssets(recording?: BoardRecording): string[] {
  const ids = new Set<string>();
  for (const event of recording?.events ?? []) {
    const action = event.action;
    if (action.kind === 'image') ids.add(action.asset);
    if (action.kind === 'replace' && action.element.kind === 'image') ids.add(action.element.asset);
  }
  return [...ids];
}

export async function imageFile(directory: string, id: string): Promise<string> {
  if (!identifier.test(id)) throw new Error('白板图片标识无效');
  const root = await fs.realpath(directory);
  const file = await fs.realpath(path.join(root, imageDirectory, `${id}.png`));
  if (path.relative(root, file).startsWith('..')) throw new Error('白板图片文件无效');
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size < 32 || stat.size > 16 * 1024 * 1024) throw new Error('白板图片文件无效');
  const handle = await fs.open(file, 'r');
  try {
    const header = Buffer.alloc(24);
    await handle.read(header, 0, header.length, 0);
    if (!header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      || header.toString('ascii', 12, 16) !== 'IHDR') throw new Error('白板图片文件无效');
    const width = header.readUInt32BE(16), height = header.readUInt32BE(20);
    if (width < 1 || height < 1 || width > 1600 || height > 1600 || width * height > 2_560_000)
      throw new Error('白板图片尺寸无效');
  } finally { await handle.close(); }
  return file;
}

export async function storeImage(directory: string, bytes: Uint8Array, point: BoardPoint): Promise<BoardImage> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 32 || bytes.byteLength > 12 * 1024 * 1024)
    throw new Error('图片文件须小于 12 MB');
  const source = Buffer.from(bytes);
  const png = source.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = source[0] === 255 && source[1] === 216 && source[2] === 255;
  if (!png && !jpeg) throw new Error('只支持 PNG 或 JPEG 图片');
  const { nativeImage } = await import('electron');
  const decoded = nativeImage.createFromBuffer(source);
  const dimensions = decoded.getSize();
  if (decoded.isEmpty() || dimensions.width < 1 || dimensions.height < 1
    || dimensions.width > 8192 || dimensions.height > 8192 || dimensions.width * dimensions.height > 16_000_000)
    throw new Error('图片无法读取或分辨率过大');
  const ratio = Math.min(1, 1600 / Math.max(dimensions.width, dimensions.height));
  const normalized = ratio < 1 ? decoded.resize({ width: Math.round(dimensions.width * ratio) }) : decoded;
  const output = normalized.toPNG();
  if (output.byteLength > 16 * 1024 * 1024) throw new Error('图片处理后文件过大');
  const id = randomUUID(), folder = path.join(directory, imageDirectory);
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, `${id}.png`), output, { flag: 'wx', mode: 0o600 });
  const width = Math.max(96, Math.min(320, 220 * dimensions.width / dimensions.height));
  const height = Math.max(96, Math.min(220, 320 * dimensions.height / dimensions.width));
  return { kind: 'image', id: randomUUID(), asset: id, color: '#20242c', size: 3,
    x: Math.max(-BOARD_WORLD_LIMIT, Math.min(BOARD_WORLD_LIMIT - width, point.x - width / 2)),
    y: Math.max(-BOARD_WORLD_LIMIT, Math.min(BOARD_WORLD_LIMIT - height - IMAGE_CAPTION_HEIGHT, point.y - height / 2)),
    width, height, caption: '' };
}
